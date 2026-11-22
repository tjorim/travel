import { freshSession, type OwnerSession } from "@/lib/auth";
import { openBlobInNewTab } from "@/lib/files";
import { ApiError, apiFailure, type ErrorFallback } from "./api";

export type OwnerRequest = {
  headers?: Record<string, string>;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON-serialised, except FormData (multipart) and Blob/File (binary). */
  body?: unknown;
  signal?: AbortSignal;
  cache?: RequestCache;
  credentials?: RequestCredentials;
};

const authorization = (session: OwnerSession) => ({
  Authorization: `Bearer ${session.accessToken}`,
});

/** Sends the request; a transport failure is reported as offline and an abort is left alone. */
async function send(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, ...(signal ? { signal } : {}) });
  } catch (error) {
    // An abort is deliberate cancellation, not a failure to report.
    if (signal?.aborted) throw error;
    throw new ApiError("", 0);
  }
}

async function authenticatedSend(
  session: OwnerSession,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
) {
  // Renewal transport failures preserve the session and let the request report its own error.
  let current = await freshSession(session).catch(() => session);
  const request = () =>
    send(url, { ...init, headers: { ...init.headers, ...authorization(current) } }, signal);
  let response = await request();
  if (response.status === 401) {
    try {
      current = await freshSession(current, true);
    } catch {
      return response;
    }
    response = await request();
  }
  return response;
}

/**
 * The single authenticated owner fetcher. The bearer token is attached here
 * and nowhere else in the query layer, so it never reaches a query key, a
 * cached value or a devtools panel.
 */
export async function ownerRequest<T>(
  session: OwnerSession,
  path: string,
  fallback: ErrorFallback,
  { method = "GET", body, signal, cache, credentials, headers }: OwnerRequest = {},
): Promise<T> {
  const binary = typeof Blob !== "undefined" && body instanceof Blob;
  const multipart = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await authenticatedSend(
    session,
    path,
    {
      method,
      // A multipart body carries its own boundary in the Content-Type the browser sets.
      headers: {
        ...authorization(session),
        ...(!multipart
          ? { "Content-Type": binary ? "application/octet-stream" : "application/json" }
          : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: multipart || binary ? body : JSON.stringify(body) }),
      ...(cache ? { cache } : {}),
      ...(credentials ? { credentials } : {}),
    },
    signal,
  );
  if (!response.ok) throw await apiFailure(response, fallback);
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch (error) {
    if (signal?.aborted) throw error;
    // SyntaxError can include fragments of a remote body. Keep those out of UI feedback.
    throw new ApiError(
      fallback,
      response.status,
      [{ code: "server_error", params: {}, path: [] }],
      "Invalid API response",
    );
  }
}

/**
 * Downloads a protected file. The bytes go to the caller (an object URL, an
 * offline copy) and never into the query cache.
 */
export async function ownerFile(
  session: OwnerSession,
  url: string,
  fallback: ErrorFallback,
  {
    method,
    body,
    signal,
    cache,
    credentials,
  }: Pick<OwnerRequest, "method" | "body" | "signal" | "cache" | "credentials"> = {},
): Promise<Blob> {
  const response = await authenticatedSend(
    session,
    url,
    {
      ...(method ? { method } : {}),
      headers:
        body === undefined
          ? authorization(session)
          : { ...authorization(session), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(cache ? { cache } : {}),
      ...(credentials ? { credentials } : {}),
    },
    signal,
  );
  if (!response.ok) throw await apiFailure(response, fallback);
  try {
    return await response.blob();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(fallback, 0);
  }
}

/** Opens a protected file in a new tab. */
export async function openOwnerFile(
  session: OwnerSession,
  url: string,
  fallback: ErrorFallback,
): Promise<void> {
  openBlobInNewTab(await ownerFile(session, url, fallback));
}

/** The server refused because other records still point at this one. */
export const isResourceInUse = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.descriptors.some((descriptor) => descriptor.code === "resource_in_use");
