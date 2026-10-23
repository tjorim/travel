// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { server } from "../mocks/server";
import { pinOfflineCopy } from "../offline/offline-store";
import { fakeApi, type FakeApi } from "../query/fake-api";
import { ownerKeys } from "../query/keys";
import { renderWithOwner, resetOfflineDb, testToken } from "../query/test-utils";
import type { Area, Route, Location, Trip } from "../tracker-model";
import { OwnerTripMap } from "./OwnerTripMap";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = {
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [],
};
const taipei: Area = {
  id: "taipei",
  visibility: "private",
  label: "Taipei",
  country_code: "TW",
  region: null,
  latitude: 25.03,
  longitude: 121.56,
  timezone: null,
};
const route = (id: string, label: string): Route =>
  ({
    id,
    label,
    mode: "train",
    status: "planned",
    departure_area: taipei,
    arrival_area: taipei,
    visibility: "private",
    geometry: {
      type: "LineString",
      coordinates: [
        [121.5, 25],
        [121.6, 25.1],
      ],
    },
  }) as Route;
const cafe = {
  id: "cafe",
  display_name: "Café",
  locality: null,
  latitude: 25.04,
  longitude: 121.5,
} as Location;
const pagoda = {
  id: "pagoda",
  label: "Longshan Temple",
  display_name: null,
  locality: "Taipei",
  latitude: 25.037,
  longitude: 121.5,
} as Location;

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi()
    .collection("/api/trips/trip/routes", [route("r1", "Oostkust")])
    .collection("/api/trips/trip/locations", [cafe])
    .collection("/api/trips/trip/visits", []);
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await resetOfflineDb();
});

it("draws routes, areas and locations from the shared reads", async () => {
  renderWithOwner(<OwnerTripMap trip={trip} areas={[taipei]} />);
  await screen.findByRole("button", { name: /Oostkust/ });
  expect(screen.getByRole("button", { name: "Taipei" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Café" })).toBeTruthy();
  expect(api.unexpected).toEqual([]);
});

it("uses a location's saved name over the locality it repeats for other points", async () => {
  api.collection("/api/trips/trip/locations", [cafe, pagoda]);
  renderWithOwner(<OwnerTripMap trip={trip} areas={[taipei]} />);
  await screen.findByRole("button", { name: "Longshan Temple" });
  expect(screen.queryAllByRole("button", { name: "Taipei" })).toHaveLength(1);
});

it("shows a route added elsewhere as soon as its read is refreshed, with no revision prop", async () => {
  const { client } = renderWithOwner(<OwnerTripMap trip={trip} areas={[]} />);
  await screen.findByRole("button", { name: /Oostkust/ });
  api.push("/api/trips/trip/routes", route("r2", "Westkust"));
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ownerKeys.tripResource("owner-1", "trip", "routes"),
    });
  });
  await screen.findByRole("button", { name: /Westkust/ });
});

it("falls back to the pinned map copy when the live reads are refused", async () => {
  await pinOfflineCopy({
    subject: "owner-1",
    resourceKind: "route_data",
    resourceId: "trip",
    metadataUrl: "/api/trips/trip/offline-map",
    title: "Exampleland · kaart en route",
    contentType: "application/json",
    bytes: new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        points: [{ id: "p", label: "Bewaarde stad", coordinates: [121, 25] }],
        lines: [],
      }),
    ).buffer as ArrayBuffer,
  });
  api.on("GET", /\/locations$/, () => {
    throw new Error("unused");
  });
  server.use(
    http.all("*", ({ request }) =>
      HttpResponse.json(
        { detail: "Niet beschikbaar" },
        { status: request.url.includes("/offline-map") ? 200 : 503 },
      ),
    ),
  );
  renderWithOwner(<OwnerTripMap trip={trip} areas={[]} />);
  await screen.findByRole("button", { name: "Bewaarde stad" });
  expect(
    screen.getByText(
      "Je gebruikt de bewust bewaarde offline kaart- en routegegevens. Kaarttegels worden niet offline opgeslagen.",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Offline verwijderen" })).toBeTruthy();
});

it("pins the current map data for offline use", async () => {
  renderWithOwner(<OwnerTripMap trip={trip} areas={[taipei]} />);
  await screen.findByRole("button", { name: /Oostkust/ });
  fireEvent.click(screen.getByRole("button", { name: "Kaart offline bewaren" }));
  await screen.findByText(/offline bewaard op dit toestel/);
  await screen.findByRole("button", { name: "Offline verwijderen" });
});

it("offers a private derived area dot and stores it only on request", async () => {
  const unpointed = { ...taipei, latitude: null, longitude: null };
  api.collection("/api/trips/trip/locations", [{ ...cafe, area_id: "taipei" }]);
  api.on("PATCH", /\/areas\/taipei$/, (_url, body) => ({ ...unpointed, ...body }));
  renderWithOwner(<OwnerTripMap trip={trip} areas={[unpointed]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Taipei" }));
  expect(api.count("PATCH /api/trips/trip/areas/taipei")).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Gebruik als punt" }));
  await waitFor(() =>
    expect(api.lastBody("PATCH /api/trips/trip/areas/taipei")).toEqual({
      latitude: 25.04,
      longitude: 121.5,
    }),
  );
});
