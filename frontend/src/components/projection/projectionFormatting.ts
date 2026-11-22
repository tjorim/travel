import type { DatePrecision, ProjectionArea, ProjectionRoute, ProjectionVisit } from "@/api-types";
import { selectedLocale } from "@/i18n/locale";
import { dayjs } from "@/lib/dayjs";
import { timeForViewer, zoneName } from "@/lib/dates";
import { ROUTE_MODE_LABELS } from "@/lib/records";
import { m } from "@/paraglide/messages.js";

/** A delivered string, or null when it is missing or empty. */
export function text(value: string | null | undefined): string | null {
  return value || null;
}

/** A country's name in the selected language; the delivered code when the runtime cannot name it. */
export function country(item: { country_code?: string | null }): string | null {
  const code = text(item.country_code);
  if (!code) return null;
  try {
    return new Intl.DisplayNames([selectedLocale()], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function place(area: ProjectionArea | null | undefined): string | null {
  if (!area) return null;
  return [text(area.label), text(area.region), country(area)].filter(Boolean).join(" · ") || null;
}

export function precision(item: { date_precision?: string | null }): string | null {
  const value = text(item.date_precision);
  return value === "day"
    ? m.visitor_day_precision()
    : value === "month"
      ? m.visitor_month_precision()
      : value === "year"
        ? m.visitor_year_precision()
        : null;
}

export function transportPlace(area: ProjectionArea | null | undefined): string | null {
  if (!area) return null;
  const names = [text(area.label), text(area.region)];
  return names.some(Boolean)
    ? [...names, country(area)].filter(Boolean).join(" · ")
    : country(area);
}

export function transportTime(
  item: ProjectionRoute,
  endpoint: "departure" | "arrival",
): string | null {
  const value = text(endpoint === "departure" ? item.departs_at : item.arrives_at);
  if (!value || !dayjs(value).isValid()) return null;
  const timeZone = text(endpoint === "departure" ? item.departure_timezone : item.arrival_timezone);
  try {
    return dayjs(value)
      .tz(timeZone ?? undefined)
      .locale(selectedLocale())
      .format("D MMM YYYY, HH:mm");
  } catch {
    return dayjs(value).locale(selectedLocale()).format("D MMM YYYY, HH:mm");
  }
}

export const transportKinds = (): Record<string, string> => ({
  ...ROUTE_MODE_LABELS,
  other: m.visitor_transport(),
});
export const transportStatuses = (): Record<string, string> => ({
  planned: m.visitor_planned(),
  confirmed: m.visitor_confirmed(),
  cancelled: m.visitor_cancelled(),
});

/**
 * A date delivered as a day, a month or a year, written in the selected language; null for an impossible date or one
 * that disagrees with its own precision. Without a precision, the length of the date says it.
 */
export function storyDate(
  delivered: string | null | undefined,
  precisionOf: string | null | undefined,
): string | null {
  const value = text(delivered);
  const precisionValue =
    text(precisionOf) ??
    ({ 4: "year", 7: "month", 10: "day" } as Record<number, string>)[value?.length ?? 0];
  if (!value || !/^(\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2})$/.test(value)) return null;
  if (
    (precisionValue === "day" && value.length !== 10) ||
    (precisionValue === "month" && value.length !== 7) ||
    (precisionValue === "year" && value.length !== 4)
  )
    return null;
  const [year, month, day] = value.split("-").map(Number);
  if (month && (month < 1 || month > 12)) return null;
  const yearMonth = dayjs.utc(`${year}-${String(month ?? 1).padStart(2, "0")}-01`);
  if (day && (day < 1 || day > yearMonth.daysInMonth())) return null;
  const date = (day ? yearMonth.date(day) : yearMonth).locale(selectedLocale());
  return precisionValue === "year"
    ? date.format("YYYY")
    : precisionValue === "month"
      ? date.format("MMMM YYYY")
      : date.format("D MMMM YYYY");
}

/** The dates a record states about itself: its own range, with the precision it was shared at. */
type DateRange = {
  starts_on?: string | null;
  ends_on?: string | null;
  date_precision?: DatePrecision | null;
};

/** "november 2026 – december 2026" at whatever precision the owner shared. */
export function tripDates(dates: DateRange | null | undefined): string | null {
  if (!dates) return null;
  const [start, end] = [
    storyDate(dates.starts_on, dates.date_precision),
    storyDate(dates.ends_on, dates.date_precision),
  ];
  return start && end && start !== end ? `${start} – ${end}` : (start ?? end);
}

/** A shared visit time: local at the visit, with the viewer's own time when that differs. */
export function visitTimes(item: ProjectionVisit): string | null {
  const start = text(item.start_time);
  if (!start) return null;
  const end = text(item.end_time);
  const zone = text(item.timezone);
  const date = text(item.starts_on);
  const local = `${start}${end ? `–${end}` : ""}${zone ? ` (${zoneName(zone)})` : ""}`;
  const there = zone && date ? timeForViewer(date, start, zone) : null;
  if (!there) return local;
  const thereEnd = end && zone && date ? timeForViewer(date, end, zone) : null;
  const viewer = `${there.time}${thereEnd ? `–${thereEnd.time}` : ""}`;
  return there.days === 1
    ? m.visitor_time_next({ local, viewer })
    : there.days === -1
      ? m.visitor_time_previous({ local, viewer })
      : m.visitor_time_same({ local, viewer });
}

export function routeHeading(item: ProjectionRoute): string {
  return (
    text(item.label) ??
    ([text(item.carrier), text(item.service_reference)].filter(Boolean).join(" · ") ||
      transportKinds()[text(item.mode) ?? ""] ||
      m.visitor_route())
  );
}
