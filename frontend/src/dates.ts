import type { TravelUpdate } from "./api-types";
import { dayjs } from "./dayjs";
import { m } from "./paraglide/messages.js";

const dayMs = 86_400_000;

/**
 * Add whole days to an ISO calendar date without any time-zone drift. Plain `Date` arithmetic
 * here, not dayjs: this runs in per-night loops (`tripBadges`, `nextAction`) over a trip's full
 * span, and dayjs's object-per-call overhead turns a multi-year trip into a multi-second render.
 */
export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);
}

export function formatDay(isoDate: string, format = "D MMM"): string {
  return dayjs.utc(isoDate).format(format);
}

export function formatDayRange(first: string, last: string | null): string {
  return last && last !== first ? `${formatDay(first)} – ${formatDay(last)}` : formatDay(first);
}

/** An instant as the app displays it everywhere: "16 nov 2026, 14:32". */
export function formatInstant(instant: string | number): string {
  return dayjs(instant).format("D MMM YYYY, HH:mm");
}

/**
 * A media capture time. A camera wall-clock time (EXIF carries no zone) keeps its written clock in every
 * viewer zone; any other value is an instant shown in the viewer's zone.
 */
export function formatCapture(value: string, local: boolean, format = "D MMM YYYY, HH:mm"): string {
  return local ? dayjs.utc(value).format(format) : dayjs(value).format(format);
}

/** A capture time as a `YYYY-MM-DDTHH:mm` form value, in the same clock `formatCapture` shows. */
export function captureInputValue(value: string, local: boolean): string {
  return local ? dayjs.utc(value).format("YYYY-MM-DDTHH:mm") : localDateTime(new Date(value));
}

/** An instant's calendar date only, no time: "16 nov 2026". */
export function formatInstantDate(instant: string): string {
  return dayjs(instant).format("D MMM YYYY");
}

/**
 * A reisupdate's instant read in the zone the server derived for it (`timezone`: its area's, else the trip's
 * nearest stay or visit, else UTC), so the owner sees the same day a visitor is given (the backend's
 * `update_day`), whatever zone the browser is in.
 */
function inUpdateZone(update: Pick<TravelUpdate, "occurred_at" | "timezone">) {
  try {
    return dayjs(update.occurred_at).tz(update.timezone);
  } catch {
    // A zone name this browser does not know: read the instant in UTC, as the server does without a zone.
    return dayjs.utc(update.occurred_at);
  }
}

/** A reisupdate's date and time, "16 nov 2026, 14:32", on the day of its zone. */
export function formatUpdateInstant(
  update: Pick<TravelUpdate, "occurred_at" | "timezone">,
): string {
  return inUpdateZone(update).format("D MMM YYYY, HH:mm");
}

/** A reisupdate's date at its own precision, e.g. "14 maart 2026" or just "2026" — never the raw enum. */
export function updateDateLabel(
  update: Pick<TravelUpdate, "occurred_at" | "timezone" | "share_date_precision">,
): string {
  if (update.share_date_precision === "year") return inUpdateZone(update).format("YYYY");
  if (update.share_date_precision === "month") return inUpdateZone(update).format("MMMM YYYY");
  return formatUpdateInstant(update);
}

/**
 * A reisupdate's time as a `YYYY-MM-DDTHH:mm` form value: the wall clock in the update's own zone, which the
 * server reads back in that same zone when the form sends it without an offset.
 */
export function updateWallClock(update: Pick<TravelUpdate, "occurred_at" | "timezone">): string {
  return inUpdateZone(update).format("YYYY-MM-DDTHH:mm");
}

export function browserTimeZone(): string {
  return dayjs.tz.guess();
}

export function timeZoneOptions(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  return intl.supportedValuesOf?.("timeZone") ?? [browserTimeZone()];
}

/** ``YYYY-MM-DDTHH:mm`` for a datetime-local input showing the zone's local time. */
export function wallClock(instant: string, timeZone: string | null): string {
  return dayjs(instant)
    .tz(timeZone ?? undefined)
    .format("YYYY-MM-DDTHH:mm");
}

export function localDate(instant: string, timeZone: string | null): string {
  return wallClock(instant, timeZone).slice(0, 10);
}

/**
 * A local time at a visit, as a viewer elsewhere would read it: `null` when the viewer's clock says
 * the same, else their time and how many days off their date is (-1, 0 or 1).
 */
export function timeForViewer(
  date: string,
  time: string,
  zone: string,
  viewerZone = browserTimeZone(),
): { time: string; days: number } | null {
  try {
    const at = dayjs.tz(`${date}T${time.slice(0, 5)}`, zone);
    if (!at.isValid()) return null;
    const there = at.tz(viewerZone);
    if (there.format("YYYY-MM-DDTHH:mm") === `${date}T${time.slice(0, 5)}`) return null;
    return { time: there.format("HH:mm"), days: daysBetween(date, there.format("YYYY-MM-DD")) };
  } catch {
    return null;
  }
}

/** The city part of an IANA zone name: "Asia/Taipei" reads as "Taipei". */
export const zoneName = (zone: string): string =>
  zone.split("/").pop()?.replaceAll("_", " ") ?? zone;

/** Minutes a zone is ahead of UTC at an instant, daylight saving included. */
export function utcOffsetMinutes(instant: string, timeZone: string | null): number {
  return dayjs(instant)
    .tz(timeZone ?? undefined)
    .utcOffset();
}

/** "7 u later dan hier", "1 u 30 min eerder dan hier" or "zelfde tijd als hier". */
export function offsetLabel(minutes: number, compact = false): string {
  if (minutes === 0) return m.dates_same_time_as_here();
  const hours = Math.floor(Math.abs(minutes) / 60),
    rest = Math.abs(minutes) % 60;
  if (compact) {
    if (minutes > 0)
      return hours && rest
        ? m.dates_offset_short_ahead({ hours, minutes: rest })
        : hours
          ? m.dates_offset_hours_short_ahead({ hours })
          : m.dates_offset_minutes_short_ahead({ minutes: rest });
    return hours && rest
      ? m.dates_offset_short_behind({ hours, minutes: rest })
      : hours
        ? m.dates_offset_hours_short_behind({ hours })
        : m.dates_offset_minutes_short_behind({ minutes: rest });
  }
  if (minutes > 0)
    return hours && rest
      ? m.dates_offset_ahead({ hours, minutes: rest })
      : hours
        ? m.dates_offset_hours_ahead({ hours })
        : m.dates_offset_minutes_ahead({ minutes: rest });
  return hours && rest
    ? m.dates_offset_behind({ hours, minutes: rest })
    : hours
      ? m.dates_offset_hours_behind({ hours })
      : m.dates_offset_minutes_behind({ minutes: rest });
}

export function localDateTime(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}
