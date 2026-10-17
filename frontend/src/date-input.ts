/**
 * Reading and writing the dates and times typed into the owner forms. The browser draws native date and
 * time inputs in its own locale, so these helpers keep the visible text in the app's locale while the forms
 * and the API keep their machine values: `YYYY-MM-DD`, `HH:mm` and `YYYY-MM-DDTHH:mm`.
 */
import { dayjs } from "./dayjs";
import type { Locale } from "./paraglide/runtime.js";

const pad = (value: number) => String(value).padStart(2, "0");

const isoDate = (year: number, month: number, day: number): string | null => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
};

let monthNames: Map<string, number> | null = null;
/** Month names and abbreviations in both interface languages, so "mrt", "Mar" and "maart" all read as March. */
function monthNumber(word: string): number | null {
  if (!monthNames) {
    monthNames = new Map();
    for (const language of ["nl", "en"])
      for (const style of ["long", "short"] as const) {
        const format = new Intl.DateTimeFormat(language, { month: style, timeZone: "UTC" });
        for (let month = 1; month <= 12; month++)
          monthNames.set(
            format
              .format(Date.UTC(2026, month - 1, 1))
              .toLowerCase()
              .replace(/\.$/, ""),
            month,
          );
      }
  }
  const name = word.toLowerCase();
  const exact = monthNames.get(name);
  if (exact) return exact;
  if (name.length < 3) return null;
  const matches = new Set(
    [...monthNames].filter(([known]) => known.startsWith(name)).map(([, month]) => month),
  );
  return matches.size === 1 ? [...matches][0] : null;
}

/**
 * The ISO date for typed text, or `null` when it is not a real date. Accepts the displayed form
 * ("16 nov 2026", "16 november 2026"), day-first numbers ("16-11-2026", "16/11/2026", "16.11.2026") and ISO.
 */
export function parseDateInput(text: string): string | null {
  const value = text.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  match = /^(\d{1,2})[\s.-]*(\p{L}{3,})\.?[\s,.-]*(\d{4})$/u.exec(value);
  if (!match) return null;
  const month = monthNumber(match[2]);
  return month ? isoDate(Number(match[3]), month, Number(match[1])) : null;
}

/** An ISO date as shown in the field: "16 nov 2026" in Dutch, "16 Nov 2026" in English. */
export const formatDateInput = (iso: string, locale: Locale): string =>
  iso ? dayjs.utc(iso).locale(locale).format("D MMM YYYY") : "";

/**
 * `HH:mm` for typed text, or `null`. Reads "18:30", "18.30", "1830", "9:30" and "18" (on the hour), and
 * "6:30 pm" for people used to a 12-hour clock.
 */
export function parseTimeInput(text: string): string | null {
  const match = /^(\d{1,2})(?:[:.h\s]?(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(text.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (match[3]) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (match[3][0].toLowerCase() === "p" ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

/** A stored time ("18:30" or "18:30:00") as shown in the field: always a 24-hour clock. */
export const formatTimeInput = (time: string): string => time.slice(0, 5);

/** Splits `YYYY-MM-DDTHH:mm` into the date and time parts; either is empty when missing. */
export function splitDateTime(value: string): { date: string; time: string } {
  const [date = "", time = ""] = value.split("T");
  return { date, time: time.slice(0, 5) };
}

/** The date-time value when both parts are valid, else an empty string. */
export const joinDateTime = (date: string, time: string): string =>
  date && time ? `${date}T${time}` : "";

/** `YYYY-MM-DD` to a local-midnight `Date` for the calendar, and back. */
export const dateFromIso = (iso: string): Date | undefined => {
  const [year, month, day] = iso.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : undefined;
};
export const isoFromDate = (date: Date): string =>
  `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
