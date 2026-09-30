import { useState, type Dispatch, type SetStateAction } from "react";
import { useLocale } from "../locale";
import { errorMessage, type ErrorFallback } from "./api";

/** Store the thrown value, never a translated snapshot of an API failure. */
export type ErrorNotice = { error: unknown; fallback: ErrorFallback; suffix?: () => string };
export const errorNotice = (error: unknown, fallback: ErrorFallback, suffix?: () => string): ErrorNotice => ({
  error,
  fallback,
  suffix,
});
export function noticeMessage(value: string | ErrorNotice): string {
  return typeof value === "string" ? value : errorMessage(value.error, value.fallback) + (value.suffix?.() ?? "");
}

export function useFeedback<T extends string | null>(initial: T): [T, Dispatch<SetStateAction<T | ErrorNotice>>] {
  useLocale();
  const [value, setValue] = useState<T | ErrorNotice>(initial);
  return [typeof value === "object" && value !== null ? (noticeMessage(value) as T) : value, setValue];
}

/** Compose a local message without freezing the language at mutation time. */
export class FeedbackError extends Error {
  constructor(describe: () => string) {
    super();
    Object.defineProperty(this, "message", { get: describe });
  }
}
