import { FeedbackError } from "./FeedbackError";
import { m } from "@/paraglide/messages.js";
import { descriptorMessage, type ErrorDescriptor } from "./error-messages";

export type ErrorFallback = string | (() => string);

/** A failed API call retains descriptors; messages are evaluated in the current locale. */
export class ApiError extends Error {
  readonly status: number;
  readonly descriptors: ErrorDescriptor[];
  readonly diagnostic: unknown;

  constructor(
    fallback: ErrorFallback,
    status: number,
    descriptors: ErrorDescriptor[] = [],
    diagnostic?: unknown,
  ) {
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
      if (path.length)
        fields[path.join(".")] = descriptorMessage(descriptor) ?? m.api_invalid_input();
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
    Object.values(descriptor.params).every(
      (part) => typeof part === "string" || typeof part === "number",
    )
  );
}

/** Diagnostic prose stays separate and is never rendered or used as a lookup key. */
export async function apiFailure(response: Response, fallback: ErrorFallback): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    detail?: unknown;
    errors?: unknown;
  } | null;
  const descriptors = Array.isArray(body?.errors) ? body.errors.filter(isDescriptor) : [];
  return new ApiError(fallback, response.status, descriptors, body?.detail);
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
