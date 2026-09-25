// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { useTripsQuery } from "../query/owner-queries";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { BroadPlace, RouteStage, TravelUpdate, Trip } from "../tracker-model";
import { RouteStageManager } from "./RouteStageManager";
import { TravelUpdateManager } from "./TravelUpdateManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const taipei: BroadPlace = { id: "taipei", visibility: "private", label: "Taipei", country_code: "TW", region: null, latitude: null, longitude: null, timezone: null };
const tainan: BroadPlace = { id: "tainan", visibility: "private", label: "Tainan", country_code: "TW", region: null, latitude: null, longitude: null, timezone: null };
const stage = (id: string, label: string, position: number): RouteStage => ({ id, label, summary: null, position, place: taipei, visibility: "private" });
const update = (id: string, title: string, visibility: TravelUpdate["visibility"] = "private"): TravelUpdate => ({ id, occurred_at: "2054-11-16T10:00:00Z", date_precision: "day", title, body: "De eerste avond.", private_notes: null, broad_place_id: null, place: null, media_asset_ids: [], visibility });

let state: { trip: Trip };
let api: FakeApi;

/** Stages and travel updates live inside the trip: writes change it and the trip list is what refreshes. */
function embed(key: "route_stages" | "travel_updates", path: string, shape: (item: Record<string, unknown>) => Record<string, unknown> = (item) => item) {
  const list = () => state.trip[key] as { id: string }[];
  const set = (items: unknown[]) => { state.trip = { ...state.trip, [key]: items }; };
  api.on("POST", new RegExp(`^/api/trips/trip/${path}$`), (body) => { const created = shape({ id: `new-${list().length}`, position: list().length, ...(body as object) }); set([...list(), created]); return created; });
  api.on("PATCH", new RegExp(`^/api/trips/trip/${path}/([^/]+)$`), (body, match) => {
    const move = (body as { position?: number }).position;
    if (move !== undefined) {
      const items = list().slice() as { id: string; position: number }[];
      const from = items.findIndex((item) => item.id === match[1]);
      const [moved] = items.splice(from, 1);
      items.splice(move, 0, moved);
      set(items.map((item, position) => ({ ...item, position })));
      return moved;
    }
    set(list().map((item) => item.id === match[1] ? shape({ ...item, ...(body as object) }) : item));
    return list().find((item) => item.id === match[1]);
  });
  api.on("DELETE", new RegExp(`^/api/trips/trip/${path}/([^/]+)$`), (_body, match) => { set(list().filter((item) => item.id !== match[1])); return undefined; });
}

function Screen({ children }: { children: (trip: Trip) => ReactNode }) {
  const trip = useTripsQuery().data?.[0];
  return trip ? <>{children(trip)}</> : null;
}

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  state = { trip: { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, route_stages: [stage("s1", "Noordkust", 0), stage("s2", "Zuiden", 1)], travel_updates: [update("e1", "Aankomst"), update("e2", "Vertrek")] } };
  api = fakeApi();
  api.collection("/api/trips/trip/places", []);
  api.on("GET", /^\/api\/trips$/, () => [state.trip]);
  embed("route_stages", "route-stages", (item) => ({ ...item, place: [taipei, tainan].find((place) => place.id === item.broad_place_id) ?? item.place }));
  embed("travel_updates", "travel-updates");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); expect(api.unexpected).toEqual([]); });

const confirmDelete = () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }));

it("shows an edited route stage and forgets a deleted one", async () => {
  renderWithOwner(<Screen>{(trip) => <RouteStageManager trip={trip} broadPlaces={[taipei, tainan]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Halte Zuiden bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Naam van halte (optioneel)"), { target: { value: "Zuidkust" } });
  fireEvent.click(screen.getByRole("button", { name: "Halte opslaan" }));
  await screen.findByRole("button", { name: "Halte Zuidkust bekijken" });
  expect(screen.queryByRole("button", { name: "Halte Zuiden bekijken" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Halte Noordkust bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Halte Noordkust bekijken" })).toBeNull());
  expect(screen.getByText(/halte 1/)).toBeTruthy();
});

it("requires a broad place before a route stage is sent", async () => {
  renderWithOwner(<Screen>{(trip) => <RouteStageManager trip={trip} broadPlaces={[taipei]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe halte" }));
  fireEvent.click(screen.getByRole("button", { name: "Halte toevoegen" }));
  await screen.findByText("Kies eerst een plaats.");
  expect(api.count("POST /api/trips/trip/route-stages")).toBe(0);
  fireEvent.change(screen.getByLabelText("Plaats"), { target: { value: "taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Halte toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("POST /api/trips/trip/route-stages")).toMatchObject({ broad_place_id: "taipei", position: 2 });
});

it("opens a travel update in detail before editing and asks before discarding edits", async () => {
  renderWithOwner(<Screen>{(trip) => <TravelUpdateManager trip={trip} broadPlaces={[]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Reisupdate Aankomst bekijken" }));
  expect(await screen.findByRole("heading", { name: "Aankomst" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Reisupdate bewerken" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Late aankomst" } });
  fireEvent.click(screen.getByRole("button", { name: /Reisupdate bewerken sluiten/ }));
  expect(screen.getByText("Wijzigingen verwerpen?")).toBeTruthy();
});

it("keeps the typed update after a rejected save and marks the field", async () => {
  renderWithOwner(<Screen>{(trip) => <TravelUpdateManager trip={trip} broadPlaces={[]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe update" }));
  expect(screen.getByRole("heading", { name: "Reisupdate maken" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Nieuw verhaal" } });
  fireEvent.change(screen.getByLabelText(/^Tekst voor bezoekers/), { target: { value: "Tekst" } });
  api.failNext = { status: 422, body: { detail: [{ loc: ["body", "title"], msg: "Deze titel bestaat al." }] } };
  fireEvent.click(screen.getByRole("button", { name: "Reisupdate maken" }));
  await screen.findByText("Deze titel bestaat al.", { selector: ".field-error" });
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Nieuw verhaal");
});

it("adds an update to the list once saved", async () => {
  renderWithOwner(<Screen>{(trip) => <TravelUpdateManager trip={trip} broadPlaces={[]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe update" }));
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Nieuw verhaal" } });
  fireEvent.change(screen.getByLabelText(/^Tekst voor bezoekers/), { target: { value: "Tekst" } });
  fireEvent.click(screen.getByRole("button", { name: "Reisupdate maken" }));
  await screen.findByRole("button", { name: "Reisupdate Nieuw verhaal bekijken" });
  expect(screen.getByText("Reisupdate opgeslagen.")).toBeTruthy();
});

it("shows an edited update and removes it only after the in-app confirmation", async () => {
  renderWithOwner(<Screen>{(trip) => <TravelUpdateManager trip={trip} broadPlaces={[]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Reisupdate Vertrek bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  // The editor opens with the saved record, not a blank form.
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Vertrek");
  expect((screen.getByLabelText(/^Tekst voor bezoekers/) as HTMLTextAreaElement).value).toBe("De eerste avond.");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Terugvlucht" } });
  fireEvent.click(screen.getByRole("button", { name: "Reisupdate opslaan" }));
  await screen.findByRole("button", { name: "Reisupdate Terugvlucht bekijken" });
  expect(screen.queryByRole("button", { name: "Reisupdate Vertrek bekijken" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Reisupdate Aankomst bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  expect(api.count("DELETE /api/trips/trip/travel-updates/e1")).toBe(0);
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Reisupdate Aankomst bekijken" })).toBeNull());
  expect(api.count("DELETE /api/trips/trip/travel-updates/e1")).toBe(1);
});

it("saves who may see an update with the update itself, private by default", async () => {
  renderWithOwner(<Screen>{(trip) => <TravelUpdateManager trip={trip} broadPlaces={[]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe update" }));
  expect((screen.getByLabelText("Zichtbaarheid") as HTMLSelectElement).value).toBe("private");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Voor iedereen" } });
  fireEvent.change(screen.getByLabelText(/^Tekst voor bezoekers/), { target: { value: "Tekst" } });
  fireEvent.change(screen.getByLabelText("Zichtbaarheid"), { target: { value: "everyone" } });
  fireEvent.click(screen.getByRole("button", { name: "Reisupdate maken" }));
  await screen.findByRole("button", { name: "Reisupdate Voor iedereen bekijken" });
  expect(api.lastBody("POST /api/trips/trip/travel-updates")).toMatchObject({ visibility: "everyone" });
  // The list says who sees each update.
  expect(screen.getByRole("button", { name: "Reisupdate Voor iedereen bekijken" }).textContent).toContain("Iedereen");
  expect(screen.getByRole("button", { name: "Reisupdate Aankomst bekijken" }).textContent).toContain("Privé");
});
