// @vitest-environment jsdom
import { createRootRoute, createRoute } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import { parseFlagParam } from "../router/search-params";
import type { Trip } from "../tracker-model";
import { TripWorkspace } from "./TripWorkspace";
import { Trips } from "./Trips";

const rootRoute = createRootRoute();
const tripsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "trips",
  component: Trips,
  validateSearch: (search: Record<string, unknown>): { new?: "1" } => ({ new: parseFlagParam(search.new) }),
});
const tripRoute = createRoute({ getParentRoute: () => rootRoute, path: "trips/$tripId", component: TripWorkspace });
const tripSectionRoute = createRoute({ getParentRoute: () => rootRoute, path: "trips/$tripId/$section", component: TripWorkspace });
const routeTree = rootRoute.addChildren([tripsListRoute, tripRoute, tripSectionRoute]);

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));
// The managers and map have their own tests; this file covers trip selection and the trip editor.
vi.mock("../trips/DocumentManager", () => ({ DocumentManager: () => null }));
vi.mock("../trips/VisitManager", () => ({ VisitManager: ({ onShowOnMap, focusId }: { onShowOnMap?: (id: string) => void; focusId?: { id: string } | null }) => <><button type="button" onClick={() => onShowOnMap?.("p1")}>Toon op kaart</button><p>Bezoekfocus {focusId?.id ?? "geen"}</p></> }));
vi.mock("../trips/AreaManager", () => ({ AreaManager: () => null }));
vi.mock("../trips/LocationManager", () => ({ LocationManager: () => null }));
vi.mock("../trips/TravelUpdateManager", () => ({ TravelUpdateManager: () => null }));
vi.mock("../trips/MediaManager", () => ({ MediaManager: () => null }));
vi.mock("../trips/OwnerTripMap", () => ({ OwnerTripMap: ({ focus }: { focus?: { id: string } | null }) => <p>Kaartfocus {focus?.id ?? "geen"}</p> }));
vi.mock("../trips/PublicationManager", () => ({ PublicationManager: () => null }));
vi.mock("../trips/RouteStageManager", () => ({ RouteStageManager: () => null }));
vi.mock("../trips/StayManager", () => ({ StayManager: ({ focusId }: { focusId?: { id: string } | null }) => <p>Verblijffocus {focusId?.id ?? "geen"}</p> }));
vi.mock("../trips/RouteManager", () => ({ RouteManager: ({ focusId }: { focusId?: { id: string } | null }) => <p>Routefocus {focusId?.id ?? "geen"}</p> }));
vi.mock("../trips/AgendaView", () => ({ AgendaView: ({ onOpenRecord }: { onOpenRecord?: (kind: "stay" | "route" | "visit", id: string) => void }) => <button type="button" onClick={() => onOpenRecord?.("stay", "s1")}>Agendaregel openen</button> }));
vi.mock("../trips/TripTaskManager", () => ({ TripTaskManager: () => null }));
vi.mock("../library/LinkedLibraryDocuments", () => ({ LinkedLibraryDocuments: () => null }));
vi.mock("../trips/TripOverview", () => ({ TripOverview: () => null }));

const trip = (id: string, title: string, extra: Partial<Trip> = {}): Trip => ({ id, title, summary: null, starts_on: null, ends_on: null, travel_updates: [], ...extra });
let trips: Trip[];
let requests: string[];
const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  trips = [trip("t1", "Exampleland", { starts_on: "2054-11-16", ends_on: "2054-12-06" }), trip("t2", "IJsland")];
  requests = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    requests.push(`${method} ${url}`);
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (url === "/api/trips" && method === "GET") return json(trips);
    if (url === "/api/trips" && method === "POST") { const created = trip("t3", String(body.title)); trips = [...trips, created]; return json(created, 201); }
    const match = /^\/api\/trips\/([^/]+)$/.exec(url);
    if (match && method === "PATCH") { trips = trips.map((item) => item.id === match[1] ? { ...item, title: String(body.title), summary: (body.summary as string | null) ?? null } : item); return json(trips.find((item) => item.id === match[1])); }
    if (match && method === "DELETE") { trips = trips.filter((item) => item.id !== match[1]); return Promise.resolve(new Response(null, { status: 204 })); }
    if (url.endsWith("/areas")) return json([]);
    throw new Error(`unexpected request ${method} ${url}`);
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// The trip dialogs share labels with the managers' forms; scope to the dialog.
const editor = (name: "Reisgegevens" | "Nieuwe reis") => within(screen.getByRole("heading", { name }).closest("dialog")!);
const openEditor = async () => fireEvent.click(await screen.findByRole("button", { name: "Reisgegevens" }));
const renderTrips = (path = "/trips") => renderRoutesWithOwner(routeTree, [path]);

it("lists trips only, and opens a trip's workspace from its row", async () => {
  renderTrips();
  await screen.findByRole("button", { name: /Exampleland/ });
  // The list page no longer stacks a trip's content or editor under the list.
  expect(screen.queryByText("Private inhoud")).toBeNull();
  expect(screen.queryByRole("button", { name: "Reisgegevens" })).toBeNull();
  expect(screen.queryByLabelText("Titel")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /IJsland/ }));
  await screen.findByRole("heading", { name: "IJsland" });
  expect(screen.getByRole("link", { name: "← Alle reizen" })).toBeTruthy();
});

it("keeps the editor closed in the workspace until asked, then opens the trip with its saved values", async () => {
  renderTrips("/trips/t1");
  await screen.findByRole("heading", { name: "Exampleland" });
  expect(screen.getByRole("link", { name: "Volledig privéoverzicht" }).getAttribute("href")).toBe("/trips/t1/details");
  expect(screen.queryByRole("heading", { name: "Reisgegevens" })).toBeNull();
  await openEditor();
  await waitFor(() => expect((editor("Reisgegevens").getByLabelText("Titel") as HTMLInputElement).value).toBe("Exampleland"));
  expect((editor("Reisgegevens").getByLabelText(/Eerste reisdag/) as HTMLInputElement).value).toBe("2054-11-16");
});

it("shows the renamed trip in the workspace after saving, with one refreshed read", async () => {
  renderTrips("/trips/t1");
  await openEditor();
  await waitFor(() => expect((editor("Reisgegevens").getByLabelText("Titel") as HTMLInputElement).value).toBe("Exampleland"));
  fireEvent.change(editor("Reisgegevens").getByLabelText("Titel"), { target: { value: "Exampleland 2054" } });
  fireEvent.click(editor("Reisgegevens").getByRole("button", { name: "Reis opslaan" }));
  await screen.findByRole("heading", { name: "Exampleland 2054" });
  expect(screen.getByText("Reis opgeslagen.")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Reisgegevens" })).toBeNull();
  expect(requests.filter((request) => request === "GET /api/trips")).toHaveLength(2);
});

it("drops a deleted trip and returns to the list", async () => {
  renderTrips("/trips/t1");
  await openEditor();
  await waitFor(() => expect((editor("Reisgegevens").getByLabelText("Titel") as HTMLInputElement).value).toBe("Exampleland"));
  fireEvent.click(editor("Reisgegevens").getByRole("button", { name: "Reis verwijderen" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }));
  await screen.findByRole("heading", { name: "Reizen" });
  await waitFor(() => expect(screen.queryByRole("button", { name: /Exampleland/ })).toBeNull());
  expect(screen.getByRole("button", { name: /IJsland/ })).toBeTruthy();
  expect(screen.getByText("Reis verwijderd.")).toBeTruthy();
});

it("creates a trip and opens its workspace", async () => {
  renderTrips();
  await screen.findByRole("button", { name: /IJsland/ });
  fireEvent.click(screen.getByRole("button", { name: "Nieuwe reis" }));
  fireEvent.change(editor("Nieuwe reis").getByLabelText("Titel"), { target: { value: "Japan" } });
  fireEvent.click(editor("Nieuwe reis").getByRole("button", { name: "Reis maken" }));
  await screen.findByRole("heading", { name: "Japan" });
  expect(trips.map((item) => item.title)).toContain("Japan");
});

it("opens the new-trip dialog straight from the home page link", async () => {
  renderTrips("/trips?new=1");
  await waitFor(() => expect((editor("Nieuwe reis").getByLabelText("Titel") as HTMLInputElement).value).toBe(""));
});

it("rejects an end date before the start date without calling the server", async () => {
  renderTrips("/trips/t1");
  await openEditor();
  await waitFor(() => expect((editor("Reisgegevens").getByLabelText("Titel") as HTMLInputElement).value).toBe("Exampleland"));
  fireEvent.change(editor("Reisgegevens").getByLabelText(/Laatste reisdag/), { target: { value: "2054-11-01" } });
  fireEvent.click(editor("Reisgegevens").getByRole("button", { name: "Reis opslaan" }));
  await screen.findByText("De laatste reisdag ligt vóór de eerste.");
  expect(requests.some((request) => request.startsWith("PATCH"))).toBe(false);
});

it("shows a step on the map by opening the overview, whose map focuses that point", async () => {
  renderTrips("/trips/t1/plan");
  fireEvent.click(await screen.findByRole("button", { name: "Toon op kaart" }));
  await screen.findByText("Kaartfocus p1");
});

it("opens only the matching manager's dialog when an agenda row is clicked", async () => {
  renderTrips("/trips/t1/plan");
  expect(await screen.findByText("Verblijffocus geen")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Agendaregel openen" }));
  expect(screen.getByText("Verblijffocus s1")).toBeTruthy();
  expect(screen.getByText("Bezoekfocus geen")).toBeTruthy();
  expect(screen.getByText("Routefocus geen")).toBeTruthy();
});

it("says so when a workspace trip does not exist for this account", async () => {
  const missingRoot = createRootRoute({ component: () => <Trips workspace={{ tripId: "missing", section: "overview" }} /> });
  renderRoutesWithOwner(missingRoot, ["/"]);
  expect(await screen.findByRole("heading", { name: "Reis niet gevonden" })).toBeTruthy();
});

it("explains a failed trip load without hiding the retry path", async () => {
  vi.stubGlobal("fetch", vi.fn(() => json({ detail: "Database niet bereikbaar." }, 400)));
  renderTrips();
  expect((await screen.findAllByText("Database niet bereikbaar.")).length).toBeGreaterThan(0);
});
