// @vitest-environment happy-dom
import { createRootRoute, createRoute } from "@tanstack/react-router";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import type { Area, Stay, Trip } from "../tracker-model";
import { TripOverview } from "./TripOverview";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const area: Area = {
  id: "linkou",
  visibility: "private",
  label: "Linkou",
  country_code: "TW",
  region: null,
  latitude: null,
  longitude: null,
  timezone: "Asia/Taipei",
};
const trip: Trip = {
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: "2054-11-16",
  ends_on: "2054-11-24",
  travel_updates: [],
};
const stay = {
  id: "s1",
  status: "confirmed",
  check_in_date: "2054-11-16",
  check_out_date: "2054-11-20",
  check_in_time: null,
  check_out_time: null,
  property_name: "Hotel Royal",
  area,
} as unknown as Stay;
let api: FakeApi;

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  vi.useFakeTimers({ toFake: ["Date"] });
  api = fakeApi()
    .collection("/api/trips/trip/stays", [stay])
    .collection("/api/trips/trip/routes", [])
    .collection("/api/trips/trip/visits", [])
    .collection("/api/trips/trip/trip-tasks", []);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  expect(api.unexpected).toEqual([]);
});

function show(isoInstant: string) {
  vi.setSystemTime(new Date(isoInstant));
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <TripOverview trip={trip} />,
  });
  renderRoutesWithOwner(root.addChildren([route]), ["/"]);
}

it("says where tonight is slept and that the stay is checked out of tomorrow morning", async () => {
  // 18 November in Taipei: the middle of the stay, and tomorrow's night is slept there too.
  show("2054-11-18T06:00:00Z");
  const today = (await screen.findByText("Vandaag")).closest("section")!;
  expect(today.textContent).toContain("Slapen in Hotel Royal");
  const tomorrow = screen.getByText("Morgen").closest("section")!;
  expect(tomorrow.textContent).toContain("Slapen in Hotel Royal");
});

it("shows the check-out morning without another night", async () => {
  // 19 November: tonight is the last night; tomorrow is the check-out.
  show("2054-11-19T06:00:00Z");
  const tomorrow = (await screen.findByText("Morgen")).closest("section")!;
  expect(tomorrow.textContent).toContain("Uitchecken: Hotel Royal");
  expect(tomorrow.textContent).not.toContain("Slapen in");
  // And on the morning itself, the stay is checked out of and nothing more.
  cleanup();
  show("2054-11-20T06:00:00Z");
  const checkout = (await screen.findByText("Vandaag")).closest("section")!;
  expect(checkout.textContent).toContain("Uitchecken: Hotel Royal");
  expect(checkout.textContent).not.toContain("Slapen in");
});
