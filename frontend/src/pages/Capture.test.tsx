// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import { clearDraft, emptyDraft, readDraft, saveDraft, type Moment, type Trip } from "../tracker-model";
import { Capture } from "./Capture";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const moment = (id: string, title: string): Moment => ({ id, occurred_at: "2054-11-17T10:00:00Z", title, story: "Nachtmarkt", place: null, media_asset_ids: [] });
let state: { trip: Trip };
let api: FakeApi;

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  clearDraft();
  state = { trip: { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, visibility: "private", publication_state: "draft", route_stages: [], highlights: [], moments: [moment("m1", "Eerste avond"), moment("m2", "Tweede dag")], moment_excerpts: [] } };
  api = fakeApi().collection("/api/trips/trip/media", [{ id: "p1", media_kind: "photo", original_filename: "markt.jpg", captured_at: null, gps: null }]);
  api.on("GET", /^\/api\/trips$/, () => [state.trip]);
  api.on("POST", /^\/api\/trips\/trip\/moments$/, (body) => { const created = { id: `new-${state.trip.moments.length}`, place: null, ...(body as object) } as Moment; state.trip = { ...state.trip, moments: [...state.trip.moments, created] }; return created; });
  api.on("PATCH", /^\/api\/trips\/trip\/moments\/([^/]+)$/, (body, match) => { state.trip = { ...state.trip, moments: state.trip.moments.map((item) => item.id === match[1] ? { ...item, ...(body as object) } : item) }; return state.trip.moments.find((item) => item.id === match[1]); });
  api.on("DELETE", /^\/api\/trips\/trip\/moments\/([^/]+)$/, (_body, match) => { state.trip = { ...state.trip, moments: state.trip.moments.filter((item) => item.id !== match[1]) }; return undefined; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); clearDraft(); expect(api.unexpected).toEqual([]); });

const renderCapture = () => renderWithOwner(<MemoryRouter><Capture /></MemoryRouter>);
const savedMoments = () => within(screen.getByRole("heading", { name: "Opgeslagen momenten" }).closest("section")!);

it("restores a local draft and keeps it up to date while typing", async () => {
  saveDraft({ ...emptyDraft("trip"), title: "Terug van gisteren", story: "Regen" });
  renderCapture();
  const title = await screen.findByLabelText("Titel") as HTMLInputElement;
  expect(title.value).toBe("Terug van gisteren");
  fireEvent.change(title, { target: { value: "Terug van eergisteren" } });
  await waitFor(() => expect(readDraft()?.title).toBe("Terug van eergisteren"));
  expect(screen.getByText("Concept lokaal bewaard — nog niet naar je reis gestuurd.")).toBeTruthy();
});

it("asks for a title and a story before anything is sent", async () => {
  renderCapture();
  fireEvent.click(await screen.findByRole("button", { name: "Moment opslaan" }));
  await screen.findByText("Geef het moment een titel.");
  await screen.findByText("Schrijf wat je wilt onthouden.");
  expect(api.count("POST /api/trips/trip/moments")).toBe(0);
});

it("saves a new moment, lists it at once and clears the local draft", async () => {
  renderCapture();
  fireEvent.change(await screen.findByLabelText("Titel"), { target: { value: "Nachtmarkt" } });
  fireEvent.change(screen.getByLabelText("Je moment"), { target: { value: "Pindakaas-ijs" } });
  fireEvent.click(screen.getByRole("button", { name: "Moment opslaan" }));
  await screen.findByText("Moment opgeslagen.");
  await waitFor(() => expect(savedMoments().getByText("Nachtmarkt")).toBeTruthy());
  expect(api.lastBody("POST /api/trips/trip/moments")).toMatchObject({ title: "Nachtmarkt", story: "Pindakaas-ijs", place: null, media_asset_ids: [] });
  expect(readDraft()).toBeNull();
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("heading", { name: "Nieuw moment" })).toBeTruthy();
});

it("opens a saved moment prefilled and shows its edit at once", async () => {
  renderCapture();
  fireEvent.click(await screen.findByRole("button", { name: /Eerste avond/ }));
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Eerste avond");
  expect((screen.getByLabelText("Je moment") as HTMLTextAreaElement).value).toBe("Nachtmarkt");
  expect(screen.getByRole("heading", { name: "Moment bewerken" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Eerste avond in Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Wijzigingen opslaan" }));
  await waitFor(() => expect(savedMoments().getByText("Eerste avond in Taipei")).toBeTruthy());
  expect(savedMoments().queryByText("Eerste avond")).toBeNull();
  expect(screen.getByRole("heading", { name: "Nieuw moment" })).toBeTruthy();
});

it("removes a deleted moment from the list after the browser confirmation", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderCapture();
  fireEvent.click(await screen.findByRole("button", { name: /Tweede dag/ }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  await waitFor(() => expect(savedMoments().queryByText("Tweede dag")).toBeNull());
  expect(savedMoments().getByText("Eerste avond")).toBeTruthy();
  expect(screen.getByText("Moment verwijderd.")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Nieuw moment" })).toBeTruthy();
});

it("keeps the typed moment and says the local draft is safe when the server refuses", async () => {
  renderCapture();
  fireEvent.change(await screen.findByLabelText("Titel"), { target: { value: "Nachtmarkt" } });
  fireEvent.change(screen.getByLabelText("Je moment"), { target: { value: "Pindakaas-ijs" } });
  api.failNext = { status: 500, body: {} };
  fireEvent.click(screen.getByRole("button", { name: "Moment opslaan" }));
  await screen.findByText("Het moment kon niet worden opgeslagen. Je lokale concept blijft bewaard.");
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Nachtmarkt");
  expect(readDraft()?.title).toBe("Nachtmarkt");
});

it("explains that the trips wait for a connection when offline from the start", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  renderCapture();
  await screen.findByText("Je bent offline. Je reizen laden zodra je opnieuw verbinding hebt.");
  expect(api.requests).toEqual([]);
});

it("does not send anything while offline and keeps the draft local", async () => {
  renderCapture();
  const title = await screen.findByLabelText("Titel");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  act(() => { window.dispatchEvent(new Event("offline")); });
  await screen.findByText(/Offline — concepten blijven lokaal/);
  fireEvent.change(title, { target: { value: "Nachtmarkt" } });
  fireEvent.change(screen.getByLabelText("Je moment"), { target: { value: "Pindakaas-ijs" } });
  fireEvent.click(screen.getByRole("button", { name: "Moment opslaan" }));
  await screen.findByText("Je bent offline. Dit concept blijft alleen lokaal bewaard en wordt niet automatisch verstuurd.");
  expect(api.count("POST /api/trips/trip/moments")).toBe(0);
  expect(readDraft()?.title).toBe("Nachtmarkt");
});

it("searches a place, lets the owner choose it and sends it with the moment", async () => {
  api.on("POST", /\/places\/search$/, () => ({ attribution: "OpenStreetMap", attribution_url: "https://osm.example", results: [{ display_name: "Taipei Main Station", osm_element_type: "node", osm_element_id: "1", locality: "Taipei" }] }));
  renderCapture();
  await screen.findByLabelText("Titel");
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  await screen.findByText("Vul minstens twee tekens in om een plaats te zoeken.");
  fireEvent.change(screen.getByLabelText("Zoek plaats"), { target: { value: "Taipei Main" } });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Taipei Main Station" }));
  await screen.findByText("Plaats geselecteerd. Hij wordt pas gemaakt wanneer je het moment opslaat.");
  expect(api.lastBody("POST /api/trips/trip/places/search")).toEqual({ query: "Taipei Main" });

  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Aankomst" } });
  fireEvent.change(screen.getByLabelText("Je moment"), { target: { value: "Moe" } });
  fireEvent.click(screen.getByRole("button", { name: "Moment opslaan" }));
  await screen.findByText("Moment opgeslagen.");
  expect(api.lastBody<{ place: { display_name: string } }>("POST /api/trips/trip/moments")?.place.display_name).toBe("Taipei Main Station");
});

it("links a private photo to the moment", async () => {
  renderCapture();
  fireEvent.click(await screen.findByLabelText("markt.jpg"));
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Markt" } });
  fireEvent.change(screen.getByLabelText("Je moment"), { target: { value: "Fruit" } });
  fireEvent.click(screen.getByRole("button", { name: "Moment opslaan" }));
  await screen.findByText("Moment opgeslagen.");
  expect(api.lastBody("POST /api/trips/trip/moments")).toMatchObject({ media_asset_ids: ["p1"] });
});
