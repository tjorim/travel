// @vitest-environment jsdom
import { createRootRoute } from "@tanstack/react-router";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import { answerConfirmation } from "../test-confirm";
import {
  clearDraft,
  emptyDraft,
  readDraft,
  saveDraft,
  type TravelUpdate,
  type Trip,
} from "../tracker-model";
import { Capture } from "./Capture";

const routeTree = createRootRoute({ component: Capture });

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const update = (id: string, title: string): TravelUpdate => ({
  id,
  occurred_at: "2054-11-17T10:00:00Z",
  date_precision: "day",
  title,
  body: "",
  private_notes: "Nachtmarkt",
  area_id: null,
  location: null,
  media_asset_ids: [],
  visibility: "private",
});
let state: { trip: Trip };
let api: FakeApi;

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  clearDraft("trip");
  state = {
    trip: {
      id: "trip",
      title: "Exampleland",
      summary: null,
      starts_on: null,
      ends_on: null,
      travel_updates: [update("m1", "Eerste avond"), update("m2", "Tweede dag")],
    },
  };
  api = fakeApi().collection("/api/trips/trip/media", [
    { id: "p1", media_kind: "photo", original_filename: "markt.jpg", captured_at: null, gps: null },
  ]);
  api.on("GET", /^\/api\/trips$/, () => [state.trip]);
  api.on("POST", /^\/api\/trips\/trip\/travel-updates$/, (body) => {
    const created = {
      id: `new-${state.trip.travel_updates.length}`,
      location: null,
      ...(body as object),
    } as TravelUpdate;
    state.trip = { ...state.trip, travel_updates: [...state.trip.travel_updates, created] };
    return created;
  });
  api.on("PATCH", /^\/api\/trips\/trip\/travel-updates\/([^/]+)$/, (body, match) => {
    state.trip = {
      ...state.trip,
      travel_updates: state.trip.travel_updates.map((item) =>
        item.id === match[1] ? { ...item, ...(body as object) } : item,
      ),
    };
    return state.trip.travel_updates.find((item) => item.id === match[1]);
  });
  api.on("DELETE", /^\/api\/trips\/trip\/travel-updates\/([^/]+)$/, (_body, match) => {
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
  clearDraft("trip");
  expect(api.unexpected).toEqual([]);
});

const renderCapture = () => renderRoutesWithOwner(routeTree, ["/"]);
const savedUpdates = () =>
  within(screen.getByRole("heading", { name: "Opgeslagen reisupdates" }).closest("section")!);

it("restores a local draft and keeps it up to date while typing", async () => {
  saveDraft({ ...emptyDraft("trip"), title: "Terug van gisteren", notes: "Regen" });
  renderCapture();
  const title = (await screen.findByLabelText("Titel")) as HTMLInputElement;
  expect(title.value).toBe("Terug van gisteren");
  fireEvent.change(title, { target: { value: "Terug van eergisteren" } });
  await waitFor(() => expect(readDraft("trip")?.title).toBe("Terug van eergisteren"));
  expect(screen.getByText("Concept lokaal bewaard — nog niet naar je reis gestuurd.")).toBeTruthy();
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
  await screen.findByText(/Offline — concepten blijven lokaal/);
  fireEvent.change(title, { target: { value: "Nachtmarkt" } });
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
  api.on("POST", /\/places\/search$/, () => ({
    attribution: "OpenStreetMap",
    attribution_url: "https://osm.example",
    results: [
      {
        display_name: "Taipei Main Station",
        osm_element_type: "node",
        osm_element_id: "1",
        locality: "Taipei",
      },
    ],
  }));
  renderCapture();
  await screen.findByLabelText("Titel");
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
