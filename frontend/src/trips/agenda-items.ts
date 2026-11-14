import { m } from "../paraglide/messages.js";
import { addDays, localDate, wallClock } from "../dates";
import { areaName, routeTitle, stayInPlan, stayLabel, visitTitle } from "../records";
import type { PlanningStatus, Route, Stay, Visibility, Visit } from "../api-types";
import { routeLine } from "./routes/model";
import { stayLine } from "./stays/model";
import { visitLine } from "./visits/model";

export type AgendaRecordKind = "stay" | "route" | "visit";

/** The record a row stands for, so a row's actions can use it without looking it up again. */
export type AgendaRecord =
  | { kind: "stay"; value: Stay }
  | { kind: "route"; value: Route }
  | { kind: "visit"; value: Visit };

/** The `first` of what has no day yet: such an item sits in the "No day yet" group after every day. */
export const UNDATED = "";

export type AgendaItem = {
  id: string;
  recordKind: AgendaRecordKind;
  recordId: string;
  /** The whole record, for the actions a row offers. */
  record: AgendaRecord;
  kind: string;
  title: string;
  /** What the row says: the kind and title, or for a stay's later nights where the owner sleeps. */
  text: string;
  /** The day this item is listed under, or `UNDATED`. */
  first: string;
  /** The last day it also covers, for a route or visit that spans days; a stay lists each of its days itself. */
  last: string | null;
  /** The last day of the span the row names, shown beside the first. */
  through: string | null;
  time: string | null;
  where: string;
  /** The record's planning status. */
  status: PlanningStatus;
  /** Who the record is shared with. */
  visibility: Visibility;
  /**
   * The per-kind line the record's list shows, without status and visibility (they are fields of their own):
   * a stay's area, "no exact location yet", dates and nights; a route's mode, times, carrier and "with line"; a
   * visit's day, times and place.
   */
  line: string;
  /** For a stay: the check-in day, a later night or the check-out morning. */
  phase?: "check-in" | "night" | "check-out";
};

export const isUndated = (item: Pick<AgendaItem, "first">): boolean => item.first === UNDATED;

/**
 * A stay on every day it matters: the check-in day (with its range), each night after it as "sleeping in",
 * and the check-out morning, which adds no night. Only a stay in the plan sleeps anywhere; an idea or a
 * cancelled stay is listed on its check-in day alone. All arithmetic is on date-only strings.
 */
function stayItems(stay: Stay): AgendaItem[] {
  const base = {
    recordKind: "stay" as const,
    recordId: stay.id,
    record: { kind: "stay" as const, value: stay },
    kind: m.common_stay(),
    last: null,
    where: areaName(stay.area),
    status: stay.status,
    visibility: stay.visibility,
    line: stayLine(stay),
  };
  const place = stay.property_name ?? areaName(stay.area);
  const lastNight = addDays(stay.check_out_date, -1);
  const checkIn: AgendaItem = {
    ...base,
    id: `stay-${stay.id}`,
    title: stayLabel(stay),
    text: `${base.kind}: ${stayLabel(stay)}`,
    first: stay.check_in_date,
    through: lastNight,
    time: stay.check_in_time?.slice(0, 5) ?? null,
    phase: "check-in",
  };
  if (!stayInPlan(stay) || stay.check_out_date <= stay.check_in_date) return [checkIn];
  const nights: AgendaItem[] = [];
  for (
    let night = addDays(stay.check_in_date, 1);
    night < stay.check_out_date;
    night = addDays(night, 1)
  )
    nights.push({
      ...base,
      id: `stay-${stay.id}-night-${night}`,
      title: place,
      text: m.agenda_sleeping_in({ place }),
      first: night,
      through: null,
      time: null,
      phase: "night",
    });
  return [
    checkIn,
    ...nights,
    {
      ...base,
      id: `stay-${stay.id}-check-out`,
      title: place,
      text: m.agenda_check_out({ place }),
      first: stay.check_out_date,
      through: null,
      time: stay.check_out_time?.slice(0, 5) ?? null,
      phase: "check-out",
    },
  ];
}

/** A route is on its departure day, with a time only once it has one; with no day it is `UNDATED`. */
function routeItem(route: Route): AgendaItem {
  const arrival =
    route.departs_on && route.arrives_at
      ? localDate(route.arrives_at, route.arrival_timezone)
      : null;
  return {
    id: `route-${route.id}`,
    recordKind: "route",
    recordId: route.id,
    record: { kind: "route", value: route },
    kind: m.common_route(),
    title: routeTitle(route),
    text: `${m.common_route()}: ${routeTitle(route)}`,
    first: route.departs_on ?? UNDATED,
    last: arrival,
    through: arrival,
    time:
      route.departs_on && route.departs_at
        ? wallClock(route.departs_at, route.departure_timezone).slice(11, 16)
        : null,
    where: areaName(route.departure_area),
    status: route.status,
    visibility: route.visibility,
    line: routeLine(route),
  };
}

function visitItem(visit: Visit): AgendaItem {
  return {
    id: `visit-${visit.id}`,
    recordKind: "visit",
    recordId: visit.id,
    record: { kind: "visit", value: visit },
    kind: m.common_visit(),
    title: visitTitle(visit),
    text: `${m.common_visit()}: ${visitTitle(visit)}`,
    first: visit.starts_on ?? UNDATED,
    last: visit.starts_on ? visit.ends_on : null,
    through: visit.starts_on ? visit.ends_on : null,
    time: visit.starts_on ? (visit.start_time?.slice(0, 5) ?? null) : null,
    where: areaName(visit.area),
    status: visit.status,
    visibility: visit.visibility,
    line: visitLine(visit),
  };
}

/** Within a day: timed first; an untimed check-out is the morning's first thing, other untimed items come last. */
const sortTime = (item: AgendaItem) =>
  item.time ?? (item.phase === "check-out" ? "00:00" : "99:99");

/**
 * Every stay, route and visit as agenda rows: by day and time, then (as `UNDATED` rows) the visits and routes with
 * no day yet. A stay always has its days. The records come in their own meaningful order (stays by check-in day,
 * routes by day/time/creation, visits by day/time/creation); a stable sort keeps that order for same-day,
 * same-time ties instead of an opaque id breaking it arbitrarily.
 */
export function buildAgendaItems(stays: Stay[], routes: Route[], visits: Visit[]): AgendaItem[] {
  const stayRows = stays.flatMap(stayItems);
  const routeRows = routes.map(routeItem);
  const visitRows = visits.map(visitItem);
  const dated = [...stayRows, ...routeRows, ...visitRows]
    .filter((item) => !isUndated(item))
    .sort(
      (left, right) =>
        left.first.localeCompare(right.first) || sortTime(left).localeCompare(sortTime(right)),
    );
  // What has no day yet keeps visits before routes, each in the record's own order.
  return [...dated, ...visitRows.filter(isUndated), ...routeRows.filter(isUndated)];
}

/** The agenda's groups: each day in order with its rows, and the rows that have no day yet. */
export function groupAgendaItems(items: readonly AgendaItem[]): {
  days: [string, AgendaItem[]][];
  undated: AgendaItem[];
} {
  const days = new Map<string, AgendaItem[]>();
  for (const item of items)
    if (!isUndated(item)) days.set(item.first, [...(days.get(item.first) ?? []), item]);
  return { days: [...days], undated: items.filter(isUndated) };
}

/** The statuses the agenda filters by: what is in the plan, what is still an idea, what is cancelled. */
export type AgendaStatusGroup = "plan" | "idea" | "cancelled";

export const agendaStatusGroup = (status: PlanningStatus): AgendaStatusGroup =>
  status === "idea" ? "idea" : status === "cancelled" ? "cancelled" : "plan";

/** The rows of the given kinds; no kind chosen means every kind. */
export function filterAgendaByKind(
  items: readonly AgendaItem[],
  kinds: readonly AgendaRecordKind[],
): AgendaItem[] {
  return kinds.length ? items.filter((item) => kinds.includes(item.recordKind)) : [...items];
}

/** The rows with the given statuses; no status chosen means every status. */
export function filterAgendaByStatus(
  items: readonly AgendaItem[],
  groups: readonly AgendaStatusGroup[],
): AgendaItem[] {
  return groups.length
    ? items.filter((item) => groups.includes(agendaStatusGroup(item.status)))
    : [...items];
}

/** Both filters together, as the agenda's two toggle groups apply them. */
export const filterAgenda = (
  items: readonly AgendaItem[],
  filter: { kinds?: readonly AgendaRecordKind[]; statuses?: readonly AgendaStatusGroup[] },
): AgendaItem[] =>
  filterAgendaByStatus(filterAgendaByKind(items, filter.kinds ?? []), filter.statuses ?? []);
