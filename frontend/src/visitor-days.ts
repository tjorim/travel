import { dayjs } from "./dayjs";
import type { ProjectionRoute, ProjectionStay, ProjectionVisit } from "./projection-types";
import { addDays } from "./tracker-model";

/** Where one stay is on a given day: arriving, sleeping there (a night) or leaving. */
export type StayPhase = "check-in" | "night" | "check-out";

export type DayEntry =
  | { type: "visit"; key: string; item: ProjectionVisit; until: string | null }
  | { type: "stay"; key: string; item: ProjectionStay; phase: StayPhase }
  | { type: "route"; key: string; item: ProjectionRoute };

export type PlanDay = { date: string; entries: DayEntry[] };

export type PlanRecords = {
  visits: ProjectionVisit[];
  stays: ProjectionStay[];
  routes: ProjectionRoute[];
};

export type VisitorPlan = {
  /** One section per calendar day with at least one dated shared item; empty when no timeline is shown. */
  days: PlanDay[];
  /** What is not placed on a day (or everything, without a timeline), in the order the document delivers it. */
  other: PlanRecords;
  /** True when the delivered visits and stays are shared at month or year only, so no day can be shown. */
  daysNotShared: boolean;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A stay longer than this is not unrolled night by night; its check-in and check-out days still show. */
const MAX_NIGHTS = 400;

function text(value: string | null | undefined): string | null {
  return value || null;
}

/** A real calendar date, checked with plain UTC arithmetic so no time zone or DST shift can move it. */
export function isIsoDay(value: string | null): value is string {
  if (!value || !DAY.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/**
 * A date a record shares to the day. A month or year date, a date the record says is coarser than a day, or an
 * impossible date never places a record on a day.
 */
export function sharedDay(
  delivered: string | null | undefined,
  precisionOf: string | null | undefined,
): string | null {
  const value = text(delivered);
  const precision = text(precisionOf);
  return isIsoDay(value) && (precision === null || precision === "day") ? value : null;
}

/** The local calendar day of an instant in an IANA zone, or the browser's own when none was delivered. */
export function localDay(instant: string, timeZone: string | null): string | null {
  if (!dayjs(instant).isValid()) return null;
  try {
    return dayjs(instant)
      .tz(timeZone ?? undefined)
      .format("YYYY-MM-DD");
  } catch {
    return null;
  }
}

/**
 * The day a route departs, only when the document shares one: the day it carries at day precision, else the local day
 * of its delivered departure instant. A month or a year, or a day the route says is coarser, never places it.
 */
export function routeDepartureDay(route: ProjectionRoute): string | null {
  if (text(route.departs_on)) return sharedDay(route.departs_on, route.date_precision);
  const at = text(route.departs_at);
  return at ? localDay(at, text(route.departure_timezone)) : null;
}

/** Within a day: the morning's check-out, then departures, then visits, then where the traveller sleeps. */
const rank = (entry: DayEntry): number =>
  entry.type === "stay"
    ? entry.phase === "check-out"
      ? 0
      : entry.phase === "check-in"
        ? 3
        : 4
    : entry.type === "route"
      ? 1
      : 2;

/** A time only counts when the document delivers one; everything without it sorts after what has one. */
function entryTime(entry: DayEntry): string {
  if (entry.type === "visit") return text(entry.item.start_time) ?? "99:99";
  if (entry.type === "route") {
    const at = text(entry.item.departs_at);
    if (!at || !dayjs(at).isValid()) return "99:99";
    try {
      return dayjs(at)
        .tz(text(entry.item.departure_timezone) ?? undefined)
        .format("HH:mm");
    } catch {
      return "99:99";
    }
  }
  return "99:99";
}

/** True when this delivered visit or stay is shared at a coarser precision than a day. */
const coarse = (item: ProjectionVisit | ProjectionStay) => {
  const precision = text(item.date_precision);
  return precision === "month" || precision === "year";
};

/**
 * Groups the shared visits, stays and routes into a day-by-day plan where the document itself delivers days.
 *
 * Only delivered fields count. A visit or stay sits on a day only when it is shared at day precision with a real
 * date; a stay also sits on each night between its check-in and check-out, read from its own two delivered dates
 * alone. A route sits once, on its departure day, and only when it is shared at day precision. Month- and
 * year-precision records, undated records and routes without a day are never placed, ordered or counted into a day: they stay in `other`, with their own precision.
 * Nothing is derived from the order of records, from times that were not shared or from records the audience does
 * not receive.
 *
 * `separate` is what the Plan area lists (records not already shown with a story update). `all` is every visit and
 * stay the document delivers, used only to tell whether this audience is shown days at all.
 */
export function planByDay(
  separate: PlanRecords,
  all: Pick<PlanRecords, "visits" | "stays"> = separate,
): VisitorPlan {
  const placed = [...all.visits, ...all.stays];
  // A day on a visit's or stay's own record is what makes an audience a day audience; nothing else does.
  const showsDays = placed.some((item) => sharedDay(item.starts_on, item.date_precision));
  if (!showsDays) {
    return {
      days: [],
      other: separate,
      daysNotShared: placed.some(coarse),
    };
  }

  const byDay = new Map<string, DayEntry[]>();
  const add = (date: string, entry: DayEntry) =>
    byDay.set(date, [...(byDay.get(date) ?? []), entry]);
  const other: PlanRecords = { visits: [], stays: [], routes: [] };

  for (const visit of separate.visits) {
    const start = sharedDay(visit.starts_on, visit.date_precision);
    if (!start) {
      other.visits.push(visit);
      continue;
    }
    const end = sharedDay(visit.ends_on, visit.date_precision);
    add(start, {
      type: "visit",
      key: `visit-${visit.id}`,
      item: visit,
      until: end && end > start ? end : null,
    });
  }

  for (const stay of separate.stays) {
    const checkIn = sharedDay(stay.starts_on, stay.date_precision);
    if (!checkIn) {
      other.stays.push(stay);
      continue;
    }
    add(checkIn, { type: "stay", key: `stay-${stay.id}`, item: stay, phase: "check-in" });
    const checkOut = sharedDay(stay.ends_on, stay.date_precision);
    // The nights are exactly the days from check-in up to, not including, check-out, and no more than delivered.
    if (!checkOut || checkOut <= checkIn) continue;
    const nights: string[] = [];
    for (let night = addDays(checkIn, 1); night < checkOut; night = addDays(night, 1)) {
      nights.push(night);
      if (nights.length > MAX_NIGHTS) break;
    }
    if (nights.length <= MAX_NIGHTS)
      for (const night of nights)
        add(night, { type: "stay", key: `stay-${stay.id}-${night}`, item: stay, phase: "night" });
    add(checkOut, {
      type: "stay",
      key: `stay-${stay.id}-check-out`,
      item: stay,
      phase: "check-out",
    });
  }

  for (const route of separate.routes) {
    const date = routeDepartureDay(route);
    if (!date) {
      other.routes.push(route);
      continue;
    }
    add(date, { type: "route", key: `route-${route.id}`, item: route });
  }

  const days = [...byDay]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, entries]) => ({
      date,
      entries: [...entries].sort(
        (left, right) =>
          rank(left) - rank(right) || entryTime(left).localeCompare(entryTime(right)),
      ),
    }));
  return { days, other, daysNotShared: false };
}
