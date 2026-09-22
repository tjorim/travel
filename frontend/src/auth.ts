const issuer = "https://auth.tjor.im/realms/travel";
const clientId = "travel-tracker";
const storageKey = "travel-tracker-session";
const transactionKey = "travel-tracker-pkce-transaction";

export type TrackerSession = {
  accessToken: string;
  expiresAt: number;
  idToken?: string;
};

type PkceTransaction = {
  codeVerifier: string;
  returnPath: string;
  state: string;
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

export async function beginSignIn(returnPath: string): Promise<void> {
  const codeVerifier = randomValue();
  const state = randomValue();
  sessionStorage.setItem(transactionKey, JSON.stringify({ codeVerifier, returnPath: trackerPath(returnPath), state }));

  const parameters = new URLSearchParams({
    client_id: clientId,
    code_challenge: await challengeFor(codeVerifier),
    code_challenge_method: "S256",
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: "openid profile email",
    state,
  });
  window.location.assign(`${issuer}/protocol/openid-connect/auth?${parameters}`);
}

export async function completeSignIn(search: string): Promise<{ returnPath: string; session: TrackerSession }> {
  const parameters = new URLSearchParams(search);
  const error = parameters.get("error");
  if (error) throw new Error("Aanmelden is afgebroken of geweigerd.");

  const code = parameters.get("code");
  const state = parameters.get("state");
  const stored = sessionStorage.getItem(transactionKey);
  sessionStorage.removeItem(transactionKey);
  if (!code || !state || !stored) throw new Error("De aanmeldsessie ontbreekt of is verlopen.");

  let transaction: PkceTransaction;
  try {
    transaction = JSON.parse(stored) as PkceTransaction;
  } catch {
    throw new Error("De aanmeldsessie is ongeldig.");
  }
  if (transaction.state !== state || !transaction.codeVerifier) throw new Error("De aanmeldsessie komt niet overeen.");

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
  sessionStorage.setItem(storageKey, JSON.stringify(session));
  return { returnPath: trackerPath(transaction.returnPath), session };
}

export function clearSession(): void {
  sessionStorage.removeItem(storageKey);
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
