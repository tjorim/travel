// Command travel-auth is the small, single-password gate for Travel's
// protected static routes. It is intended to sit behind Caddy's forward_auth
// directive and deliberately has no user database or browser-side secrets.
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"html/template"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

const (
	cookieName       = "travel_session"
	loginPath        = "/login"
	logoutPath       = "/logout"
	verificationPath = "/verify"
	defaultTTL       = 8 * time.Hour
	maxLoginBody     = 8 << 10
	attemptWindow    = 15 * time.Minute
	maxAttempts      = 5
)

var loginTemplate = template.Must(template.New("login").Parse(`<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Privé Travel</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #10241f; color: #ecf8f1; }
    body { display: grid; min-height: 100vh; margin: 0; place-items: center; }
    main { box-sizing: border-box; width: min(100% - 32px, 420px); padding: 32px; border: 1px solid #315d4f; border-radius: 16px; background: #17352d; box-shadow: 0 20px 55px #07140f88; }
    h1 { margin: 0 0 8px; font-size: 1.55rem; } p { color: #b8d4c7; line-height: 1.5; }
    label { display: block; margin-top: 24px; font-weight: 700; } input { box-sizing: border-box; width: 100%; margin-top: 8px; padding: 12px; border: 1px solid #648c7d; border-radius: 8px; font: inherit; }
    button { width: 100%; margin-top: 18px; padding: 12px; border: 0; border-radius: 8px; background: #9cf4c8; color: #11251e; font: inherit; font-weight: 800; cursor: pointer; }
    .error { padding: 10px 12px; border-left: 3px solid #ffb4ab; background: #4d2724; color: #ffd9d5; }
  </style>
</head>
<body>
  <main>
    <h1>Privé Travel</h1>
    <p>Voer het gedeelde wachtwoord in om de reisdocumenten en reisplannen te openen.</p>
    {{if .Error}}<p class="error" role="alert">{{.Error}}</p>{{end}}
    <form action="/login" method="post">
      <input type="hidden" name="next" value="{{.Next}}">
      <label for="password">Wachtwoord</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Inloggen</button>
    </form>
  </main>
</body>
</html>`))

type config struct {
	passwordHash []byte
	sessionKey   []byte
	sessionTTL   time.Duration
	cookieSecure bool
}

type limiter struct {
	mu       sync.Mutex
	failures map[string][]time.Time
}

type app struct {
	config  config
	limiter limiter
	now     func() time.Time
}

type passwordHash struct {
	memory      uint32
	iterations  uint32
	parallelism uint8
	salt        []byte
	expected    []byte
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--healthcheck" {
		return
	}
	cfg, err := loadConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, "travel-auth configuration is invalid")
		os.Exit(1)
	}
	application := &app{config: cfg, limiter: limiter{failures: make(map[string][]time.Time)}, now: time.Now}
	server := &http.Server{
		Addr:              ":8080",
		Handler:           application.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintln(os.Stderr, "travel-auth server stopped unexpectedly")
		os.Exit(1)
	}
}

func loadConfig() (config, error) {
	encodedKey := os.Getenv("TRAVEL_AUTH_SESSION_KEY")
	key, err := base64.RawURLEncoding.DecodeString(encodedKey)
	if err != nil || len(key) < 32 {
		return config{}, errors.New("invalid session key")
	}
	hash := os.Getenv("TRAVEL_PRIVATE_PASSWORD_HASH")
	if hash == "" {
		hash = os.Getenv("TRAVEL_AUTH_PASSWORD_HASH")
	}
	if _, err := parsePasswordHash([]byte(hash)); err != nil {
		return config{}, errors.New("invalid password hash")
	}
	ttl := defaultTTL
	if configuredTTL := os.Getenv("TRAVEL_AUTH_SESSION_TTL"); configuredTTL != "" {
		ttl, err = time.ParseDuration(configuredTTL)
		if err != nil || ttl < time.Minute || ttl > 7*24*time.Hour {
			return config{}, errors.New("invalid session ttl")
		}
	}
	secure := true
	if configuredSecure := os.Getenv("TRAVEL_AUTH_COOKIE_SECURE"); configuredSecure != "" {
		secure, err = strconv.ParseBool(configuredSecure)
		if err != nil {
			return config{}, errors.New("invalid cookie secure setting")
		}
	}
	return config{passwordHash: []byte(hash), sessionKey: key, sessionTTL: ttl, cookieSecure: secure}, nil
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+loginPath, a.loginForm)
	mux.HandleFunc("POST "+loginPath, a.login)
	mux.HandleFunc("POST "+logoutPath, a.logout)
	mux.HandleFunc("GET "+verificationPath, a.verify)
	return securityHeaders(mux)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func (a *app) loginForm(w http.ResponseWriter, r *http.Request) {
	a.renderLogin(w, safeLocalPath(r.URL.Query().Get("next")), "")
}

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxLoginBody)
	if err := r.ParseForm(); err != nil {
		a.renderLogin(w, "/", "Het wachtwoord is onjuist.")
		return
	}
	next := safeLocalPath(r.PostForm.Get("next"))
	ip := clientIP(r)
	if !a.limiter.allow(ip, a.now()) || !verifyPassword(r.PostForm.Get("password"), a.config.passwordHash) {
		a.limiter.recordFailure(ip, a.now())
		a.renderLogin(w, next, "Het wachtwoord is onjuist.")
		return
	}
	a.limiter.clear(ip)
	session, err := a.newSession(a.now())
	if err != nil {
		http.Error(w, "Er ging iets mis.", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    session,
		Path:     "/",
		MaxAge:   int(a.config.sessionTTL.Seconds()),
		Expires:  a.now().Add(a.config.sessionTTL),
		HttpOnly: true,
		Secure:   a.config.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, next, http.StatusSeeOther)
}

func (a *app) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, Expires: time.Unix(1, 0), HttpOnly: true, Secure: a.config.cookieSecure, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (a *app) verify(w http.ResponseWriter, r *http.Request) {
	if a.validSession(r, a.now()) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	next := safeLocalPath(r.Header.Get("X-Forwarded-Uri"))
	http.Redirect(w, r, loginPath+"?next="+url.QueryEscape(next), http.StatusFound)
}

func (a *app) renderLogin(w http.ResponseWriter, next, problem string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if problem != "" {
		w.WriteHeader(http.StatusUnauthorized)
	}
	_ = loginTemplate.Execute(w, struct{ Next, Error string }{Next: next, Error: problem})
}

func (a *app) newSession(now time.Time) (string, error) {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	payload := fmt.Sprintf("v1.%d.%s", now.Add(a.config.sessionTTL).Unix(), base64.RawURLEncoding.EncodeToString(nonce))
	signature := sign(payload, a.config.sessionKey)
	return payload + "." + signature, nil
}

func (a *app) validSession(r *http.Request, now time.Time) bool {
	cookie, err := r.Cookie(cookieName)
	if err != nil || cookie.Value == "" {
		return false
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 4 || parts[0] != "v1" {
		return false
	}
	expiry, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || now.Unix() >= expiry {
		return false
	}
	payload := strings.Join(parts[:3], ".")
	expected := sign(payload, a.config.sessionKey)
	return subtle.ConstantTimeCompare([]byte(parts[3]), []byte(expected)) == 1
}

func sign(payload string, key []byte) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func verifyPassword(password string, encodedHash []byte) bool {
	// The deployment secret uses the standard PHC Argon2id encoding.
	hash, err := parsePasswordHash(encodedHash)
	if err != nil {
		return false
	}
	actual := argon2.IDKey([]byte(password), hash.salt, hash.iterations, hash.memory, hash.parallelism, uint32(len(hash.expected)))
	return subtle.ConstantTimeCompare(actual, hash.expected) == 1
}

func parsePasswordHash(encodedHash []byte) (passwordHash, error) {
	parts := strings.Split(string(encodedHash), "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" || !strings.HasPrefix(parts[3], "m=") {
		return passwordHash{}, errors.New("invalid password hash")
	}
	var memory uint32
	var iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil || memory < 8*uint32(parallelism) || memory > 1_048_576 || iterations > 10 || parallelism == 0 || parallelism > 16 {
		return passwordHash{}, errors.New("invalid password hash parameters")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		salt, err = base64.StdEncoding.DecodeString(parts[4])
	}
	if err != nil || len(salt) < 16 {
		return passwordHash{}, errors.New("invalid password hash salt")
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		expected, err = base64.StdEncoding.DecodeString(parts[5])
	}
	if err != nil || len(expected) < 16 {
		return passwordHash{}, errors.New("invalid password hash value")
	}
	return passwordHash{memory: memory, iterations: iterations, parallelism: parallelism, salt: salt, expected: expected}, nil
}

func safeLocalPath(raw string) string {
	if raw == "" || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.Contains(raw, "\\") {
		return "/"
	}
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || !isProtectedPath(parsed.Path) {
		return "/"
	}
	return parsed.RequestURI()
}

func isProtectedPath(path string) bool {
	if path == "/private" || strings.HasPrefix(path, "/private/") {
		return true
	}
	segments := strings.Split(strings.TrimPrefix(path, "/"), "/")
	return len(segments) >= 2 && segments[1] == "private" && segments[0] != ""
}

func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func (l *limiter) allow(ip string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.prune(ip, now)
	return len(l.failures[ip]) < maxAttempts
}

func (l *limiter) recordFailure(ip string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.prune(ip, now)
	if len(l.failures[ip]) >= maxAttempts {
		return
	}
	l.failures[ip] = append(l.failures[ip], now)
}

func (l *limiter) clear(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, ip)
}

func (l *limiter) prune(ip string, now time.Time) {
	attempts := l.failures[ip]
	firstValid := 0
	for firstValid < len(attempts) && now.Sub(attempts[firstValid]) >= attemptWindow {
		firstValid++
	}
	if firstValid == len(attempts) {
		delete(l.failures, ip)
		return
	}
	l.failures[ip] = attempts[firstValid:]
}
