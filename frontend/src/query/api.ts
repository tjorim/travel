import { FeedbackError } from "./FeedbackError";
import type { TrackerSession } from "../auth";
import { openBlobInNewTab } from "../tracker-model";

import { m } from "../paraglide/messages.js";
import { descriptorMessage, type ErrorDescriptor } from "./error-messages";

export type ErrorFallback = string | (() => string);

/** A failed API call retains descriptors; messages are evaluated in the current locale. */
export class ApiError extends Error {
  readonly status: number;
  readonly descriptors: ErrorDescriptor[];
  readonly diagnostic: unknown;

  constructor(fallback: ErrorFallback, status: number, descriptors: ErrorDescriptor[] = [], diagnostic?: unknown) {
    super(typeof fallback === "string" ? fallback : "");
    this.name = "ApiError";
    this.status = status;
    this.descriptors = descriptors;
    this.diagnostic = diagnostic;
    // Error's own data property would otherwise hide the locale-aware getter.
    Object.defineProperty(this, "message", { get: () => this.localizedMessage(fallback) });
  }

  localizedMessage(fallback?: ErrorFallback): string {
    if (this.status === 0) return m.api_offline();
    if (this.status === 401) return m.api_unauthorized();
    const messages = this.descriptors.map(descriptorMessage);
    if (messages.length && messages.every((message) => message !== null)) return messages.join(" ");
    const operation = typeof fallback === "function" ? fallback() : m.api_operation_failed();
    return this.status >= 500
      ? `${typeof fallback === "function" ? operation + " " : ""}${m.api_server_error()}`
      : operation;
  }

  get fieldErrors(): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const descriptor of this.descriptors) {
      const path = descriptor.path.filter(
        (part, index) => index !== 0 || !["body", "query", "path"].includes(String(part)),
      );
      if (path.length) fields[path.join(".")] = descriptorMessage(descriptor) ?? m.api_invalid_input();
    }
    return fields;
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

/** The server refused because other records still point at this one. */
export const isResourceInUse = (error: unknown): boolean =>
  error instanceof ApiError && error.descriptors.some((descriptor) => descriptor.code === "resource_in_use");

function isDescriptor(value: unknown): value is ErrorDescriptor {
  if (!value || typeof value !== "object") return false;
  const descriptor = value as ErrorDescriptor;
  return (
    typeof descriptor.code === "string" &&
    Array.isArray(descriptor.path) &&
    descriptor.path.every((part) => typeof part === "string" || typeof part === "number") &&
    !!descriptor.params &&
    typeof descriptor.params === "object" &&
    !Array.isArray(descriptor.params) &&
    Object.values(descriptor.params).every((part) => typeof part === "string" || typeof part === "number")
  );
}

/** Diagnostic prose stays separate and is never rendered or used as a lookup key. */
export async function apiFailure(response: Response, fallback: ErrorFallback): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { detail?: unknown; errors?: unknown } | null;
  const descriptors = Array.isArray(body?.errors) ? body.errors.filter(isDescriptor) : [];
  return new ApiError(fallback, response.status, descriptors, body?.detail);
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
    throw new ApiError("", 0);
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
  fallback: ErrorFallback,
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
  session: TrackerSession,
  url: string,
  fallback: ErrorFallback,
  { signal, cache, credentials }: Pick<OwnerRequest, "signal" | "cache" | "credentials"> = {},
): Promise<Blob> {
  const response = await send(
    url,
    { headers: authorization(session), ...(cache ? { cache } : {}), ...(credentials ? { credentials } : {}) },
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
export async function openOwnerFile(session: TrackerSession, url: string, fallback: ErrorFallback): Promise<void> {
  openBlobInNewTab(await ownerFile(session, url, fallback));
}

/** The message to show for any thrown value. */
export function errorMessage(error: unknown, fallback: ErrorFallback): string {
  return error instanceof ApiError
    ? error.localizedMessage(fallback)
    : error instanceof FeedbackError
      ? error.message
      : typeof fallback === "function"
        ? fallback()
        : fallback;
}
