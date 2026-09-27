// @vitest-environment jsdom
import { createRootRoute, createRoute } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderRoutesWithOwner, restoreObjectUrls, stubObjectUrls, testToken } from "../query/test-utils";
import type { Trip } from "../tracker-model";
import { TripDetail } from "./TripDetail";

const rootRoute = createRootRoute();
const tripDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "trips/$tripId/details", component: TripDetail });
const tripsListRoute = createRoute({ getParentRoute: () => rootRoute, path: "trips", component: () => <p>Alle reizen</p> });
const routeTree = rootRoute.addChildren([tripDetailRoute, tripsListRoute]);

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = { id: "trip", title: "Exampleland", summary: "Drie weken", starts_on: "2054-11-16", ends_on: "2054-12-06", travel_updates: [{ id: "m1", occurred_at: "2054-11-17T10:00:00Z", date_precision: "day", title: "Eerste avond", body: "", private_notes: "Nachtmarkt", area_id: null, location: null, media_asset_ids: [], visibility: "private" }] };
const path = (resource: string) => `/api/trips/trip/${resource}`;

let api: FakeApi;
function seed(overrides: Record<string, unknown[]> = {}) {
  const collections: Record<string, unknown[]> = { locations: [], areas: [], routes: [], stays: [], visits: [], "trip-tasks": [], documents: [], media: [], ...overrides };
  api = fakeApi();
  api.collection("/api/trips", [trip as never]);
  for (const [resource, rows] of Object.entries(collections)) api.collection(path(resource), rows as never[]);
}
const renderDetail = () => renderRoutesWithOwner(routeTree, ["/trips/trip/details"]);

beforeEach(() => { auth.session = { accessToken: testToken() }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); restoreObjectUrls(); });

it("shows the whole private trip once every read has arrived", async () => {
  seed({ stays: [{ id: "s1", check_in_date: "2054-11-16", check_out_date: "2054-11-18", status: "booked", property_name: "Hotel Royal", location: {}, area: { label: "Taipei" }, booking_reference: "ABC" }], "trip-tasks": [{ id: "t1", title: "Visum regelen", due_date: null, completed_at: null, notes: null, links: [] }] });
  renderDetail();
  await screen.findByRole("heading", { name: "Exampleland" });
  expect(screen.getByText("Eerste avond")).toBeTruthy();
  expect(screen.getByText("Hotel Royal")).toBeTruthy();
  expect(screen.getByText("Boekingsreferentie: ABC")).toBeTruthy();
  expect(screen.getByText("Visum regelen")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Naar reisbeheer" }).getAttribute("href")).toBe("/trips/trip");
  expect(api.unexpected).toEqual([]);
});

it("shows a saved location's own name instead of its repeated locality", async () => {
  seed({ locations: [{ id: "l1", label: "Longshan Temple", display_name: null, locality: "Taipei", country_code: "TW" }] });
  renderDetail();
  await screen.findByRole("heading", { name: "Exampleland" });
  expect(screen.getByRole("heading", { name: "Longshan Temple · Taipei · TW" })).toBeTruthy();
});

it("shows a loading state, then an error rather than half a trip when one read fails", async () => {
  seed();
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url === "/api/trips" ? new Response(JSON.stringify([trip]), { status: 200 }) : url.endsWith("/documents") ? new Response(JSON.stringify({ detail: "kapot" }), { status: 500 }) : new Response("[]", { status: 200 }))));
  renderDetail();
  expect(await screen.findByText("Private reis laden…")).toBeTruthy();
  await screen.findByText("De private reis kon niet volledig worden geladen.");
  expect(screen.queryByRole("heading", { name: "Exampleland" })).toBeNull();
});

it("says so when the trip does not exist, and reads nothing for it", async () => {
  seed();
  api.collection("/api/trips", []);
  renderDetail();
  await screen.findByText("Reis niet gevonden");
  expect(api.requests.filter((request) => request.includes("/api/trips/trip/"))).toEqual([]);
});

it("opens a private document with the authenticated download", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
  stubObjectUrls("blob:doc");
  seed({ documents: [{ id: "d1", title: "Vliegticket", document_kind: "booking", original_filename: "ticket.pdf", byte_size: 100, file_url: "/api/trips/trip/documents/d1/original" }] });
  api.on("GET", /\/documents\/d1\/original$/, () => "pdf");
  renderDetail();
  fireEvent.click(await screen.findByRole("button", { name: "Document openen" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith("blob:doc", "_blank", "noopener"));
  const [, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(([url]) => url.endsWith("/original"))!;
  expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
});

it("reports a document that cannot be opened without leaving the page", async () => {
  seed({ documents: [{ id: "d1", title: "Vliegticket", document_kind: "booking", original_filename: "ticket.pdf", byte_size: 100, file_url: "/api/trips/trip/documents/d1/original" }] });
  api.on("GET", /\/documents\/d1\/original$/, () => { throw new Error("unused"); });
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => url.endsWith("/original") ? Promise.resolve(new Response(JSON.stringify({ detail: "Bestand ontbreekt." }), { status: 404 })) : original(url, init)));
  renderDetail();
  fireEvent.click(await screen.findByRole("button", { name: "Document openen" }));
  await screen.findByText("Bestand ontbreekt.");
  expect(screen.getByRole("heading", { name: "Exampleland" })).toBeTruthy();
});
