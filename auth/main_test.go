package main

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/argon2"
)

func TestSafeLocalPathAcceptsOnlyProtectedLocalPaths(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"/private/documents/?tab=all", "/private/documents/?tab=all"},
		{"/exampleland-2054/private/?day=2", "/exampleland-2054/private/?day=2"},
		{"https://example.test/private/", "/"},
		{"//example.test/private/", "/"},
		{"/exampleland-2054/", "/"},
		{"/login", "/"},
	}
	for _, test := range tests {
		if got := safeLocalPath(test.input); got != test.want {
			t.Errorf("safeLocalPath(%q) = %q, want %q", test.input, got, test.want)
		}
	}
}

func TestSessionIsSignedAndExpires(t *testing.T) {
	now := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	application := &app{config: config{sessionKey: []byte(strings.Repeat("k", 32)), sessionTTL: time.Hour}}
	session, err := application.newSession(now)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/verify", nil)
	request.AddCookie(&http.Cookie{Name: cookieName, Value: session})
	if !application.validSession(request, now.Add(59*time.Minute)) {
		t.Fatal("valid signed session was rejected")
	}
	if application.validSession(request, now.Add(time.Hour)) {
		t.Fatal("expired session was accepted")
	}
	request.Header.Set("Cookie", cookieName+"="+session+"x")
	if application.validSession(request, now.Add(time.Minute)) {
		t.Fatal("modified session was accepted")
	}
}

func TestVerifyRedirectsToLoginForInvalidSession(t *testing.T) {
	application := &app{config: config{sessionKey: []byte(strings.Repeat("k", 32))}, now: time.Now}
	request := httptest.NewRequest(http.MethodGet, "/verify", nil)
	request.Header.Set("X-Forwarded-Uri", "/example-trip/private/?next=one")
	response := httptest.NewRecorder()
	application.verify(response, request)
	if response.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusFound)
	}
	if got := response.Header().Get("Location"); got != "/login?next=%2Fexample-trip%2Fprivate%2F%3Fnext%3Done" {
		t.Fatalf("redirect = %q", got)
	}
}

func TestLimiterBlocksAfterFiveFailures(t *testing.T) {
	now := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	limiter := limiter{failures: make(map[string][]time.Time)}
	for range maxAttempts {
		if !limiter.allow("192.0.2.1", now) {
			t.Fatal("blocked too early")
		}
		limiter.recordFailure("192.0.2.1", now)
	}
	if limiter.allow("192.0.2.1", now) {
		t.Fatal("did not block after repeated failures")
	}
	if !limiter.allow("192.0.2.1", now.Add(attemptWindow)) {
		t.Fatal("did not reset after the attempt window")
	}
}

func TestLogoutExpiresTheCookie(t *testing.T) {
	application := &app{config: config{cookieSecure: true}}
	request := httptest.NewRequest(http.MethodPost, "/logout", nil)
	response := httptest.NewRecorder()
	application.logout(response, request)
	if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/" {
		t.Fatalf("logout response = %d %q", response.Code, response.Header().Get("Location"))
	}
	cookie := response.Result().Cookies()[0]
	if cookie.Name != cookieName || cookie.MaxAge >= 0 || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("logout cookie was not securely expired: %#v", cookie)
	}
}

func TestVerifyPasswordWithGeneratedNonProductionFixtures(t *testing.T) {
	password := "test-only-password"
	salt := []byte("sixteen-byte-salt")
	expected := argon2.IDKey([]byte(password), salt, 1, 8*1024, 1, 32)
	for name, encoding := range map[string]*base64.Encoding{
		"standard": base64.RawStdEncoding,
		"url-safe": base64.RawURLEncoding,
	} {
		t.Run(name, func(t *testing.T) {
			encoded := fmt.Sprintf("$argon2id$v=19$m=8192,t=1,p=1$%s$%s",
				encoding.EncodeToString(salt),
				encoding.EncodeToString(expected),
			)
			if !verifyPassword(password, []byte(encoded)) {
				t.Fatal("correct password was rejected")
			}
			if verifyPassword("not-the-password", []byte(encoded)) {
				t.Fatal("incorrect password was accepted")
			}
		})
	}
}

func TestSessionKeyReadsDockerSecretFile(t *testing.T) {
	keyFile := t.TempDir() + "/session-key"
	if err := os.WriteFile(keyFile, []byte("secret-key\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TRAVEL_AUTH_SESSION_KEY", "")
	t.Setenv("TRAVEL_AUTH_SESSION_KEY_FILE", keyFile)
	key, err := sessionKey()
	if err != nil || key != "secret-key" {
		t.Fatalf("sessionKey() = %q, %v", key, err)
	}
}
