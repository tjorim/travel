// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderWithOwner, testToken } from "../query/test-utils";
import { answerConfirmation } from "../test-confirm";
import type { Trip } from "../tracker-model";
import { Trips } from "./Trips";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));
// The managers and map have their own tests; this file covers trip selection and the trip editor.
vi.mock("../trips/DocumentManager", () => ({ DocumentManager: () => null }));
vi.mock("../trips/ItineraryPlanManager", () => ({ ItineraryPlanManager: () => null }));
vi.mock("../trips/HighlightManager", () => ({ HighlightManager: () => null }));
vi.mock("../trips/BroadPlaceManager", () => ({ BroadPlaceManager: () => null }));
vi.mock("../trips/MomentExcerptManager", () => ({ MomentExcerptManager: () => null }));
vi.mock("../trips/MediaManager", () => ({ MediaManager: () => null }));
vi.mock("../trips/OwnerTripMap", () => ({ OwnerTripMap: () => null }));
vi.mock("../trips/PublicationManager", () => ({ PublicationManager: () => null }));
vi.mock("../trips/RouteStageManager", () => ({ RouteStageManager: () => null }));
vi.mock("../trips/StayManager", () => ({ StayManager: () => null }));
vi.mock("../trips/TrackManager", () => ({ TrackManager: () => null }));
vi.mock("../trips/TransportLegManager", () => ({ TransportLegManager: () => null }));
vi.mock("../trips/TripTaskManager", () => ({ TripTaskManager: () => null }));
vi.mock("../library/LinkedLibraryDocuments", () => ({ LinkedLibraryDocuments: () => null }));
vi.mock("../trips/TripOverview", () => ({ TripOverview: () => null }));

const trip = (id: string, title: string, extra: Partial<Trip> = {}): Trip => ({ id, title, summary: null, starts_on: null, ends_on: null, visibility: "private", publication_state: "draft", route_stages: [], highlights: [], moments: [], moment_excerpts: [], ...extra });
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
    if (url.endsWith("/places/broad")) return json([]);
    throw new Error(`unexpected request ${method} ${url}`);
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// The list page also hosts other forms with a "Titel" field; scope to the trip editor.
const editor = () => within(screen.getByRole("heading", { name: /^(Reis bewerken|Nieuwe reis)$/ }).closest("section")!);
const renderTrips = (path = "/trips") => renderWithOwner(<MemoryRouter initialEntries={[path]}><Routes><Route path="/trips" element={<Trips />} /><Route path="/trips/:id" element={<p>Werkruimte</p>} /></Routes></MemoryRouter>);

it("opens the first trip with its saved values in the editor", async () => {
  renderTrips();
  await waitFor(() => expect((editor().getByLabelText("Titel") as HTMLInputElement).value).toBe("Exampleland"));
  expect((editor().getByLabelText(/Eerste reisdag/) as HTMLInputElement).value).toBe("2054-11-16");
});

it("shows the renamed trip in the list after saving, with one refreshed read", async () => {
  renderTrips();
  await waitFor(() => expect((editor().getByLabelText("Titel") as HTMLInputElement).value).toBe("Exampleland"));
  fireEvent.change(editor().getByLabelText("Titel"), { target: { value: "Exampleland 2054" } });
  fireEvent.click(editor().getByRole("button", { name: "Reis opslaan" }));
  await screen.findByRole("button", { name: /Exampleland 2054/ });
  expect(screen.queryByRole("button", { name: /^Exampleland ·/ })).toBeNull();
  expect(screen.getByText("Reis opgeslagen.")).toBeTruthy();
  expect(requests.filter((request) => request === "GET /api/trips")).toHaveLength(2);
});

it("drops a deleted trip from the list and falls back to a blank draft", async () => {
  renderTrips();
  await waitFor(() => expect((editor().getByLabelText("Titel") as HTMLInputElement).value).toBe("Exampleland"));
  fireEvent.click(editor().getByRole("button", { name: "Reis verwijderen" }));
  await answerConfirmation();
  await waitFor(() => expect(screen.queryByRole("button", { name: /Exampleland/ })).toBeNull());
  expect(screen.getByRole("button", { name: /IJsland/ })).toBeTruthy();
  expect((editor().getByLabelText("Titel") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("heading", { name: "Nieuwe reis" })).toBeTruthy();
});

it("creates a trip and opens its workspace", async () => {
  renderTrips();
  await screen.findByRole("button", { name: /IJsland/ });
  fireEvent.click(screen.getByRole("button", { name: "Nieuwe reis" }));
  fireEvent.change(editor().getByLabelText("Titel"), { target: { value: "Japan" } });
  fireEvent.click(editor().getByRole("button", { name: "Reis maken" }));
  await screen.findByText("Werkruimte");
  expect(trips.map((item) => item.title)).toContain("Japan");
});

it("rejects an end date before the start date without calling the server", async () => {
  renderTrips();
  await waitFor(() => expect((editor().getByLabelText("Titel") as HTMLInputElement).value).toBe("Exampleland"));
  fireEvent.change(editor().getByLabelText(/Laatste reisdag/), { target: { value: "2054-11-01" } });
  fireEvent.click(editor().getByRole("button", { name: "Reis opslaan" }));
  await screen.findByText("De laatste reisdag ligt vóór de eerste.");
  expect(requests.some((request) => request.startsWith("PATCH"))).toBe(false);
});

it("says so when a workspace trip does not exist for this account", async () => {
  renderWithOwner(<MemoryRouter><Trips workspace={{ tripId: "missing", section: "overview" }} /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: "Reis niet gevonden" })).toBeTruthy();
});

it("explains a failed trip load without hiding the retry path", async () => {
  vi.stubGlobal("fetch", vi.fn(() => json({ detail: "Database niet bereikbaar." }, 400)));
  renderTrips();
  expect((await screen.findAllByText("Database niet bereikbaar.")).length).toBeGreaterThan(0);
});
