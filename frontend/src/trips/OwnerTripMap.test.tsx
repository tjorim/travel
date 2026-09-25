// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pinOfflineCopy } from "../offline/offline-store";
import { fakeApi, type FakeApi } from "../query/fake-api";
import { ownerKeys } from "../query/keys";
import { renderWithOwner, resetOfflineDb, testToken } from "../query/test-utils";
import type { BroadPlace, BroadRoute, Place, RecordedTrack, Trip } from "../tracker-model";
import { OwnerTripMap } from "./OwnerTripMap";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, route_stages: [], travel_updates: [] };
const taipei: BroadPlace = { id: "taipei", visibility: "private", label: "Taipei", country_code: "TW", region: null, latitude: 25.03, longitude: 121.56, timezone: null };
const route = (id: string, label: string): BroadRoute => ({ id, label, date_precision: "day", visibility: "private", geometry: { type: "LineString", coordinates: [[121.5, 25], [121.6, 25.1]] } } as BroadRoute);
const cafe = { id: "cafe", display_name: "Café", locality: null, latitude: 25.04, longitude: 121.5 } as Place;
const track = { id: "t1", kind: "point_array", started_at: "2054-11-16T08:00:00Z", source_file_url: "/api/trips/trip/recorded-tracks/t1/source" } as RecordedTrack;

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi()
    .collection("/api/trips/trip/broad-routes", [route("r1", "Oostkust")])
    .collection("/api/trips/trip/recorded-tracks", [track])
    .collection("/api/trips/trip/places", [cafe]);
  api.on("GET", /\/recorded-tracks\/t1\/source$/, () => [{ lat: 25, lon: 121 }, { lat: 25.2, lon: 121.2 }]);
});
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await resetOfflineDb(); });

it("draws broad routes, exact places and private tracks from the shared reads", async () => {
  renderWithOwner(<OwnerTripMap trip={trip} broadPlaces={[taipei]} />);
  await screen.findByRole("button", { name: "Oostkust" });
  await screen.findByRole("button", { name: /Afgewerkte track/ });
  expect(screen.getByRole("button", { name: "Taipei" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Café" })).toBeTruthy();
  expect(api.unexpected).toEqual([]);
});

it("shows a route added elsewhere as soon as its read is refreshed, with no revision prop", async () => {
  const { client } = renderWithOwner(<OwnerTripMap trip={trip} broadPlaces={[]} />);
  await screen.findByRole("button", { name: "Oostkust" });
  api.push("/api/trips/trip/broad-routes", route("r2", "Westkust"));
  await act(async () => { await client.invalidateQueries({ queryKey: ownerKeys.tripResource("owner-1", "trip", "broad-routes") }); });
  await screen.findByRole("button", { name: "Westkust" });
});

it("keeps the rest of the map when one private track cannot be drawn", async () => {
  api.on("GET", /\/recorded-tracks\/t1\/source$/, () => "geen json");
  renderWithOwner(<OwnerTripMap trip={trip} broadPlaces={[]} />);
  await screen.findByText("Een private track kon niet worden getekend; de overige kaartgegevens blijven beschikbaar.");
  expect(screen.getByRole("button", { name: "Oostkust" })).toBeTruthy();
});

it("downloads track files with the bearer token and lets an unmount abort them", async () => {
  let signal: AbortSignal | undefined;
  api.on("GET", /\/recorded-tracks\/t1\/source$/, () => "[]");
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
    if (url.endsWith("/source")) { signal = init.signal ?? undefined; expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /); return new Promise<Response>(() => undefined); }
    return original(url, init);
  }));
  const view = renderWithOwner(<OwnerTripMap trip={trip} broadPlaces={[]} />);
  await waitFor(() => expect(signal).toBeDefined());
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

it("falls back to the pinned map copy when the live reads are refused", async () => {
  await pinOfflineCopy({
    subject: "owner-1", resourceKind: "map_route_data", resourceId: "trip", metadataUrl: "/api/trips/trip/offline-map", title: "Exampleland · kaart en route", contentType: "application/json",
    bytes: new TextEncoder().encode(JSON.stringify({ version: 1, points: [{ id: "p", label: "Bewaarde stad", coordinates: [121, 25] }], lines: [] })).buffer as ArrayBuffer,
  });
  api.on("GET", /\/places$/, () => { throw new Error("unused"); });
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify({ detail: "Niet beschikbaar" }), { status: url.includes("/offline-map") ? 200 : 503 }))));
  renderWithOwner(<OwnerTripMap trip={trip} broadPlaces={[]} />);
  await screen.findByRole("button", { name: "Bewaarde stad" });
  expect(screen.getByText("Je gebruikt de bewust bewaarde offline kaart- en routegegevens. Kaarttegels worden niet offline opgeslagen.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Offline verwijderen" })).toBeTruthy();
});

it("pins the current map data for offline use", async () => {
  renderWithOwner(<OwnerTripMap trip={trip} broadPlaces={[taipei]} />);
  await screen.findByRole("button", { name: "Oostkust" });
  fireEvent.click(screen.getByRole("button", { name: "Kaart offline bewaren" }));
  await screen.findByText(/offline bewaard op dit toestel/);
  await screen.findByRole("button", { name: "Offline verwijderen" });
});
