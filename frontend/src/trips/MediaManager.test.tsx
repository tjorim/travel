// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { createRootRoute } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import {
  renderRoutesWithOwner,
  resetOfflineDb,
  restoreObjectUrls,
  stubObjectUrls,
  testToken,
} from "../query/test-utils";
import { answerConfirmation } from "../test-confirm";
import type { MediaAsset, MediaDerivative, Trip } from "../tracker-model";
import { MediaManager } from "./MediaManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = {
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [
    {
      id: "e1",
      occurred_at: "2054-11-16T10:00:00Z",
      date_precision: "day",
      title: "Eerste avond",
      body: "…",
      private_notes: null,
      area_id: null,
      location: null,
      media_asset_ids: ["p2"],
      visibility: "private",
    },
  ],
};
const photo = (id: string, name: string): MediaAsset =>
  ({
    id,
    media_kind: "photo",
    original_filename: name,
    byte_size: 2048,
    content_type: "image/jpeg",
    captured_at: null,
    gps: null,
    file_url: `/api/trips/trip/media/${id}/original`,
  }) as MediaAsset;
const derivative = (
  id: string,
  state: "pending" | "approved",
  extra: Partial<MediaDerivative> = {},
): MediaDerivative => ({
  id,
  media_asset_id: "p1",
  purpose: "share",
  review_state: state,
  metadata_stripped_at: null,
  width: 800,
  height: 600,
  travel_update_id: null,
  caption: null,
  alt_text: null,
  focal_x: null,
  focal_y: null,
  visibility: "private",
  created_at: "2054-01-01T00:00:00Z",
  file_url: `/files/${id}`,
  ...extra,
});

let api: FakeApi;
let providers: { provider: string; available: boolean; connected: boolean }[];
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi()
    .collection("/api/trips/trip/media", [photo("p1", "kust.jpg"), photo("p2", "markt.jpg")])
    .collection("/api/trips/trip/media/p1/derivatives", [
      derivative("x1", "pending", { caption: "Kust" }),
    ])
    .collection("/api/trips/trip/media/p2/derivatives", [])
    .collection("/api/trips/trip/visits", []);
  providers = [
    { provider: "google_photos_picker", available: true, connected: false },
    { provider: "gopro_cloud", available: true, connected: true },
  ];
  api.on("GET", /^\/api\/provider-tokens$/, () => providers);
  // The inline derivative preview and focal-point overlay fetch the derivative's file as a blob.
  api.on("GET", /^\/files\//, () => ({}));
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(api.unexpected).toEqual([]);
  await resetOfflineDb();
});

const routeTree = createRootRoute({
  component: () => <MediaManager trip={trip} onStartCaptureFromCandidate={() => undefined} />,
});
const renderMedia = () => renderRoutesWithOwner(routeTree, ["/"]);

it("lists a new upload straight away and opens its details", async () => {
  api.on("POST", /\/media\/uploads$/, () =>
    api.push("/api/trips/trip/media", photo("p3", "nieuw.jpg")),
  );
  api.collection("/api/trips/trip/media/p3/derivatives", []);
  renderMedia();
  await screen.findByText("kust.jpg");
  expect(document.querySelector('input[type="file"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Media uploaden" }));
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File(["x"], "nieuw.jpg", { type: "image/jpeg" })] },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Privémedia uploaden" }).closest("form")!);
  await screen.findByRole("heading", { level: 2, name: "nieuw.jpg" });
  expect(
    screen.getByText("Privémedia geüpload. Je kunt ze nu aan een reisupdate koppelen."),
  ).toBeTruthy();
  expect(api.lastBody<FormData>("POST /api/trips/trip/media/uploads")!.get("file")).toBeInstanceOf(
    File,
  );
  expect(document.querySelector('input[type="file"]')).toBeNull();
});

it("opens a compact library that reveals a photo's details and copies only after selecting it", async () => {
  renderMedia();
  await screen.findByText("kust.jpg");
  expect(screen.queryByText("Kopieën om te delen")).toBeNull();
  expect(screen.queryByText("Origineel bekijken")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "kust.jpg bekijken" }));
  await screen.findByText("Kopieën om te delen");
  expect(screen.getByRole("heading", { level: 2, name: "kust.jpg" })).toBeTruthy();
  expect(screen.getByText("Origineel bekijken")).toBeTruthy();
  await screen.findByText("Wacht op goedkeuring");
});

it("removes a deleted photo and its copies from the screen", async () => {
  renderMedia();
  await screen.findByText("kust.jpg");
  fireEvent.click(screen.getByRole("button", { name: "kust.jpg bekijken" }));
  await screen.findByText("Wacht op goedkeuring");
  const copyReads = api.count("GET /api/trips/trip/media/p1/derivatives");
  fireEvent.click(await screen.findByRole("button", { name: "Verwijderen" }));
  await answerConfirmation();
  await waitFor(() => expect(screen.queryByText("kust.jpg")).toBeNull());
  // The deleted medium's copies are not asked for again while the list refreshes (that read would be a 404).
  expect(api.count("GET /api/trips/trip/media/p1/derivatives")).toBe(copyReads);
  expect(screen.getByText("markt.jpg")).toBeTruthy();
  expect(
    screen.getByText(
      "Privémedia verwijderd. Eventuele koppelingen aan reisupdates zijn ook weggehaald.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
});

it("creates a copy within the allowed size and lists it", async () => {
  api.on("POST", /\/media\/p1\/derivatives$/, () =>
    api.push(
      "/api/trips/trip/media/p1/derivatives",
      derivative("x2", "pending", { width: 800, height: 533 }),
    ),
  );
  renderMedia();
  fireEvent.click(await screen.findByRole("button", { name: "kust.jpg bekijken" }));
  await screen.findByText("Wacht op goedkeuring");
  fireEvent.click(screen.getByRole("button", { name: "Kopie maken" }));
  fireEvent.change(screen.getByLabelText("Maximale zijde (px)"), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: "Metadata-vrije kopie maken" }));
  await screen.findByText("Kies een maximale zijde tussen 64 en 4000 px.");
  expect(api.count("POST /api/trips/trip/media/p1/derivatives")).toBe(0);
  fireEvent.change(screen.getByLabelText("Maximale zijde (px)"), { target: { value: "800" } });
  fireEvent.click(screen.getByRole("button", { name: "Metadata-vrije kopie maken" }));
  await screen.findByText("800 × 533", { exact: false });
  expect(api.lastBody("POST /api/trips/trip/media/p1/derivatives")).toEqual({
    purpose: "share",
    max_dimension: 800,
  });
});

it("returns to the photo without saving when a copy's form is cancelled", async () => {
  renderMedia();
  fireEvent.click(await screen.findByRole("button", { name: "kust.jpg bekijken" }));
  fireEvent.click(await screen.findByText("Kopie maken"));
  fireEvent.click(screen.getByRole("button", { name: "Terug naar het medium" }));
  await screen.findByText("Kopieën om te delen");
  expect(screen.queryByLabelText("Maximale zijde (px)")).toBeNull();
});

it("shows an approved copy and drops a deleted one without a reload", async () => {
  api.on("POST", /\/media\/p1\/derivatives\/x1\/approve$/, () => {
    const rows = api.rows("/api/trips/trip/media/p1/derivatives");
    rows[0].review_state = "approved";
    return rows[0];
  });
  renderMedia();
  fireEvent.click(await screen.findByRole("button", { name: "kust.jpg bekijken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Kopie Delen bekijken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Expliciet goedkeuren" }));
  await screen.findByText("Goedgekeurde kopie");
  expect(screen.queryByText("Wacht op goedkeuring")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  await answerConfirmation();
  await waitFor(() => expect(screen.queryByText("Goedgekeurde kopie")).toBeNull());
  expect(screen.getByText("Kopie verwijderd en uit eventuele deelscopes gehaald.")).toBeTruthy();
  expect(screen.getByText("Nog geen kopieën voor dit medium.")).toBeTruthy();
});

it("chooses and removes a copy as the trip cover without publishing anything", async () => {
  const bodies: unknown[] = [];
  api.on("PATCH", /^\/api\/trips\/trip$/, (payload) => {
    const body = payload as { cover_derivative_id: string | null };
    bodies.push(body);
    api.rows("/api/trips/trip/media/p1/derivatives")[0].is_cover =
      body.cover_derivative_id === "x1";
    return {};
  });
  renderMedia();
  fireEvent.click(await screen.findByRole("button", { name: "kust.jpg bekijken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Kopie Delen bekijken" }));

  fireEvent.click(await screen.findByRole("button", { name: "Gebruik als omslag van de reis" }));
  await screen.findByText(/Omslag gekozen\. Er wordt niets gepubliceerd/);
  fireEvent.click(await screen.findByRole("button", { name: "Verwijder als omslag van de reis" }));
  await screen.findByText("Omslag verwijderd.");

  expect(bodies).toEqual([{ cover_derivative_id: "x1" }, { cover_derivative_id: null }]);
});

it("opens the presentation form with the saved values, saves it and keeps the saved caption", async () => {
  api.on("PATCH", /\/media\/p1\/derivatives\/x1\/presentation$/, (body) => {
    const rows = api.rows("/api/trips/trip/media/p1/derivatives");
    Object.assign(rows[0], {
      caption: (body as { caption: string }).caption,
      focal_x: (body as { focal_x: number }).focal_x,
    });
    return rows[0];
  });
  renderMedia();
  fireEvent.click(await screen.findByRole("button", { name: "kust.jpg bekijken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Kopie Delen bekijken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Presentatie bewerken" }));
  const caption = (await screen.findByLabelText("Bijschrift")) as HTMLInputElement;
  expect(caption.value).toBe("Kust");
  fireEvent.change(screen.getByLabelText("Focus horizontaal (%)"), { target: { value: "150" } });
  fireEvent.click(screen.getByRole("button", { name: "Presentatie opslaan" }));
  await screen.findByText("Kies een waarde tussen 0 en 100.");
  expect(api.count("PATCH /api/trips/trip/media/p1/derivatives/x1/presentation")).toBe(0);

  fireEvent.change(caption, { target: { value: "Kust bij zonsopgang" } });
  fireEvent.change(screen.getByLabelText("Focus horizontaal (%)"), { target: { value: "40" } });
  fireEvent.click(screen.getByRole("button", { name: "Presentatie opslaan" }));
  await screen.findByText(
    "Presentatie opgeslagen. Alleen geselecteerde velden in een deelscope worden zichtbaar.",
  );
  expect(api.lastBody("PATCH /api/trips/trip/media/p1/derivatives/x1/presentation")).toMatchObject({
    caption: "Kust bij zonsopgang",
    focal_x: 40,
    travel_update_id: null,
  });

  fireEvent.click(await screen.findByRole("button", { name: "Kopie Delen bekijken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Presentatie bewerken" }));
  await waitFor(() =>
    expect((screen.getByLabelText("Bijschrift") as HTMLInputElement).value).toBe(
      "Kust bij zonsopgang",
    ),
  );
});

it("searches travel updates when linking a copy's presentation", async () => {
  api.on("GET", /\/travel-updates\?q=Eerste&limit=50$/, () => trip.travel_updates);
  api.on("PATCH", /\/media\/p1\/derivatives\/x1\/presentation$/, (body) => {
    const rows = api.rows("/api/trips/trip/media/p1/derivatives");
    Object.assign(rows[0], body);
    return rows[0];
  });
  renderMedia();
  fireEvent.click(await screen.findByRole("button", { name: "kust.jpg bekijken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Kopie Delen bekijken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Presentatie bewerken" }));
  fireEvent.change(screen.getByLabelText("Bij reisupdate"), { target: { value: "Eerste" } });
  fireEvent.click(await screen.findByRole("option", { name: "Eerste avond" }));
  expect(api.count("GET /api/trips/trip/travel-updates?q=Eerste&limit=50")).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Presentatie opslaan" }));
  await screen.findByText(
    "Presentatie opgeslagen. Alleen geselecteerde velden in een deelscope worden zichtbaar.",
  );
  expect(api.lastBody("PATCH /api/trips/trip/media/p1/derivatives/x1/presentation")).toMatchObject({
    travel_update_id: "e1",
  });
});

it("shows a thumbnail beside a photo, a readable purpose label, and an inline preview with a focal-point marker", async () => {
  stubObjectUrls();
  api.rows("/api/trips/trip/media")[0].thumbnail_url = "/files/p1-thumb";
  renderMedia();
  await screen.findByText("kust.jpg");
  const row = screen.getByText("kust.jpg").closest("article")!;
  await waitFor(() => expect(row.querySelector("img")).not.toBeNull());
  expect(row.querySelector("img")!.getAttribute("src")).toBe("blob:test");

  fireEvent.click(screen.getByRole("button", { name: "kust.jpg bekijken" }));
  const copyRow = (await screen.findByText("Wacht op goedkeuring")).closest("article")!;
  expect(copyRow.textContent).toMatch(/^Wacht op goedkeuringDelen ·/);
  await waitFor(() => expect(copyRow.querySelectorAll("img").length).toBeGreaterThan(0));

  fireEvent.click(screen.getByRole("button", { name: "Kopie Delen bekijken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Presentatie bewerken" }));
  const marker = await waitFor(() => {
    const element = document.querySelector("[data-focal-point-marker]") as HTMLElement | null;
    if (!element) throw new Error("focal-point marker not rendered yet");
    return element;
  });
  expect(marker.style.left).toBe("50%");
  expect(marker.style.top).toBe("50%");
  fireEvent.change(screen.getByLabelText("Focus horizontaal (%)"), { target: { value: "20" } });
  expect(marker.style.left).toBe("20%");
  restoreObjectUrls();
});

it("reviews possible travel updates without storing them, and attaches media to an existing reisupdate", async () => {
  api.on("POST", /\/media\/travel-update-candidates$/, () => ({
    grouping_window_minutes: 120,
    gps_agreement_metres: 500,
    unavailable_media_asset_ids: [],
    candidates: [
      {
        id: "c1",
        media_asset_ids: ["p1"],
        starts_at: null,
        ends_at: null,
        time_options: [],
        location_options: [],
      },
    ],
  }));
  api.on("GET", /\/travel-updates\?q=Eerste&limit=50$/, () => trip.travel_updates);
  api.on("PATCH", /\/travel-updates\/e1$/, () => ({ id: "e1" }));
  renderMedia();
  await screen.findByText("kust.jpg");
  fireEvent.click(screen.getByRole("button", { name: "Geselecteerde media beoordelen" }));
  await screen.findByText("Kies eerst private media om als mogelijke reisupdates te bekijken.");
  fireEvent.click(screen.getAllByLabelText("Reisupdates beoordelen")[0]);
  fireEvent.click(screen.getByRole("button", { name: "Geselecteerde media beoordelen" }));
  await screen.findByText(
    "Kandidaten zijn alleen voor deze private review berekend; er is niets opgeslagen.",
  );
  expect(api.lastBody("POST /api/trips/trip/media/travel-update-candidates")).toEqual({
    media_asset_ids: ["p1"],
  });

  fireEvent.change(screen.getByLabelText("Koppel aan"), { target: { value: "Eerste" } });
  fireEvent.click(await screen.findByRole("option", { name: "Eerste avond" }));
  fireEvent.click(screen.getByRole("button", { name: "Aan reisupdate koppelen" }));
  await screen.findByText(
    "Private media gekoppeld aan “Eerste avond”. Er is geen locatie of deelbare inhoud gemaakt.",
  );
  expect(api.lastBody("PATCH /api/trips/trip/travel-updates/e1")).toEqual({
    media_asset_ids: ["p2", "p1"],
  });
});

it("starts an import and reports a selection that is not ready yet", async () => {
  api.on("POST", /\/media\/imports\/gopro_cloud\/sessions$/, () => ({
    id: "sess",
    provider: "gopro_cloud",
    state: "pending",
    picker_uri: "https://picker.example/x",
    expires_at: null,
  }));
  api.on("POST", /\/media\/imports\/gopro_cloud\/sessions\/sess\/complete$/, () => ({
    ready: false,
    imported: [],
    failed: [],
  }));
  renderMedia();
  fireEvent.click(await screen.findByRole("button", { name: "Kies in GoPro Cloud" }));
  await screen.findByText("GoPro Cloud-selectie");
  fireEvent.click(screen.getByRole("button", { name: "Selectie importeren" }));
  await screen.findByText(
    "Je selectie is nog niet klaar bij de provider. Probeer opnieuw wanneer je klaar bent.",
  );
});

it("hides a provider the server does not offer and disables one the owner has not connected", async () => {
  providers = [
    { provider: "google_photos_picker", available: true, connected: false },
    { provider: "gopro_cloud", available: false, connected: false },
  ];
  renderMedia();
  const google = await screen.findByRole("button", { name: "Kies in Google Photos" });
  expect((google as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Kies in GoPro Cloud" })).toBeNull();
});

it("offers no provider import when OAuth is not configured on the server", async () => {
  providers = [
    { provider: "google_photos_picker", available: false, connected: false },
    { provider: "gopro_cloud", available: false, connected: false },
  ];
  renderMedia();
  await screen.findByText(/Providerimport is op deze server nog niet beschikbaar/);
  expect(screen.queryByRole("button", { name: "Kies in Google Photos" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Kies in GoPro Cloud" })).toBeNull();
});
