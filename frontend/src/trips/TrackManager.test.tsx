// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, restoreObjectUrls, stubObjectUrls, testToken } from "../query/test-utils";
import type { BroadRoute, RecordedTrack, Trip } from "../tracker-model";
import { TrackManager } from "./TrackManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, route_stages: [], travel_updates: [] };
const route = (id: string, label: string): BroadRoute => ({ id, label, date_precision: "day", geometry: { type: "LineString", coordinates: [[121.5, 25], [121.6, 25.1]] } } as BroadRoute);
const track: RecordedTrack = { id: "t1", kind: "gpx", started_at: "2054-11-16T08:00:00Z", ended_at: "2054-11-16T09:00:00Z", byte_size: 2048, source_file_url: "/api/trips/trip/recorded-tracks/t1/source" } as RecordedTrack;

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi()
    .collection("/api/trips/trip/recorded-tracks", [track])
    .collection("/api/trips/trip/broad-routes", [route("r1", "Oostkust"), route("r2", "Westkust")], { update: (row, body) => ({ ...row, label: body.label, geometry: body.geometry }) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); restoreObjectUrls(); expect(api.unexpected).toEqual([]); });

const openRoute = async (label: string) => fireEvent.click(await screen.findByRole("button", { name: `Route ${label} bekijken` }));

it("keeps both forms out of the list until a route or track is added", async () => {
  renderWithOwner(<TrackManager trip={trip} />);
  await screen.findByText("Oostkust");
  expect(screen.queryByLabelText("Label")).toBeNull();
  expect(screen.queryByRole("button", { name: "Afgewerkte track uploaden" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Nieuwe route" }));
  expect(screen.getByRole("heading", { name: "Route op kaart toevoegen" })).toBeTruthy();
});

it("offers broad route stages as map-editor points", async () => {
  const tripWithStage: Trip = { ...trip, route_stages: [{ id: "stage", position: 0, label: "Taipei", summary: null, place: { id: "taipei", visibility: "private", label: "Taipei", country_code: "TW", region: null, latitude: 25.033, longitude: 121.565, timezone: null }, visibility: "private" }] };
  renderWithOwner(<TrackManager trip={tripWithStage} />);
  await screen.findByText("Oostkust");
  fireEvent.click(screen.getByRole("button", { name: "Nieuwe route" }));
  fireEvent.click(screen.getByRole("button", { name: "Voeg Taipei toe" }));
  await waitFor(() => expect(screen.getByText("1 punt · minstens twee punten zijn nodig.")).toBeTruthy());
  expect(screen.getByText("Punt 1: 25.033, 121.565")).toBeTruthy();
});

it("shows an edited broad route at once, opening the editor with its saved line", async () => {
  renderWithOwner(<TrackManager trip={trip} />);
  await openRoute("Oostkust");
  expect(screen.getByRole("heading", { name: "Routevoorbeeld" })).toBeTruthy();
  expect(screen.getByText("2 algemene punten in deze route.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("Oostkust");
  expect(screen.getByRole("heading", { name: "Route tekenen op kaart" })).toBeTruthy();
  expect(screen.getByText("2 punten · minstens twee punten zijn nodig.")).toBeTruthy();
  fireEvent.click(screen.getByText("Geavanceerd: coördinaten als JSON plakken"));
  expect((screen.getByLabelText("Lijncoördinaten (JSON)") as HTMLTextAreaElement).value).toBe("[[121.5,25],[121.6,25.1]]");
  fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Oostkust noord" } });
  fireEvent.click(screen.getByRole("button", { name: "Route opslaan" }));
  await screen.findByRole("button", { name: "Route Oostkust noord bekijken" });
  expect(screen.queryByRole("button", { name: "Route Oostkust bekijken" })).toBeNull();
  expect(screen.getByText("Route op kaart opgeslagen als een afzonderlijk, bewust geschreven lijn.")).toBeTruthy();
  expect(screen.queryByLabelText("Label")).toBeNull();
});

it("forgets a deleted broad route after the in-app confirmation", async () => {
  renderWithOwner(<TrackManager trip={trip} />);
  await openRoute("Westkust");
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Route Westkust bekijken" })).toBeNull());
  expect(screen.getByRole("button", { name: "Route Oostkust bekijken" })).toBeTruthy();
  expect(screen.getByText("Route op kaart verwijderd.")).toBeTruthy();
});

it("only sends a broad route with at least two valid points", async () => {
  renderWithOwner(<TrackManager trip={trip} />);
  await screen.findByText("Oostkust");
  fireEvent.click(screen.getByRole("button", { name: "Nieuwe route" }));
  fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Zuidkust" } });
  fireEvent.change(screen.getByLabelText("Lijncoördinaten (JSON)"), { target: { value: "[[121.5,25]]" } });
  fireEvent.click(screen.getByRole("button", { name: "Route maken" }));
  await screen.findByText("Een route op kaart heeft minstens twee algemene punten nodig.");
  fireEvent.change(screen.getByLabelText("Lijncoördinaten (JSON)"), { target: { value: "geen json" } });
  fireEvent.click(screen.getByRole("button", { name: "Route maken" }));
  await screen.findByText("Gebruik geldige JSON met minstens twee [lengtegraad, breedtegraad]-paren.");
  expect(api.count("POST /api/trips/trip/broad-routes")).toBe(0);

  fireEvent.change(screen.getByLabelText("Lijncoördinaten (JSON)"), { target: { value: "[[121.5,25],[121.7,25.2]]" } });
  fireEvent.click(screen.getByRole("button", { name: "Route maken" }));
  await screen.findByRole("button", { name: "Route Zuidkust bekijken" });
  expect(api.lastBody("POST /api/trips/trip/broad-routes")).toMatchObject({ label: "Zuidkust", geometry: { type: "LineString", coordinates: [[121.5, 25], [121.7, 25.2]] } });
});

it("uploads a finished track as multipart and lists it afterwards", async () => {
  api.on("POST", /\/recorded-tracks\/uploads$/, (body) => {
    expect(body).toBeInstanceOf(FormData);
    return api.push("/api/trips/trip/recorded-tracks", { ...track, id: "t2", kind: "point_array", byte_size: 10 });
  });
  renderWithOwner(<TrackManager trip={trip} />);
  await screen.findByText(/GPX-track/);
  fireEvent.click(screen.getByRole("button", { name: "Track uploaden" }));
  fireEvent.click(screen.getByRole("button", { name: "Afgewerkte track uploaden" }));
  await screen.findByText("Kies een afgewerkt GPX- of JSON-bestand.");
  expect(api.count("POST /api/trips/trip/recorded-tracks/uploads")).toBe(0);

  const file = new File(["{}"], "track.json", { type: "application/json" });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText("Bestandstype"), { target: { value: "point_array" } });
  fireEvent.click(screen.getByRole("button", { name: "Afgewerkte track uploaden" }));
  await screen.findByText("JSON-puntenlijst");
  const sent = api.lastBody<FormData>("POST /api/trips/trip/recorded-tracks/uploads")!;
  expect(sent.get("kind")).toBe("point_array");
  expect((sent.get("file") as File).type).toBe("application/json");
  expect(screen.getByText("Afgewerkte track opgeslagen. Er is geen opname- of achtergrondlocatiefunctie.")).toBeTruthy();
  expect(screen.queryByLabelText("Bestandstype")).toBeNull();
});

it("opens a private track through the authenticated download, never as a link", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
  stubObjectUrls("blob:track");
  api.on("GET", /\/recorded-tracks\/t1\/source$/, () => "gpx");
  renderWithOwner(<TrackManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Privébestand bekijken" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith("blob:track", "_blank", "noopener"));
  const [, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(([url]) => url.endsWith("/source"))!;
  expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
});
