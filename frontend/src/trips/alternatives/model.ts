import { m } from "../../paraglide/messages.js";
import { areaName, routeTitle, stayLabel, visitTitle } from "../../records";
import { daysBetween, formatDay } from "../../dates";
import {
  type AlternativeGroup,
  type AlternativeKind,
  type Route,
  type Stay,
  type Visit,
} from "../../api-types";
import { PLANNING_STATUS_LABELS, visitWhen } from "../labels";
import { routeShift, routeTimes } from "../routes/model";
import { locationLine } from "../stays/model";
import { visitPlace } from "../visits/model";

export type AlternativeRecord = Stay | Visit | Route;

/** One member of a group with the record it points at, whichever its kind. */
export type Member = { id: string; chosen: boolean; record: AlternativeRecord };

export function membersOf(group: AlternativeGroup): Member[] {
  return group.members.flatMap((member) => {
    const record = member.stay ?? member.visit ?? member.route;
    return record ? [{ id: member.record_id, chosen: member.chosen, record }] : [];
  });
}

/** The ids of every record that is in a group, so a list can tell grouped records from loose ones. */
export const groupedIds = (groups: AlternativeGroup[]): Set<string> =>
  new Set(groups.flatMap((group) => group.members.map((member) => member.record_id)));

export function recordTitle(kind: AlternativeKind, record: AlternativeRecord): string {
  if (kind === "stay") return stayLabel(record as Stay);
  if (kind === "visit") return visitTitle(record as Visit);
  return routeTitle(record as Route);
}

/** The first and last day a record covers, for naming and dating a group. */
function span(kind: AlternativeKind, record: AlternativeRecord): [string, string] | null {
  if (kind === "stay") return [(record as Stay).check_in_date, (record as Stay).check_out_date];
  if (kind === "visit") {
    const visit = record as Visit;
    return visit.starts_on ? [visit.starts_on, visit.ends_on ?? visit.starts_on] : null;
  }
  const day = (record as Route).departs_on;
  return day ? [day, day] : null;
}

/** "1 Apr → 4 Apr", or one day, or nothing when no member has a day. */
export function spanLabel(kind: AlternativeKind, records: AlternativeRecord[]): string {
  const spans = records.flatMap((record) => span(kind, record) ?? []);
  if (!spans.length) return "";
  const first = spans.reduce((a, b) => (a < b ? a : b));
  const last = spans.reduce((a, b) => (a > b ? a : b));
  return first === last ? formatDay(first) : `${formatDay(first)} → ${formatDay(last)}`;
}

export const groupTitle = (group: AlternativeGroup): string => {
  if (group.label) return group.label;
  const dates = spanLabel(
    group.kind,
    membersOf(group).map((member) => member.record),
  );
  return dates ? m.owner_alternatives_default_title({ dates }) : m.owner_alternatives_heading();
};

/** The one line that tells a member apart: where, when and how settled. */
export function recordDetail(kind: AlternativeKind, record: AlternativeRecord): string {
  const parts: (string | null)[] = [];
  if (kind === "stay") {
    const stay = record as Stay;
    parts.push(
      stay.area.label ? areaName(stay.area) : null,
      `${formatDay(stay.check_in_date)} → ${formatDay(stay.check_out_date)}`,
      m.owner_night_count({ count: daysBetween(stay.check_in_date, stay.check_out_date) }),
      PLANNING_STATUS_LABELS[stay.status],
    );
  } else if (kind === "visit") {
    const visit = record as Visit;
    parts.push(visitWhen(visit), visitPlace(visit), PLANNING_STATUS_LABELS[visit.status]);
  } else {
    const route = record as Route;
    parts.push(
      [routeTimes(route), routeShift(route)].filter(Boolean).join(""),
      route.carrier,
      PLANNING_STATUS_LABELS[route.status],
    );
  }
  return parts.filter(Boolean).join(" · ");
}

export type ComparisonRow = { label: string; values: string[] };

type Column<T> = [label: string, value: (record: T) => string | null | undefined];

const table = <T>(records: T[], columns: Column<T>[]): ComparisonRow[] =>
  columns.map(([label, value]) => ({
    label,
    values: records.map((record) => value(record) || "—"),
  }));

const stayRows = (stays: Stay[]) =>
  table<Stay>(stays, [
    [m.owner_compare_name(), stayLabel],
    [m.owner_compare_area(), (stay) => areaName(stay.area)],
    [
      m.owner_compare_exact_location(),
      (stay) =>
        stay.location
          ? [locationLine(stay.location), stay.location.address_line1].filter(Boolean).join(" · ")
          : m.owner_no_exact_location_yet(),
    ],
    [
      m.owner_compare_dates(),
      (stay) => `${formatDay(stay.check_in_date)} → ${formatDay(stay.check_out_date)}`,
    ],
    [
      m.owner_compare_nights(),
      (stay) => String(daysBetween(stay.check_in_date, stay.check_out_date)),
    ],
    [m.owner_compare_status(), (stay) => PLANNING_STATUS_LABELS[stay.status]],
    [m.owner_compare_website(), (stay) => stay.website_url],
    [m.owner_compare_notes(), (stay) => stay.notes],
  ]);

const visitRows = (visits: Visit[]) =>
  table<Visit>(visits, [
    [m.owner_compare_name(), visitTitle],
    [m.owner_compare_area(), (visit) => areaName(visit.area)],
    [m.owner_compare_exact_location(), visitPlace],
    [m.owner_compare_dates(), visitWhen],
    [m.owner_compare_status(), (visit) => PLANNING_STATUS_LABELS[visit.status]],
    [m.owner_compare_notes(), (visit) => visit.notes],
  ]);

const routeRows = (routes: Route[]) =>
  table<Route>(routes, [
    [m.owner_compare_name(), routeTitle],
    [m.owner_compare_dates(), routeTimes],
    [m.owner_compare_carrier(), (route) => route.carrier],
    [m.owner_compare_status(), (route) => PLANNING_STATUS_LABELS[route.status]],
    [m.owner_compare_notes(), (route) => route.notes],
  ]);

/**
 * The rows of the side-by-side comparison. Owner-only, so exact locations and notes are shown as
 * saved: the public precision rules never apply to the owner's own views.
 */
export function comparisonRows(
  kind: AlternativeKind,
  records: AlternativeRecord[],
): ComparisonRow[] {
  if (kind === "stay") return stayRows(records as Stay[]);
  if (kind === "visit") return visitRows(records as Visit[]);
  return routeRows(records as Route[]);
}
