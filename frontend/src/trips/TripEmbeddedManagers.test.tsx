// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { useTripsQuery } from "../query/owner-queries";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { BroadPlace, MomentExcerpt, RouteStage, Trip, TripHighlight } from "../tracker-model";
import { HighlightManager } from "./HighlightManager";
import { MomentExcerptManager } from "./MomentExcerptManager";
import { RouteStageManager } from "./RouteStageManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const taipei: BroadPlace = { id: "taipei", label: "Taipei", country_code: "TW", region: null, latitude: null, longitude: null, timezone: null };
const tainan: BroadPlace = { id: "tainan", label: "Tainan", country_code: "TW", region: null, latitude: null, longitude: null, timezone: null };
const highlight = (id: string, title: string, position: number): TripHighlight => ({ id, title, summary: null, position });
const stage = (id: string, label: string, position: number): RouteStage => ({ id, label, summary: null, position, place: taipei });
const excerpt = (id: string, title: string): MomentExcerpt => ({ id, source_moment_id: null, broad_place_id: null, date_precision: "day", story_date: null, title, body: "De eerste avond." });

let state: { trip: Trip };
let api: FakeApi;

/** Highlights, stages and excerpts live inside the trip: writes change it and the trip list is what refreshes. */
function embed(key: "highlights" | "route_stages" | "moment_excerpts", path: string, shape: (item: Record<string, unknown>) => Record<string, unknown> = (item) => item) {
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
  state = { trip: { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, visibility: "private", publication_state: "draft", route_stages: [stage("s1", "Noordkust", 0), stage("s2", "Zuiden", 1)], highlights: [highlight("h1", "Stad ↔ natuur", 0), highlight("h2", "Eten", 1)], moments: [], moment_excerpts: [excerpt("e1", "Aankomst"), excerpt("e2", "Vertrek")] } };
  api = fakeApi();
  api.on("GET", /^\/api\/trips$/, () => [state.trip]);
  embed("highlights", "highlights");
  embed("route_stages", "route-stages", (item) => ({ ...item, place: [taipei, tainan].find((place) => place.id === item.broad_place_id) ?? item.place }));
  embed("moment_excerpts", "moment-excerpts");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); expect(api.unexpected).toEqual([]); });

const confirmDelete = () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }));

it("shows an edited highlight at once and never the old title", async () => {
  renderWithOwner(<Screen>{(trip) => <HighlightManager trip={trip} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Hoogtepunt Eten bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Eten en drinken" } });
  fireEvent.click(screen.getByRole("button", { name: "Hoogtepunt opslaan" }));
  await screen.findByRole("button", { name: "Hoogtepunt Eten en drinken bekijken" });
  expect(screen.queryByRole("button", { name: "Hoogtepunt Eten bekijken" })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Hoogtepunt opgeslagen. Het is nog niet gedeeld.")).toBeTruthy();
});

it("removes a deleted highlight and keeps the order of the rest", async () => {
  renderWithOwner(<Screen>{(trip) => <HighlightManager trip={trip} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Hoogtepunt Stad ↔ natuur bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  expect(api.count("DELETE /api/trips/trip/highlights/h1")).toBe(0);
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Hoogtepunt Stad ↔ natuur bekijken" })).toBeNull());
  expect(screen.getByRole("button", { name: "Hoogtepunt Eten bekijken" })).toBeTruthy();
  expect(screen.getByText("Hoogtepunt verwijderd.")).toBeTruthy();
});

it("reorders highlights from the refetched trip", async () => {
  renderWithOwner(<Screen>{(trip) => <HighlightManager trip={trip} />}</Screen>);
  await screen.findByRole("button", { name: "Hoogtepunt Eten bekijken" });
  fireEvent.click(screen.getAllByRole("button", { name: "Omlaag" })[0]);
  await waitFor(() => expect(screen.getAllByRole("button", { name: /bekijken$/ }).map((button) => button.getAttribute("aria-label"))).toEqual(["Hoogtepunt Eten bekijken", "Hoogtepunt Stad ↔ natuur bekijken"]));
});

it("shows an edited route stage and forgets a deleted one", async () => {
  renderWithOwner(<Screen>{(trip) => <RouteStageManager trip={trip} broadPlaces={[taipei, tainan]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Route-etappe Zuiden bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Etappelabel (optioneel)"), { target: { value: "Zuidkust" } });
  fireEvent.click(screen.getByRole("button", { name: "Etappe opslaan" }));
  await screen.findByRole("button", { name: "Route-etappe Zuidkust bekijken" });
  expect(screen.queryByRole("button", { name: "Route-etappe Zuiden bekijken" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Route-etappe Noordkust bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Route-etappe Noordkust bekijken" })).toBeNull());
  expect(screen.getByText(/etappe 1/)).toBeTruthy();
});

it("requires a broad place before a route stage is sent", async () => {
  renderWithOwner(<Screen>{(trip) => <RouteStageManager trip={trip} broadPlaces={[taipei]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe etappe" }));
  fireEvent.click(screen.getByRole("button", { name: "Etappe toevoegen" }));
  await screen.findByText("Kies eerst een brede plaats.");
  expect(api.count("POST /api/trips/trip/route-stages")).toBe(0);
  fireEvent.change(screen.getByLabelText("Brede plaats"), { target: { value: "taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Etappe toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("POST /api/trips/trip/route-stages")).toMatchObject({ broad_place_id: "taipei", position: 2 });
});

it("opens an excerpt in detail before editing and asks before discarding edits", async () => {
  renderWithOwner(<Screen>{(trip) => <MomentExcerptManager trip={trip} broadPlaces={[]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Uittreksel Aankomst bekijken" }));
  expect(await screen.findByRole("heading", { name: "Aankomst" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Uittreksel bewerken" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Late aankomst" } });
  fireEvent.click(screen.getByRole("button", { name: /Uittreksel bewerken sluiten/ }));
  expect(screen.getByText("Wijzigingen verwerpen?")).toBeTruthy();
});

it("keeps the typed excerpt after a rejected save and marks the field", async () => {
  renderWithOwner(<Screen>{(trip) => <MomentExcerptManager trip={trip} broadPlaces={[]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw uittreksel" }));
  expect(screen.getByRole("heading", { name: "Uittreksel maken" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Nieuw verhaal" } });
  fireEvent.change(screen.getByLabelText("Uittreksel"), { target: { value: "Tekst" } });
  api.failNext = { status: 422, body: { detail: [{ loc: ["body", "title"], msg: "Deze titel bestaat al." }] } };
  fireEvent.click(screen.getByRole("button", { name: "Uittreksel maken" }));
  await screen.findByText("Deze titel bestaat al.", { selector: ".field-error" });
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Nieuw verhaal");
});

it("adds an excerpt to the list once saved", async () => {
  renderWithOwner(<Screen>{(trip) => <MomentExcerptManager trip={trip} broadPlaces={[]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw uittreksel" }));
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Nieuw verhaal" } });
  fireEvent.change(screen.getByLabelText("Uittreksel"), { target: { value: "Tekst" } });
  fireEvent.click(screen.getByRole("button", { name: "Uittreksel maken" }));
  await screen.findByRole("button", { name: "Uittreksel Nieuw verhaal bekijken" });
  expect(screen.getByText("Uittreksel opgeslagen. Het is nog niet gedeeld.")).toBeTruthy();
});

it("shows an edited excerpt and removes a deleted one only after the in-app confirmation", async () => {
  renderWithOwner(<Screen>{(trip) => <MomentExcerptManager trip={trip} broadPlaces={[]} />}</Screen>);
  fireEvent.click(await screen.findByRole("button", { name: "Uittreksel Vertrek bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  // The editor opens with the saved record, not a blank form.
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Vertrek");
  expect((screen.getByLabelText("Uittreksel") as HTMLTextAreaElement).value).toBe("De eerste avond.");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Terugvlucht" } });
  fireEvent.click(screen.getByRole("button", { name: "Uittreksel opslaan" }));
  await screen.findByRole("button", { name: "Uittreksel Terugvlucht bekijken" });
  expect(screen.queryByRole("button", { name: "Uittreksel Vertrek bekijken" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Uittreksel Aankomst bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  expect(api.count("DELETE /api/trips/trip/moment-excerpts/e1")).toBe(0);
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Uittreksel Aankomst bekijken" })).toBeNull());
  expect(api.count("DELETE /api/trips/trip/moment-excerpts/e1")).toBe(1);
});
