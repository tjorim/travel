import type { TrackerSession } from "../auth";
import { openBlobInNewTab } from "../tracker-model";

/** A failed owner API call. `status` is 0 when the request never reached the server. */
export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string>;

  constructor(message: string, status: number, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }

  get unauthorized(): boolean {
    return this.status === 401;
  }
  get offline(): boolean {
    return this.status === 0;
  }
  /** The server understood the request and rejected it: retrying cannot help. */
  get permanent(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

const offlineMessage = "Geen verbinding met de server. Controleer je verbinding en probeer opnieuw.";
const serverMessage = "De server reageert niet goed. Probeer het later opnieuw.";
const unauthorizedMessage = "Je aanmelding is verlopen. Meld opnieuw aan om verder te gaan.";

type ValidationIssue = { loc?: unknown[]; msg?: string };

/** The API answers in English; these are the messages an owner can reach from the app. */
const KNOWN_MESSAGES: Record<string, string> = {
  "Write the text for visitors before sharing this update":
    "Schrijf eerst de tekst voor bezoekers voordat je deze reisupdate deelt.",
  "Give this location a public name before sharing it":
    "Geef deze locatie eerst een publieke naam voordat je haar deelt.",
  "Wait for this copy to finish processing": "Wacht tot deze kopie klaar is met verwerken.",
  "Add an address before sharing it": "Voeg eerst een adres toe voordat je het deelt.",
  "This trip is not published": "Deze reis is niet gepubliceerd.",
  "Only a draft link can be activated": "Alleen een conceptlink kan worden geactiveerd.",
  "Only an active link can be revoked": "Alleen een actieve link kan worden ingetrokken.",
  "Only an active link can be rotated": "Alleen een actieve link kan worden geroteerd.",
  "Share link not found": "Deze deellink bestaat niet meer.",
  "Record not found": "Dit onderdeel bestaat niet meer.",
  "Arrival must be after departure": "De aankomst moet na het vertrek liggen.",
  "Give both the departure and the arrival time, or neither":
    "Geef zowel de vertrek- als de aankomsttijd op, of geen van beide.",
  "One or more documents are unavailable for this trip": "Een of meer documenten zijn niet beschikbaar voor deze reis.",
  "One or more media assets are unavailable for this trip": "Een of meer media zijn niet beschikbaar voor deze reis.",
  "Field required": "Dit veld is verplicht.",
};

const MESSAGE_PATTERNS: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^String should have at most (\d+) characters?$/, (m) => `Gebruik maximaal ${m[1]} tekens.`],
  [/^String should have at least (\d+) characters?$/, (m) => `Gebruik minstens ${m[1]} tekens.`],
  [/^Input should be greater than or equal to (.+)$/, (m) => `Kies een waarde van ${m[1]} of meer.`],
  [/^Input should be less than or equal to (.+)$/, (m) => `Kies een waarde van ${m[1]} of minder.`],
  [/^Input should be a valid .+$/, () => "Deze invoer is niet geldig."],
];

/** Dutch text for a known API message; anything else (including messages already in Dutch) is left as it is. */
export function translateApiMessage(message: string): string {
  const text = message.replace(/^Value error, /, "");
  const known = KNOWN_MESSAGES[text];
  if (known) return known;
  for (const [pattern, translate] of MESSAGE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return translate(match);
  }
  return message;
}

function detailMessage(detail: unknown): { message: string | null; fields: Record<string, string> } {
  if (typeof detail === "string") return { message: translateApiMessage(detail), fields: {} };
  if (!Array.isArray(detail)) return { message: null, fields: {} };
  const fields: Record<string, string> = {};
  const messages: string[] = [];
  for (const issue of detail as ValidationIssue[]) {
    if (typeof issue?.msg !== "string") continue;
    const translated = translateApiMessage(issue.msg);
    messages.push(translated);
    const field = issue.loc?.at(-1);
    if (typeof field === "string" && field !== "body") fields[field] = translated;
  }
  return { message: messages.join(" ") || null, fields };
}

/** Maps a failed response to the message shown to the owner. */
export async function apiFailure(response: Response, fallback: string): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  const { message, fields } = detailMessage(body?.detail);
  // A server error with nothing to say (a proxy's 502, a crash) is not the owner's mistake; say so, after what failed.
  const text =
    response.status === 401
      ? unauthorizedMessage
      : message || (response.status >= 500 ? `${fallback} ${serverMessage}` : fallback);
  return new ApiError(text, response.status, fields);
}

export type OwnerRequest = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON-serialised, except a `FormData` upload, which is sent as multipart. */
  body?: unknown;
  signal?: AbortSignal;
  cache?: RequestCache;
  credentials?: RequestCredentials;
};

const authorization = (session: TrackerSession) => ({ Authorization: `Bearer ${session.accessToken}` });

/** Sends the request; a transport failure is reported as offline and an abort is left alone. */
async function send(url: string, init: RequestInit, signal: AbortSignal | undefined): Promise<Response> {
  try {
    return await fetch(url, { ...init, ...(signal ? { signal } : {}) });
  } catch (error) {
    // An abort is deliberate cancellation, not a failure to report.
    if (signal?.aborted) throw error;
    throw new ApiError(offlineMessage, 0);
  }
}

/**
 * The single authenticated owner fetcher. The bearer token is attached here
 * and nowhere else in the query layer, so it never reaches a query key, a
 * cached value or a devtools panel.
 */
export async function ownerRequest<T>(
  session: TrackerSession,
  path: string,
  fallback: string,
  { method = "GET", body, signal, cache, credentials }: OwnerRequest = {},
): Promise<T> {
  const multipart = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await send(
    path,
    {
      method,
      // A multipart body carries its own boundary in the Content-Type the browser sets.
      headers: multipart ? authorization(session) : { ...authorization(session), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
      ...(cache ? { cache } : {}),
      ...(credentials ? { credentials } : {}),
    },
    signal,
  );
  if (!response.ok) throw await apiFailure(response, fallback);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Downloads a protected file. The bytes go to the caller (an object URL, an
 * offline copy) and never into the query cache.
 */
export async function ownerFile(
  session: TrackerSession,
  url: string,
  fallback: string,
  { signal, cache, credentials }: Pick<OwnerRequest, "signal" | "cache" | "credentials"> = {},
): Promise<Blob> {
  const response = await send(
    url,
    { headers: authorization(session), ...(cache ? { cache } : {}), ...(credentials ? { credentials } : {}) },
    signal,
  );
  if (!response.ok) throw await apiFailure(response, fallback);
  return response.blob();
}

/** Opens a protected file in a new tab. */
export async function openOwnerFile(session: TrackerSession, url: string, fallback: string): Promise<void> {
  openBlobInNewTab(await ownerFile(session, url, fallback));
}

/** The message to show for any thrown value. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
