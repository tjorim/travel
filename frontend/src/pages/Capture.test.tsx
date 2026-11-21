import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { mockCaptureLocks } from "../capture-draft-test-utils";
import { createRootRoute } from "@tanstack/react-router";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { server } from "../mocks/server";

import { fakeApi, resolveTexts, type FakeApi } from "../query/fake-api";
import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import { answerConfirmation } from "../test-confirm";
import { emptyDraft, readDraft, saveDraft } from "../capture-draft";
import { type TravelUpdate, type Trip } from "../api-types";
import { Capture } from "./Capture";

const routeTree = createRootRoute({ component: Capture });

const auth = vi.hoisted(() => ({
  session: null as { accessToken: string; expiresAt: number } | null,
}));
vi.mock("@/app/providers/auth-context", () => ({ useAuth: () => auth }));

const update = (id: string, title: string): TravelUpdate => ({
  area: null,
  body_html: null,
  private_notes_html: null,
  id,
  occurred_at: "2054-11-17T10:00:00Z",
  timezone: "UTC",
  local_date: "2054-11-17",
  share_date_precision: "day",
  title,
  title_nl: title,
  title_en: null,
  body: "",
  body_nl: "",
  body_en: null,
  private_notes: "Nachtmarkt",
  area_id: null,
  location: null,
  media_asset_ids: [],
  visibility: "private",
});
let state: { trip: Trip };
let api: FakeApi;

beforeEach(() => {
  mockCaptureLocks();
  auth.session = { accessToken: testToken(), expiresAt: Date.now() + 3600000 };
  localStorage.clear();
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ ...auth.session, expiresAt: Date.now() + 3600000 }),
  );
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  state = {
    trip: {
      owner_subject: "owner-1",
      content_language: "nl",
      cover_derivative_id: null,
      cover_url: null,
      summary_html: null,
      id: "trip",
      title: "Exampleland",
      title_nl: "Exampleland",
      title_en: null,
      summary: null,
      summary_nl: null,
      summary_en: null,
      starts_on: null,
      ends_on: null,
      travel_updates: [update("m1", "Eerste avond"), update("m2", "Tweede dag")],
    },
  };
  api = fakeApi().collection<Api.MediaAssetResponse>("/api/trips/trip/media", [
    {
      byte_size: 0,
      content_type: "synthetic",
      captured_local: false,
      created_at: "2054-01-01T00:00:00Z",
      deleted_at: null,
      camera_make: null,
      camera_model: null,
      file_url: "/api/trips/trip/media/p1/original",
      thumbnail_url: null,
      id: "p1",
      media_kind: "photo",
      original_filename: "markt.jpg",
      captured_at: null,
      gps: null,
    },
  ]);
  api.on<string>(
    /* Fixture exception: Private photo stream, not a JSON API response. */ "GET",
    /media\/p1\/original$/,
    () => "synthetic image bytes",
  );
  api.on<Api.TripSummaryResponse[]>("GET", /^\/api\/trips$/, () => [
    {
      owner_subject: "synthetic",
      title_nl: null,
      title_en: null,
      summary_nl: null,
      summary_en: null,
      cover_derivative_id: null,
      cover_url: null,
      summary_html: null,
      id: state.trip.id,
      content_language: "nl",
      title: state.trip.title,
      summary: null,
      starts_on: null,
      ends_on: null,
      travel_update_count: state.trip.travel_updates.length,
      last_update_at: null,
    },
  ]);
  api.on<Api.TravelUpdateResponse[]>(
    "GET",
    /^\/api\/trips\/trip\/travel-updates$/,
    () => state.trip.travel_updates,
  );
  api.on<Api.TravelUpdateResponse>("POST", /^\/api\/trips\/trip\/travel-updates$/, (body) => {
    const created = {
      id: `new-${state.trip.travel_updates.length}`,
      location: null,
      ...(body as object),
    } as TravelUpdate;
    state.trip = { ...state.trip, travel_updates: [...state.trip.travel_updates, created] };
    return created;
  });
  api.on<Api.TravelUpdateResponse>(
    "PATCH",
    /^\/api\/trips\/trip\/travel-updates\/([^/]+)$/,
    (body, match) => {
      state.trip = {
        ...state.trip,
        travel_updates: state.trip.travel_updates.map((item) =>
          item.id === match[1] ? resolveTexts({ ...item, ...(body as object) }) : item,
        ),
      };
      return state.trip.travel_updates.find((item) => item.id === match[1]);
    },
  );
  api.on<undefined>("DELETE", /^\/api\/trips\/trip\/travel-updates\/([^/]+)$/, (_body, match) => {
    state.trip = {
      ...state.trip,
      travel_updates: state.trip.travel_updates.filter((item) => item.id !== match[1]),
    };
    return undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(api.unexpected).toEqual([]);
});

/** Date and time, the private note, linked library photos and the location sit under "Meer". */
const openMore = async () => {
  const trigger = await screen.findByRole("button", { name: /^Meer/ });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
};
const renderCapture = () => renderRoutesWithOwner(routeTree, ["/"]);
const savedUpdates = () =>
  within(screen.getByRole("heading", { name: "Opgeslagen reisupdates" }).closest("section")!);

it("restores a local draft and keeps it up to date while typing", async () => {
  await saveDraft({ ...emptyDraft("trip"), title: "Terug van gisteren", notes: "Regen" });
  renderCapture();
  const title = (await screen.findByLabelText("Titel")) as HTMLInputElement;
  expect(title.value).toBe("Terug van gisteren");
  fireEvent.change(title, { target: { value: "Terug van eergisteren" } });
  await waitFor(() => expect(readDraft("trip")?.title).toBe("Terug van eergisteren"));
  expect(screen.getByText("Concept lokaal bewaard — nog niet naar je reis gestuurd.")).toBeTruthy();
});

it("edits a saved title in the language it was written in, and marks the input with it", async () => {
  state.trip.travel_updates = [
    { ...update("m3", "First evening"), title_nl: null, title_en: "First evening" },
  ];
  renderCapture();
  fireEvent.click(await screen.findByRole("button", { name: /First evening/ }));
  const title = screen.getByLabelText("Titel") as HTMLInputElement;
  // The trip is Dutch, this title is English: the input says so, and a new title would say Dutch.
  expect(title.lang).toBe("en");
  fireEvent.change(title, { target: { value: "First evening in Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Wijzigingen opslaan" }));
  await waitFor(() => expect(savedUpdates().getByText("First evening in Taipei")).toBeTruthy());
  const sent = api.lastBody("PATCH /api/trips/trip/travel-updates/m3");
  expect(sent).toMatchObject({ title_en: "First evening in Taipei" });
  expect(sent).not.toHaveProperty("title");
  expect(sent).not.toHaveProperty("title_nl");
});

it("does not save a restored edit of a saved update before it knows what language its title is in", async () => {
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => (release = resolve));
  state.trip.travel_updates = [
    { ...update("m3", "First evening"), title_nl: null, title_en: "First evening" },
  ];
  server.use(
    http.get("/api/trips/trip/travel-updates", async () => {
      await hold;
      return HttpResponse.json<Api.TravelUpdateResponse[]>(state.trip.travel_updates);
    }),
  );
  await saveDraft({ ...emptyDraft("trip"), updateId: "m3", title: "First evening, edited" });
  renderCapture();
  const title = (await screen.findByLabelText("Titel")) as HTMLInputElement;
  expect(title.value).toBe("First evening, edited");
  fireEvent.click(screen.getByRole("button", { name: "Wijzigingen opslaan" }));
  expect(await screen.findByText(/opgeslagen reisupdate wordt nog geladen/)).toBeTruthy();
  // Nothing was sent: the plain title would have gone into the trip's Dutch title.
  expect(api.count("PATCH /api/trips/trip/travel-updates/m3")).toBe(0);
  release();
  await waitFor(() => expect(title.lang).toBe("en"));
  fireEvent.click(screen.getByRole("button", { name: "Wijzigingen opslaan" }));
  await waitFor(() => expect(api.count("PATCH /api/trips/trip/travel-updates/m3")).toBe(1));
  expect(api.lastBody("PATCH /api/trips/trip/travel-updates/m3")).toMatchObject({
    title_en: "First evening, edited",
  });
});

it("asks for a title, but not for notes, before anything is sent", async () => {
  renderCapture();
  fireEvent.click(await screen.findByRole("button", { name: "Reisupdate opslaan" }));
  await screen.findByText("Geef de reisupdate een titel.");
  expect(screen.queryByText("Schrijf wat je wilt onthouden.")).toBeNull();
  expect(api.count("POST /api/trips/trip/travel-updates")).toBe(0);
});

it("saves a new update, lists it at once and clears the local draft", async () => {
  renderCapture();
  fireEvent.change(await screen.findByLabelText("Titel"), { target: { value: "Nachtmarkt" } });
  await openMore();
  fireEvent.change(screen.getByLabelText("Privénotitie (optioneel)"), {
    target: { value: "Pindakaas-ijs" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Reisupdate opslaan" }));
  await screen.findByText("Reisupdate opgeslagen.");
  await waitFor(() => expect(savedUpdates().getByText("Nachtmarkt")).toBeTruthy());
  expect(api.lastBody("POST /api/trips/trip/travel-updates")).toMatchObject({
    title: "Nachtmarkt",
    private_notes: "Pindakaas-ijs",
    location: null,
    media_asset_ids: [],
  });
  expect(readDraft("trip")).toBeNull();
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("heading", { name: "Nieuwe reisupdate" })).toBeTruthy();
});

it("opens a saved update prefilled and shows its edit at once", async () => {
  renderCapture();
  fireEvent.click(await screen.findByRole("button", { name: /Eerste avond/ }));
  // Editing a saved update shows its note and place at once.
  expect(screen.getByRole("button", { name: /^Meer/ }).getAttribute("aria-expanded")).toBe("true");
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Eerste avond");
  expect((screen.getByLabelText("Privénotitie (optioneel)") as HTMLTextAreaElement).value).toBe(
    "Nachtmarkt",
  );
  expect(screen.getByRole("heading", { name: "Reisupdate bewerken" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Eerste avond in Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Wijzigingen opslaan" }));
  await waitFor(() => expect(savedUpdates().getByText("Eerste avond in Taipei")).toBeTruthy());
  expect(savedUpdates().queryByText("Eerste avond")).toBeNull();
  expect(screen.getByRole("heading", { name: "Nieuwe reisupdate" })).toBeTruthy();
});

it("removes a deleted update from the list after the in-app confirmation", async () => {
  renderCapture();
  fireEvent.click(await screen.findByRole("button", { name: /Tweede dag/ }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  await answerConfirmation();
  await waitFor(() => expect(savedUpdates().queryByText("Tweede dag")).toBeNull());
  expect(savedUpdates().getByText("Eerste avond")).toBeTruthy();
  expect(screen.getByText("Reisupdate verwijderd.")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Nieuwe reisupdate" })).toBeTruthy();
});

it("keeps the typed update and says the local draft is safe when the server refuses", async () => {
  renderCapture();
  fireEvent.change(await screen.findByLabelText("Titel"), { target: { value: "Nachtmarkt" } });
  await openMore();
  fireEvent.change(screen.getByLabelText("Privénotitie (optioneel)"), {
    target: { value: "Pindakaas-ijs" },
  });
  api.failNext = { status: 500, body: {} };
  fireEvent.click(screen.getByRole("button", { name: "Reisupdate opslaan" }));
  await screen.findByText(
    "De reisupdate kon niet worden opgeslagen. Je lokale concept blijft bewaard. De server reageert niet goed. Probeer het later opnieuw.",
  );
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Nachtmarkt");
  expect(readDraft("trip")?.title).toBe("Nachtmarkt");
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
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  // Offline is the one connection state shown outside "Meer": the owner must see it before choosing photos.
  const notice = await screen.findByText(/Offline — concepten blijven lokaal/);
  expect(notice.closest("[hidden]")).toBeNull();
  fireEvent.change(title, { target: { value: "Nachtmarkt" } });
  await openMore();
  fireEvent.change(screen.getByLabelText("Privénotitie (optioneel)"), {
    target: { value: "Pindakaas-ijs" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Reisupdate opslaan" }));
  await screen.findByText(
    "Je bent offline. Dit concept blijft alleen lokaal bewaard en wordt niet automatisch verstuurd.",
  );
  expect(api.count("POST /api/trips/trip/travel-updates")).toBe(0);
  expect(readDraft("trip")?.title).toBe("Nachtmarkt");
});

it("searches a place, lets the owner choose it and sends it with the update", async () => {
  api.on<Api.PlaceSearchResponse>("POST", /\/places\/search$/, () => ({
    provider: "synthetic",
    attribution: "OpenStreetMap",
    attribution_url: "https://osm.example",
    results: [
      {
        latitude: 0,
        longitude: 0,
        address_line1: null,
        address_line2: null,
        admin_area: null,
        postal_code: null,
        country_code: null,
        local_name: null,
        name_nl: null,
        name_en: null,
        viewport_north: null,
        viewport_south: null,
        viewport_east: null,
        viewport_west: null,
        display_name: "Taipei Main Station",
        osm_element_type: "node",
        osm_element_id: "1",
        locality: "Taipei",
      },
    ],
  }));
  renderCapture();
  await screen.findByLabelText("Titel");
  await openMore();
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  await screen.findByText("Vul minstens twee tekens in om een locatie te zoeken.");
  fireEvent.change(screen.getByLabelText("Zoek locatie"), { target: { value: "Taipei Main" } });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Taipei Main Station" }));
  await screen.findByText(
    "Locatie geselecteerd. Hij wordt pas gemaakt wanneer je de reisupdate opslaat.",
  );
  expect(api.lastBody("POST /api/trips/trip/places/search")).toEqual({ query: "Taipei Main" });

  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Aankomst" } });
  fireEvent.change(screen.getByLabelText("Privénotitie (optioneel)"), { target: { value: "Moe" } });
  fireEvent.click(screen.getByRole("button", { name: "Reisupdate opslaan" }));
  await screen.findByText("Reisupdate opgeslagen.");
  expect(
    api.lastBody<{ location: { display_name: string } }>("POST /api/trips/trip/travel-updates")
      ?.location.display_name,
  ).toBe("Taipei Main Station");
});

it("links a private photo to the update", async () => {
  renderCapture();
  await openMore();
  fireEvent.click(await screen.findByRole("checkbox", { name: /markt.jpg/ }));
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Markt" } });
  fireEvent.change(screen.getByLabelText("Privénotitie (optioneel)"), {
    target: { value: "Fruit" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Reisupdate opslaan" }));
  await screen.findByText("Reisupdate opgeslagen.");
  expect(api.lastBody("POST /api/trips/trip/travel-updates")).toMatchObject({
    media_asset_ids: ["p1"],
  });
});
