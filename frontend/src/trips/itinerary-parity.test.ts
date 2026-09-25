import { expect, it } from "vitest";

import { dayShift } from "./TransportLegManager";
import { overnights } from "./ItineraryPlanManager";
import { stayStateLabel } from "./StayManager";
import { tripBadges } from "./TripOverview";
import { stayCoversNight, wallClock, type ItineraryEntry, type Stay, type TransportLeg, type TripTask } from "../tracker-model";

function stay(overrides: Partial<Stay>): Stay {
  return { id: "stay", check_in_date: "2054-11-16", check_out_date: "2054-11-28", check_in_time: null, check_out_time: null, status: "booked", property_name: "Example Lodge Linkou", website_url: null, booking_reference: null, contact_details: null, notes: null, place: null, broad_place: null, visibility: "private", share_date_precision: "month", ...overrides };
}

function entry(overrides: Partial<ItineraryEntry>): ItineraryEntry {
  return { id: "entry", day_date: null, end_date: null, kind: null, tentative: false, position: 0, title: "Dag", notes: null, linked_kind: null, linked_id: null, ...overrides };
}

it("counts a stay's nights from check-in up to, not including, the check-out morning", () => {
  const linkou = stay({});
  expect(stayCoversNight(linkou, "2054-11-16")).toBe(true);
  expect(stayCoversNight(linkou, "2054-11-27")).toBe(true);
  expect(stayCoversNight(linkou, "2054-11-28")).toBe(false);
  expect(stayCoversNight({ ...linkou, status: "cancelled" }, "2054-11-20")).toBe(false);
});

it("labels stays like the archive: still choosing, proposed or booked", () => {
  expect(stayStateLabel(stay({ status: "planned", property_name: null }))).toBe("Nog kiezen");
  expect(stayStateLabel(stay({ status: "planned" }))).toBe("Voorgesteld");
  expect(stayStateLabel(stay({}))).toBe("Geboekt");
});

it("derives each day-plan entry's overnight stays and uncovered nights", () => {
  const stays = [stay({}), stay({ id: "alishan", check_in_date: "2054-11-29", check_out_date: "2054-11-30", status: "planned", property_name: null })];
  const trip = { starts_on: "2054-11-16", ends_on: "2054-12-06" };
  expect(overnights(entry({ day_date: "2054-11-18", end_date: "2054-11-20" }), stays, trip)).toEqual({ stays: [stays[0]], uncovered: 0 });
  // The 28th has no stay yet; the 29th is the planned Alishan night.
  expect(overnights(entry({ day_date: "2054-11-28", end_date: "2054-11-29" }), stays, trip)).toEqual({ stays: [stays[1]], uncovered: 1 });
  // No bed is needed before departure or on the trip's final day.
  expect(overnights(entry({ day_date: "2054-11-15", end_date: "2054-11-16" }), stays, trip)).toEqual({ stays: [stays[0]], uncovered: 0 });
  expect(overnights(entry({ day_date: "2054-12-06" }), stays, trip)).toEqual({ stays: [], uncovered: 0 });
  expect(overnights(entry({}), stays, { starts_on: null, ends_on: null })).toEqual({ stays: [], uncovered: 0 });
});

it("shows flight times in each endpoint's zone with the archive's day shift", () => {
  const outbound = { departs_at: "2054-11-16T09:40:00Z", arrives_at: "2054-11-16T22:25:00Z", departure_timezone: "Europe/Amsterdam", arrival_timezone: "Asia/Taipei" } satisfies Pick<TransportLeg, "departs_at" | "arrives_at" | "departure_timezone" | "arrival_timezone">;
  expect(wallClock(outbound.departs_at, "Europe/Amsterdam")).toBe("2054-11-16T10:40");
  expect(wallClock(outbound.arrives_at, "Asia/Taipei")).toBe("2054-11-17T06:25");
  expect(dayShift(outbound)).toBe(1);
  expect(dayShift({ ...outbound, departs_at: "2054-12-06T15:15:00Z", arrives_at: "2054-12-07T06:50:00Z", departure_timezone: "Asia/Taipei", arrival_timezone: "Europe/Amsterdam" })).toBe(1);
});

it("summarises bookings as header badges", () => {
  const legs = [{ status: "confirmed" }, { status: "booked" }, { status: "cancelled" }] as TransportLeg[];
  const tasks = [{ completed_at: null }, { completed_at: "2054-09-01T00:00:00Z" }] as TripTask[];
  const stays = [stay({}), stay({ id: "alishan", check_in_date: "2054-11-29", check_out_date: "2054-11-30", status: "planned", property_name: null })];
  expect(tripBadges({ starts_on: "2054-11-16", ends_on: "2054-12-06" }, stays, legs, tasks)).toEqual([
    { label: "Vervoer", value: "geboekt", done: true },
    { label: "Nachten", value: "12/20 geboekt · 7 zonder verblijf", done: false },
    { label: "Nog te regelen", value: "1 open", done: false },
  ]);
  expect(tripBadges({ starts_on: null, ends_on: null }, [], [], [])).toEqual([]);
});
