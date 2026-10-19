import { dayjs } from "../../dayjs";
import { m } from "../../paraglide/messages.js";
import {
  browserTimeZone,
  daysBetween,
  formatDay,
  locationName,
  localDate,
  sameJourney,
  wallClock,
  type Area,
  type Location,
  type Route,
  type RouteMode,
  type TimedRoute,
} from "../../tracker-model";
import { hasPlace, emptyPlace, placeOf, type PlaceValue } from "../PlacePicker";
import type { RouteCoordinate } from "../RouteGeometryEditor";
import type { FormContext } from "../../forms/form-context";

/** "16 nov 10:40" in the end's own zone (browser zone when none is known). */
export function endpointTime(instant: string, timeZone: string | null): string {
  return dayjs(instant)
    .tz(timeZone ?? undefined)
    .format("D MMM HH:mm");
}

/** The archive's "+1 dag": calendar days between local departure and arrival. */
export function dayShift(
  route: Pick<TimedRoute, "departs_at" | "arrives_at" | "departure_timezone" | "arrival_timezone">,
): number {
  return daysBetween(
    localDate(route.departs_at, route.departure_timezone),
    localDate(route.arrives_at, route.arrival_timezone),
  );
}

export type Values = {
  mode: RouteMode;
  status: Route["status"];
  label: string;
  departure: PlaceValue;
  arrival: PlaceValue;
  departsOn: string;
  departsAt: string;
  arrivesAt: string;
  departureTimezone: string;
  arrivalTimezone: string;
  carrier: string;
  serviceReference: string;
  travelClass: string;
  bookingReference: string;
  notes: string;
  documentAssetIds: string[];
  /** The drawn line as JSON text; empty when the route has none. */
  coordinates: string;
};

const NOT_ENOUGH_POINTS = m.owner_a_line_needs_at_least_two_points;

/** The line's points, or the message explaining why the text is not a usable line. */
export function parseCoordinates(text: string): [number, number][] | string {
  let coordinates: unknown;
  try {
    coordinates = JSON.parse(text);
  } catch {
    return m.owner_use_valid_json_with_at_least_two_longitude_latitude_pairs();
  }
  if (
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    coordinates.some(
      (point) =>
        !Array.isArray(point) ||
        point.length !== 2 ||
        point.some((value) => typeof value !== "number"),
    )
  )
    return NOT_ENOUGH_POINTS();
  return coordinates as [number, number][];
}
export const validCoordinates = ({ value }: { value: string }) => {
  if (!value.trim()) return undefined;
  const parsed = parseCoordinates(value);
  return typeof parsed === "string" ? () => parseCoordinates(value) as string : undefined;
};
export const editableCoordinates = (value: string): RouteCoordinate[] => {
  if (!value.trim()) return [];
  const parsed = parseCoordinates(value);
  return typeof parsed === "string" ? [] : parsed;
};

export function blank(): Values {
  return {
    mode: "train",
    status: "planned",
    label: "",
    departure: emptyPlace(),
    arrival: emptyPlace(),
    departsOn: "",
    departsAt: "",
    arrivesAt: "",
    departureTimezone: browserTimeZone(),
    arrivalTimezone: browserTimeZone(),
    carrier: "",
    serviceReference: "",
    travelClass: "",
    bookingReference: "",
    notes: "",
    documentAssetIds: [],
    coordinates: "",
  };
}

export const fromRoute = (route: Route): Values => ({
  mode: route.mode,
  status: route.status,
  label: route.label ?? "",
  departure: placeOf(route.departure_area, route.departure_location),
  arrival: placeOf(route.arrival_area, route.arrival_location),
  departsOn: route.departs_on ?? "",
  departsAt: route.departs_at ? wallClock(route.departs_at, route.departure_timezone) : "",
  arrivesAt: route.arrives_at ? wallClock(route.arrives_at, route.arrival_timezone) : "",
  departureTimezone: route.departure_timezone ?? browserTimeZone(),
  arrivalTimezone: route.arrival_timezone ?? browserTimeZone(),
  carrier: route.carrier ?? "",
  serviceReference: route.service_reference ?? "",
  travelClass: route.travel_class ?? "",
  bookingReference: route.booking_reference ?? "",
  notes: route.notes ?? "",
  documentAssetIds: [...route.document_asset_ids],
  coordinates: route.geometry ? JSON.stringify(route.geometry.coordinates) : "",
});

export const serverFields = {
  mode: "mode",
  status: "status",
  label: "label",
  departs_on: "departsOn",
  departs_at: "departsAt",
  arrives_at: "arrivesAt",
  departure_timezone: "departureTimezone",
  arrival_timezone: "arrivalTimezone",
  carrier: "carrier",
  service_reference: "serviceReference",
  travel_class: "travelClass",
  booking_reference: "bookingReference",
  notes: "notes",
  geometry: "coordinates",
};

export const departureChosen = ({ value }: { value: PlaceValue }) =>
  hasPlace(value) ? undefined : m.owner_choose_where_the_route_starts_an_area_or_location;
export const arrivalChosen = ({ value, fieldApi }: { value: PlaceValue } & FormContext) => {
  if (!hasPlace(value)) return m.owner_choose_where_the_route_ends_an_area_or_location;
  const departure = fieldApi.form.getFieldValue("departure" as never) as PlaceValue | undefined;
  // A route between the very same area or location goes nowhere; "new" places are compared by the fields behind them.
  return departure && value.choice !== "new" && departure.choice === value.choice
    ? m.owner_choose_two_different_places_departure_and_arrival_are_the_same
    : undefined;
};

/** Ideas for the same journey are shown together as alternatives; a lone idea is listed like any route. */
export function routeEntries(routes: Route[]): { routes: Route[]; journey?: string }[] {
  const shown = new Set<string>();
  return routes.flatMap((route) => {
    const group =
      route.status === "idea"
        ? routes.filter((item) => item.status === "idea" && sameJourney(item, route))
        : [route];
    if (group.length < 2) return [{ routes: [route] }];
    if (group.some((item) => shown.has(item.id))) return [];
    group.forEach((item) => shown.add(item.id));
    const places = `${route.departure_area.label} → ${route.arrival_area.label}`;
    return [
      {
        routes: group,
        journey: route.departs_on ? `${places} · ${formatDay(route.departs_on)}` : places,
      },
    ];
  });
}

/** The times once booked, else the day alone. */
export const routeTimes = (route: Route) =>
  route.departs_at && route.arrives_at
    ? `${endpointTime(route.departs_at, route.departure_timezone)} → ${endpointTime(route.arrives_at, route.arrival_timezone)}`
    : route.departs_on
      ? formatDay(route.departs_on)
      : null;
export const routeShift = (route: Route) => {
  if (!route.departs_at || !route.arrives_at) return "";
  const days = dayShift(route as TimedRoute);
  return days !== 0
    ? m.owner_day_shift({ count: Math.abs(days), shift: `${days > 0 ? "+" : ""}${days}` })
    : "";
};

/** The area a place value is in: what it names, or the area of the location it names. */
const areaIdOf = (value: PlaceValue, locations: Location[]): string => {
  const [kind, id] = value.choice.split(":");
  return kind === "area"
    ? id
    : kind === "location"
      ? (locations.find((location) => location.id === id)?.area_id ?? "")
      : value.newAreaId;
};
/** Where the line could start or end for a place: its shared point, else its area's. */
export const areaPoint = (
  value: PlaceValue,
  areas: Area[],
  locations: Location[],
): { label: string; coordinates: RouteCoordinate }[] => {
  if (value.choice.startsWith("location:")) {
    const location = locations.find(
      (candidate) => candidate.id === value.choice.slice("location:".length),
    );
    if (
      location?.visibility === "everyone" &&
      location.latitude !== null &&
      location.longitude !== null
    ) {
      return [
        { label: locationName(location), coordinates: [location.longitude, location.latitude] },
      ];
    }
  }
  if (
    value.newAreaId === "__new__" &&
    value.newAreaCandidate?.latitude != null &&
    value.newAreaCandidate.longitude != null
  ) {
    return [
      {
        label: value.newAreaCandidate.label,
        coordinates: [value.newAreaCandidate.longitude, value.newAreaCandidate.latitude],
      },
    ];
  }
  const area = areas.find((candidate) => candidate.id === areaIdOf(value, locations));
  return area && area.latitude !== null && area.longitude !== null
    ? [{ label: area.label, coordinates: [area.longitude, area.latitude] }]
    : [];
};
