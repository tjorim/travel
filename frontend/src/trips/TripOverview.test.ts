import { expect, it } from "vitest";

import { stayCoversNight, whereabouts, type Route, type Stay } from "../tracker-model";
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
    { label: "Vervoer", value: "0/4 bevestigd", done: false },
  ]);
});

it("counts confirmed day-only journeys alongside timed journeys", () => {
  expect(
    badges([
      route("planned"),
      route("confirmed", { status: "confirmed" }),
      route("timed", {
        status: "confirmed",
        departs_at: "2054-10-16T08:00:00Z",
        arrives_at: "2054-10-16T09:00:00Z",
      }),
      route("cancelled", { status: "cancelled" }),
      route("unscheduled", { departs_on: null }),
    ]),
  ).toEqual([{ label: "Vervoer", value: "2/3 bevestigd", done: false }]);
  expect(
    badges([route("first", { status: "confirmed" }), route("second", { status: "confirmed" })]),
  ).toEqual([{ label: "Vervoer", value: "bevestigd", done: true }]);
  expect(
    badges([
      route("cancelled", { status: "cancelled" }),
      route("unscheduled", { departs_on: null }),
    ]),
  ).toEqual([]);
});

const stay = (id: string, status: Stay["status"], checkIn: string, checkOut: string): Stay =>
  ({
    id,
    status,
    check_in_date: checkIn,
    check_out_date: checkOut,
    area: { ...area, timezone: "Asia/Taipei" },
  }) as Stay;

it("never counts a stay idea as covering a night", () => {
  const trip = { starts_on: "2054-11-28", ends_on: "2054-11-30" };
  const ideas = [
    stay("a", "idea", "2054-11-28", "2054-11-30"),
    stay("b", "idea", "2054-11-28", "2054-11-30"),
  ];
  expect(stayCoversNight(ideas[0], "2054-11-28")).toBe(false);
  expect(stayCoversNight(stay("c", "planned", "2054-11-28", "2054-11-30"), "2054-11-28")).toBe(
    true,
  );
  // Ideas alone leave both nights missing and the badge unfinished.
  const [alone] = tripBadges(trip, ideas, [], []);
  expect(alone).toMatchObject({ label: "Nachten", done: false });
  expect(alone.value).toContain("0/2 bevestigd");
  expect(alone.value).toContain("2");
  // Once one candidate is confirmed, only its night counts; the alternatives change nothing.
  const [partial] = tripBadges(
    trip,
    [...ideas, stay("d", "confirmed", "2054-11-28", "2054-11-29")],
    [],
    [],
  );
  expect(partial.value).toContain("1/2 bevestigd");
  // Without trip dates the stay badge counts only the plan, not its candidates.
  expect(tripBadges({ starts_on: null, ends_on: null }, ideas, [], [])).toEqual([]);
  expect(
    tripBadges(
      { starts_on: null, ends_on: null },
      [...ideas, stay("e", "confirmed", "2054-11-28", "2054-11-29")],
      [],
      [],
    ),
  ).toEqual([{ label: "Verblijven", value: "1/1 bevestigd", done: true }]);
});

it("does not place the owner at a stay idea", () => {
  const ideas = [stay("a", "idea", "2054-11-28", "2054-11-30")];
  expect(whereabouts("2054-11-29T10:00:00Z", ideas, [], "Europe/Amsterdam").kind).toBe("home");
});

it("leaves route ideas out of booking progress and whereabouts", () => {
  const ideas = [route("a", { status: "idea" }), route("b", { status: "idea" })];
  expect(badges(ideas)).toEqual([]);
  expect(badges([...ideas, route("c", { status: "confirmed" })])).toEqual([
    { label: "Vervoer", value: "bevestigd", done: true },
  ]);
  const timed = route("d", {
    status: "idea",
    departs_at: "2054-11-28T01:00:00Z",
    arrives_at: "2054-11-28T09:00:00Z",
    arrival_timezone: "Asia/Taipei",
  });
  expect(whereabouts("2054-11-28T05:00:00Z", [], [timed], "Europe/Amsterdam").kind).toBe("home");
  expect(
    whereabouts("2054-11-28T05:00:00Z", [], [{ ...timed, status: "planned" }], "Europe/Amsterdam")
      .kind,
  ).toBe("travel");
});
