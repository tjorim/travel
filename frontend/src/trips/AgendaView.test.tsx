// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { Area, Route, Stay, Trip, Visit } from "../tracker-model";
import { AgendaView } from "./AgendaView";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const area = (id: string, label: string): Area => ({ id, visibility: "private", label, country_code: "TW", region: null, latitude: null, longitude: null, timezone: null });
const taipei = area("taipei", "Taipei"), linkou = area("linkou", "Linkou");
const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, travel_updates: [] };
let api: FakeApi;

beforeEach(() => { auth.session = { accessToken: testToken() }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); expect(api.unexpected).toEqual([]); });

function seed(stays: unknown[], routes: unknown[], visits: unknown[]) {
  api = fakeApi().collection("/api/trips/trip/stays", stays as never[]).collection("/api/trips/trip/routes", routes as never[]).collection("/api/trips/trip/visits", visits as never[]);
}

it("lists stays, routes and visits together by day, then what has no day yet", async () => {
  seed(
    [{ id: "s1", check_in_date: "2054-11-16", check_out_date: "2054-11-20", property_name: "Hotel Royal", check_in_time: null, area: linkou } as unknown as Stay],
    [
      { id: "r1", mode: "flight", label: null, departure_area: area("ams", "Amsterdam"), arrival_area: taipei, departs_on: "2054-11-16", departs_at: "2054-11-16T09:40:00Z", arrives_at: "2054-11-16T22:25:00Z", departure_timezone: "Europe/Amsterdam", arrival_timezone: "Asia/Taipei" },
      { id: "r2", mode: "train", label: "Losse route", departure_area: taipei, arrival_area: linkou, departs_on: null, departs_at: null, arrives_at: null },
      { id: "r3", mode: "train", label: "Naar het noorden", departure_area: linkou, arrival_area: taipei, departs_on: "2054-11-21", departs_at: null, arrives_at: null },
    ] as unknown as Route[],
    [
      { id: "v1", title: "Nachtmarkt", area: taipei, starts_on: "2054-11-21", ends_on: null, start_time: "18:30:00", end_time: null },
      { id: "v2", title: "Ooit", area: taipei, starts_on: null, ends_on: null, start_time: null, end_time: null },
    ] as unknown as Visit[],
  );
  renderWithOwner(<AgendaView trip={trip} />);
  await screen.findByText(/Bezoek: Nachtmarkt/);
  const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
  expect(rows).toEqual([
    expect.stringContaining("10:40 Route: Amsterdam → Taipei"),
    expect.stringContaining("Verblijf: Hotel Royal"),
    expect.stringContaining("18:30 Bezoek: Nachtmarkt"),
    // A route with a day but no train yet is on that day, after what has a time.
    expect.stringContaining("Route: Naar het noorden"),
    // Nothing disappears: undated visits and routes are listed together.
    expect.stringContaining("Bezoek: Ooit"),
    expect.stringContaining("Route: Losse route"),
  ]);
  expect(screen.getByText("Nog geen dag")).toBeTruthy();
});

it("says so when nothing has a day yet", async () => {
  seed([], [], []);
  renderWithOwner(<AgendaView trip={trip} />);
  await screen.findByText(/Nog niets in de agenda/);
});
