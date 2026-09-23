const issuer = "https://auth.tjor.im/realms/travel";
const clientId = "travel-tracker";
const storageKey = "travel-tracker-session";
const transactionKey = "travel-tracker-pkce-transaction";
const restoreMarkerKey = "travel-tracker-may-restore-session";
const silentRestoreKey = "travel-tracker-silent-restore-in-progress";

export type TrackerSession = {
  accessToken: string;
  expiresAt: number;
  idToken?: string;
};

type PkceTransaction = {
  codeVerifier: string;
  returnPath: string;
  state: string;
  silent: boolean;
};

type SignInOptions = {
  silent?: boolean;
};

function base64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomValue(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function challengeFor(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function callbackUrl(): string {
  return `${window.location.origin}/admin/auth/callback`;
}

function trackerPath(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export function readSession(): TrackerSession | null {
  const stored = sessionStorage.getItem(storageKey);
  if (!stored) return null;
  try {
    const session = JSON.parse(stored) as TrackerSession;
    if (typeof session.accessToken !== "string" || typeof session.expiresAt !== "number" || session.expiresAt <= Date.now()) {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    return session;
  } catch {
    sessionStorage.removeItem(storageKey);
    return null;
  }
}

function storeSession(session: TrackerSession): void {
  sessionStorage.setItem(storageKey, JSON.stringify(session));
  // This contains no credential. It permits a reload to ask Keycloak for a
  // fresh short-lived token through its existing SSO cookie if sessionStorage
  // was discarded by a browser/PWA shell.
  localStorage.setItem(restoreMarkerKey, "1");
  sessionStorage.removeItem(silentRestoreKey);
}

export function shouldRestoreSession(): boolean {
  return localStorage.getItem(restoreMarkerKey) === "1" && sessionStorage.getItem(silentRestoreKey) !== "1";
}

export async function beginSignIn(returnPath: string, { silent = false }: SignInOptions = {}): Promise<void> {
  const codeVerifier = randomValue();
  const state = randomValue();
  sessionStorage.setItem(transactionKey, JSON.stringify({ codeVerifier, returnPath: trackerPath(returnPath), state, silent }));
  if (silent) sessionStorage.setItem(silentRestoreKey, "1");
  else sessionStorage.removeItem(silentRestoreKey);

  const parameters = new URLSearchParams({
    client_id: clientId,
    code_challenge: await challengeFor(codeVerifier),
    code_challenge_method: "S256",
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: "openid profile email",
    state,
  });
  if (silent) parameters.set("prompt", "none");
  window.location.assign(`${issuer}/protocol/openid-connect/auth?${parameters}`);
}

export async function completeSignIn(search: string): Promise<{ returnPath: string; session: TrackerSession }> {
  const parameters = new URLSearchParams(search);
  const error = parameters.get("error");
  const code = parameters.get("code");
  const state = parameters.get("state");
  const stored = sessionStorage.getItem(transactionKey);
  sessionStorage.removeItem(transactionKey);
  if (!state || !stored) throw new Error("De aanmeldsessie ontbreekt of is verlopen.");

  let transaction: PkceTransaction;
  try {
    transaction = JSON.parse(stored) as PkceTransaction;
  } catch {
    throw new Error("De aanmeldsessie is ongeldig.");
  }
  if (transaction.state !== state || !transaction.codeVerifier) throw new Error("De aanmeldsessie komt niet overeen.");
  if (error) {
    sessionStorage.removeItem(silentRestoreKey);
    if (transaction.silent) {
      // There is no longer a Keycloak SSO session to recover. Do not retry on
      // every rendered route; the owner can choose the normal sign-in action.
      localStorage.removeItem(restoreMarkerKey);
      throw new Error("Je aanmeldsessie is verlopen. Meld opnieuw aan om verder te gaan.");
    }
    throw new Error("Aanmelden is afgebroken of geweigerd.");
  }
  if (!code) throw new Error("De aanmeldcode ontbreekt of is verlopen.");

  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: transaction.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: callbackUrl(),
    }),
  });
  if (!response.ok) throw new Error("De aanmeldcode kon niet worden ingewisseld.");

  const token = (await response.json()) as { access_token?: unknown; expires_in?: unknown; id_token?: unknown };
  if (typeof token.access_token !== "string" || typeof token.expires_in !== "number") {
    throw new Error("De identiteitsserver gaf geen geldig toegangstoken terug.");
  }
  const session: TrackerSession = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    ...(typeof token.id_token === "string" ? { idToken: token.id_token } : {}),
  };
  storeSession(session);
  return { returnPath: trackerPath(transaction.returnPath), session };
}

export function clearSession(): void {
  sessionStorage.removeItem(storageKey);
  sessionStorage.removeItem(silentRestoreKey);
  localStorage.removeItem(restoreMarkerKey);
}

/**
 * Decodes the access token's `sub` claim client-side, without verifying the
 * signature, purely to key local per-owner storage. The server independently
 * verifies and derives `sub` on every request; this is not a trust boundary.
 */
export function decodeSubject(accessToken: string): string | null {
  const segment = accessToken.split(".")[1];
  if (!segment) return null;
  try {
    const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export function beginSignOut(session: TrackerSession): void {
  clearSession();
  const parameters = new URLSearchParams({
    client_id: clientId,
    post_logout_redirect_uri: `${window.location.origin}/admin/`,
  });
  if (session.idToken) parameters.set("id_token_hint", session.idToken);
  window.location.assign(`${issuer}/protocol/openid-connect/logout?${parameters}`);
}
