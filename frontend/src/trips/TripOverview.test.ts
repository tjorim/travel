import { expect, it } from "vitest";

import type { Route } from "../tracker-model";
import { tripBadges } from "./TripOverview";

const area = {
  id: "area",
  visibility: "private" as const,
  label: "Area",
  country_code: "PT",
  region: null,
  latitude: null,
  longitude: null,
  timezone: null,
};

function route(id: string, changes: Partial<Route> = {}): Route {
  return {
    id,
    mode: "train",
    status: "planned",
    label: null,
    departure_area: area,
    arrival_area: area,
    departure_location: null,
    arrival_location: null,
    departs_on: "2054-10-15",
    departs_at: null,
    arrives_at: null,
    departure_timezone: null,
    arrival_timezone: null,
    carrier: null,
    service_reference: null,
    travel_class: null,
    booking_reference: null,
    notes: null,
    document_asset_ids: [],
    geometry: null,
    visibility: "private",
    ...changes,
  };
}

const badges = (routes: Route[]) => tripBadges({ starts_on: null, ends_on: null }, [], routes, []);

it("counts planned day-only journeys in transport booking progress", () => {
  expect(badges([route("1"), route("2"), route("3"), route("4")])).toEqual([
    { label: "Vervoer", value: "0/4 geboekt", done: false },
  ]);
});

it("counts booked and confirmed day-only journeys alongside timed journeys", () => {
  expect(
    badges([
      route("planned"),
      route("booked", { status: "booked" }),
      route("confirmed", { status: "confirmed" }),
      route("timed", { status: "booked", departs_at: "2054-10-16T08:00:00Z", arrives_at: "2054-10-16T09:00:00Z" }),
      route("cancelled", { status: "cancelled" }),
      route("unscheduled", { departs_on: null }),
    ]),
  ).toEqual([{ label: "Vervoer", value: "3/4 geboekt", done: false }]);
  expect(badges([route("booked", { status: "booked" }), route("confirmed", { status: "confirmed" })])).toEqual([
    { label: "Vervoer", value: "geboekt", done: true },
  ]);
  expect(badges([route("cancelled", { status: "cancelled" }), route("unscheduled", { departs_on: null })])).toEqual([]);
});
