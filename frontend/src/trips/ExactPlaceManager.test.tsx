// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { Place, Trip } from "../tracker-model";
import { ExactPlaceManager } from "./ExactPlaceManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, route_stages: [], travel_updates: [] };
const spot = { id: "e1", label: null, visibility: "private", display_name: "Beitou Hot Spring, 12 Guangming Road, Taipei", locality: "Taipei", country_code: "TW" } as unknown as Place;
const taipei = { id: "a1", label: "Taipei", visibility: "private", country_code: "TW", region: null, latitude: null, longitude: null, timezone: null };

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi().collection("/api/trips/trip/places", [spot], { update: (row, body) => ({ ...row, label: body.label }) }).collection("/api/trips/trip/places/broad", [taipei]);
  api.on("PUT", /\/visibility\/place\/e1$/, (body) => body);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); expect(api.unexpected).toEqual([]); });

it("shows a spot by the first part of its name, never its address", async () => {
  renderWithOwner(<ExactPlaceManager trip={trip} />);
  expect((await screen.findAllByText("Beitou Hot Spring")).length).toBeGreaterThan(0);
  expect(screen.queryByText(/12 Guangming Road/)).toBeNull();
});

it("saves a public name and then sets who sees the spot", async () => {
  renderWithOwner(<ExactPlaceManager trip={trip} />);
  fireEvent.change(await screen.findByLabelText("Publieke naam van Beitou Hot Spring"), { target: { value: "Warme bron van Beitou" } });
  fireEvent.click(screen.getByRole("button", { name: "Naam bewaren" }));
  await screen.findByText("Publieke naam opgeslagen.");
  expect(api.lastBody("PATCH /api/trips/trip/places/e1")).toEqual({ label: "Warme bron van Beitou" });
  fireEvent.change(screen.getByLabelText("Zichtbaarheid van Warme bron van Beitou"), { target: { value: "everyone" } });
  await waitFor(() => expect(api.lastBody("PUT /api/trips/trip/visibility/place/e1")).toEqual({ visibility: "everyone" }));
});
