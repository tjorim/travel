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

  get unauthorized(): boolean { return this.status === 401; }
  get offline(): boolean { return this.status === 0; }
  /** The server understood the request and rejected it: retrying cannot help. */
  get permanent(): boolean { return this.status >= 400 && this.status < 500; }
}

const offlineMessage = "Geen verbinding met de server. Controleer je verbinding en probeer opnieuw.";
const unauthorizedMessage = "Je aanmelding is verlopen. Meld opnieuw aan om verder te gaan.";

type ValidationIssue = { loc?: unknown[]; msg?: string };

function detailMessage(detail: unknown): { message: string | null; fields: Record<string, string> } {
  if (typeof detail === "string") return { message: detail, fields: {} };
  if (!Array.isArray(detail)) return { message: null, fields: {} };
  const fields: Record<string, string> = {};
  const messages: string[] = [];
  for (const issue of detail as ValidationIssue[]) {
    if (typeof issue?.msg !== "string") continue;
    messages.push(issue.msg);
    const field = issue.loc?.at(-1);
    if (typeof field === "string" && field !== "body") fields[field] = issue.msg;
  }
  return { message: messages.join(" ") || null, fields };
}

/** Maps a failed response to the message shown to the owner. */
export async function apiFailure(response: Response, fallback: string): Promise<ApiError> {
  const body = await response.json().catch(() => null) as { detail?: unknown } | null;
  const { message, fields } = detailMessage(body?.detail);
  return new ApiError(response.status === 401 ? unauthorizedMessage : message || fallback, response.status, fields);
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
export async function ownerRequest<T>(session: TrackerSession, path: string, fallback: string, { method = "GET", body, signal, cache, credentials }: OwnerRequest = {}): Promise<T> {
  const multipart = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await send(path, {
    method,
    // A multipart body carries its own boundary in the Content-Type the browser sets.
    headers: multipart ? authorization(session) : { ...authorization(session), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
    ...(cache ? { cache } : {}),
    ...(credentials ? { credentials } : {}),
  }, signal);
  if (!response.ok) throw await apiFailure(response, fallback);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

/**
 * Downloads a protected file. The bytes go to the caller (an object URL, an
 * offline copy) and never into the query cache.
 */
export async function ownerFile(session: TrackerSession, url: string, fallback: string, { signal, cache, credentials }: Pick<OwnerRequest, "signal" | "cache" | "credentials"> = {}): Promise<Blob> {
  const response = await send(url, { headers: authorization(session), ...(cache ? { cache } : {}), ...(credentials ? { credentials } : {}) }, signal);
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
