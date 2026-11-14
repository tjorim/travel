import type { Location, PresetRecordRef, Route, RouteMode, Stay, Visit } from "./api-types";
import { formatDay } from "./dates";
import { m } from "./paraglide/messages.js";

/** What the owner calls a location: the first part of its name, never a full address line. */
export const locationName = (
  place: Partial<Pick<Location, "display_name" | "locality" | "label">>,
): string =>
  place.label ||
  place.display_name?.split(",")[0]?.trim() ||
  place.locality ||
  m.records_unnamed_location();
/** What the owner sees a location called: the first part of its display name, else `locationName`. */
export const ownerLocationName = (place: Location) =>
  place.display_name?.split(",")[0]?.trim() || locationName(place);

/** An area's name, or the translated fallback when the owner left it unnamed. */
export const areaName = (area: { label?: string | null }): string =>
  area.label ?? m.records_unnamed_area();

export const ROUTE_MODE_LABELS: Record<RouteMode, string> = {
  get flight() {
    return m.records_flight();
  },
  get train() {
    return m.records_train();
  },
  get bus() {
    return m.records_bus();
  },
  get ferry() {
    return m.records_ferry();
  },
  get car() {
    return m.records_car();
  },
  get bike() {
    return m.records_bike();
  },
  get walk() {
    return m.records_on_foot();
  },
  get other() {
    return m.common_other();
  },
};

/** A route whose schedule is known. */
export type TimedRoute = Route & { departs_at: string; arrives_at: string };
export const timedRoutes = (routes: Route[]): TimedRoute[] =>
  routes.filter(
    (route): route is TimedRoute => route.departs_at !== null && route.arrives_at !== null,
  );

/** What a route is called: its label, else where it goes. */
export const routeTitle = (
  route: Pick<Route, "label" | "departure_area" | "arrival_area">,
): string => route.label ?? `${areaName(route.departure_area)} → ${areaName(route.arrival_area)}`;

/** What a visit is called: its title, else its location, else its area. */
export const visitTitle = (visit: Pick<Visit, "title" | "area" | "location">): string =>
  visit.title ?? (visit.location ? locationName(visit.location) : areaName(visit.area));

/** The owner's name for a record in a review, with its day when the name alone does not tell records apart. */
export function presetRecordName(record: PresetRecordRef, fallback: string): string {
  const name = record.label || fallback;
  return record.day ? `${name} · ${formatDay(record.day, "D MMM YYYY")}` : name;
}

/** Whether a stay is part of the plan: neither a candidate still being compared nor cancelled. */
export const stayInPlan = (stay: Pick<Stay, "status">): boolean =>
  stay.status !== "idea" && stay.status !== "cancelled";

/** Whether a route is part of the plan: neither a candidate still being compared nor cancelled. */
export const routeInPlan = (route: Pick<Route, "status">): boolean =>
  route.status !== "idea" && route.status !== "cancelled";

/** Two routes are alternatives for one journey when they join the same areas on the same day. */
export const sameJourney = (left: Route, right: Route): boolean =>
  left.departure_area.id === right.departure_area.id &&
  left.arrival_area.id === right.arrival_area.id &&
  left.departs_on === right.departs_on;

/** A stay covers the night of ``isoDate`` when it sleeps there that evening. */
export function stayCoversNight(stay: Stay, isoDate: string): boolean {
  return stayInPlan(stay) && stay.check_in_date <= isoDate && isoDate < stay.check_out_date;
}

export function stayLabel(stay: Stay): string {
  return stay.property_name ?? m.records_still_to_choose_in({ area: areaName(stay.area) });
}
