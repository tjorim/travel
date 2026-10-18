import { useState, type Dispatch, type SetStateAction } from "react";
import { useLocale } from "../locale";
import { errorMessage, type ErrorFallback } from "./api";

/** Store the thrown value, never a translated snapshot of an API failure. */
export type ErrorNotice = { error: unknown; fallback: ErrorFallback; suffix?: () => string };
export const errorNotice = (
  error: unknown,
  fallback: ErrorFallback,
  suffix?: () => string,
): ErrorNotice => ({
  error,
  fallback,
  suffix,
});
export type MessageNotice = { message: () => string };
export const textNotice = (message: () => string): MessageNotice => ({ message });

/** Anything a feedback state accepts: plain text, a message to translate later, or a thrown error. */
export type Notice = string | null | ErrorNotice | MessageNotice;

export function noticeMessage(value: string | ErrorNotice | MessageNotice): string {
  return typeof value === "string"
    ? value
    : "message" in value
      ? value.message()
      : errorMessage(value.error, value.fallback) + (value.suffix?.() ?? "");
}

export function useFeedback<T extends string | null>(
  initial: T | MessageNotice,
): [T, Dispatch<SetStateAction<T | ErrorNotice | MessageNotice>>] {
  useLocale();
  const [value, setValue] = useState<T | ErrorNotice | MessageNotice>(initial);
  return [
    typeof value === "object" && value !== null ? (noticeMessage(value) as T) : (value as T),
    setValue,
  ];
}

export { FeedbackError } from "./FeedbackError";
