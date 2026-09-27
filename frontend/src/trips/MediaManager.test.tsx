// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, resetOfflineDb, testToken } from "../query/test-utils";
import { answerConfirmation } from "../test-confirm";
import type { MediaAsset, MediaDerivative, Trip } from "../tracker-model";
import { MediaManager } from "./MediaManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = {
  id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null,
  travel_updates: [{ id: "e1", occurred_at: "2054-11-16T10:00:00Z", date_precision: "day", title: "Eerste avond", body: "…", private_notes: null, area_id: null, location: null, media_asset_ids: ["p2"], visibility: "private" }],
};
const photo = (id: string, name: string): MediaAsset => ({ id, media_kind: "photo", original_filename: name, byte_size: 2048, content_type: "image/jpeg", captured_at: null, gps: null, file_url: `/api/trips/trip/media/${id}/original` } as MediaAsset);
const derivative = (id: string, state: "pending" | "approved", extra: Partial<MediaDerivative> = {}): MediaDerivative => ({ id, media_asset_id: "p1", purpose: "share", review_state: state, metadata_stripped_at: null, width: 800, height: 600, travel_update_id: null, caption: null, alt_text: null, focal_x: null, focal_y: null, visibility: "private", created_at: "2054-01-01T00:00:00Z", file_url: `/files/${id}`, ...extra });

let api: FakeApi;
let providers: { provider: string; available: boolean; connected: boolean }[];
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi()
    .collection("/api/trips/trip/media", [photo("p1", "kust.jpg"), photo("p2", "markt.jpg")])
    .collection("/api/trips/trip/media/p1/derivatives", [derivative("x1", "pending", { caption: "Kust" })])
    .collection("/api/trips/trip/media/p2/derivatives", [])
    .collection("/api/trips/trip/visits", []);
  providers = [{ provider: "google_photos_picker", available: true, connected: false }, { provider: "gopro_cloud", available: true, connected: true }];
  api.on("GET", /^\/api\/provider-tokens$/, () => providers);
});
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expect(api.unexpected).toEqual([]); await resetOfflineDb(); });

const renderMedia = () => renderWithOwner(<MemoryRouter><MediaManager trip={trip} onStartCaptureFromCandidate={() => undefined} /></MemoryRouter>);

it("lists a new upload straight away and selects it", async () => {
  api.on("POST", /\/media\/uploads$/, () => api.push("/api/trips/trip/media", photo("p3", "nieuw.jpg")));
  api.collection("/api/trips/trip/media/p3/derivatives", []);
  renderMedia();
  await screen.findByText("kust.jpg");
  expect(document.querySelector('input[type="file"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Media uploaden" }));
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["x"], "nieuw.jpg", { type: "image/jpeg" })] } });
  fireEvent.submit(screen.getByRole("button", { name: "Privémedia uploaden" }).closest("form")!);
  await screen.findByText("nieuw.jpg");
  expect(screen.getByText(/Voor nieuw\.jpg\./)).toBeTruthy();
  expect(screen.getByText("Privémedia geüpload. Je kunt ze nu aan een reisupdate koppelen.")).toBeTruthy();
  expect(api.lastBody<FormData>("POST /api/trips/trip/media/uploads")!.get("file")).toBeInstanceOf(File);
  expect(document.querySelector('input[type="file"]')).toBeNull();
});

it("removes a deleted photo and its derivatives from the screen", async () => {
  renderMedia();
  await screen.findByText("kust.jpg");
  fireEvent.click(screen.getAllByRole("button", { name: "Verwijderen" })[0]);
  await answerConfirmation();
  await waitFor(() => expect(screen.queryByText("kust.jpg")).toBeNull());
  expect(screen.getByText("markt.jpg")).toBeTruthy();
  expect(screen.getByText("Privémedia verwijderd. Eventuele koppelingen aan reisupdates zijn ook weggehaald.")).toBeTruthy();
  expect(screen.queryByText("Afgeleiden")).toBeNull();
});

it("creates a derivative within the allowed size and lists it", async () => {
  api.on("POST", /\/media\/p1\/derivatives$/, () => api.push("/api/trips/trip/media/p1/derivatives", derivative("x2", "pending", { width: 800, height: 533 })));
  renderMedia();
  await screen.findByText("Wacht op goedkeuring");
  fireEvent.change(screen.getByLabelText("Maximale zijde (px)"), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: "Metadata-vrije afgeleide maken" }));
  await screen.findByText("Kies een maximale zijde tussen 64 en 4000 px.");
  expect(api.count("POST /api/trips/trip/media/p1/derivatives")).toBe(0);
  fireEvent.change(screen.getByLabelText("Maximale zijde (px)"), { target: { value: "800" } });
  fireEvent.click(screen.getByRole("button", { name: "Metadata-vrije afgeleide maken" }));
  await screen.findByText("800 × 533", { exact: false });
  expect(api.lastBody("POST /api/trips/trip/media/p1/derivatives")).toEqual({ purpose: "share", max_dimension: 800 });
});

it("shows an approved derivative and drops a deleted one without a reload", async () => {
  api.on("POST", /\/media\/p1\/derivatives\/x1\/approve$/, () => { const rows = api.rows("/api/trips/trip/media/p1/derivatives"); rows[0].review_state = "approved"; return rows[0]; });
  renderMedia();
  fireEvent.click(await screen.findByRole("button", { name: "Expliciet goedkeuren" }));
  await screen.findByText("Goedgekeurde afgeleide");
  expect(screen.queryByText("Wacht op goedkeuring")).toBeNull();
  const derivativeRow = screen.getByText("Goedgekeurde afgeleide").closest("article")!;
  fireEvent.click(Array.from(derivativeRow.querySelectorAll("button")).find((button) => button.textContent === "Verwijderen")!);
  await answerConfirmation();
  await waitFor(() => expect(screen.queryByText("Goedgekeurde afgeleide")).toBeNull());
  expect(screen.getByText("Afgeleide verwijderd en uit eventuele deelscopes gehaald.")).toBeTruthy();
});

it("opens the presentation form with the saved values, saves it and shows the saved caption", async () => {
  api.on("PATCH", /\/media\/p1\/derivatives\/x1\/presentation$/, (body) => { const rows = api.rows("/api/trips/trip/media/p1/derivatives"); Object.assign(rows[0], { caption: (body as { caption: string }).caption, focal_x: (body as { focal_x: number }).focal_x }); return rows[0]; });
  renderMedia();
  const caption = await screen.findByLabelText("Bijschrift") as HTMLInputElement;
  expect(caption.value).toBe("Kust");
  fireEvent.change(screen.getByLabelText("Focus horizontaal (%)"), { target: { value: "150" } });
  fireEvent.click(screen.getByRole("button", { name: "Presentatie opslaan" }));
  await screen.findByText("Kies een waarde tussen 0 en 100.");
  expect(api.count("PATCH /api/trips/trip/media/p1/derivatives/x1/presentation")).toBe(0);

  fireEvent.change(caption, { target: { value: "Kust bij zonsopgang" } });
  fireEvent.change(screen.getByLabelText("Focus horizontaal (%)"), { target: { value: "40" } });
  fireEvent.click(screen.getByRole("button", { name: "Presentatie opslaan" }));
  await screen.findByText("Presentatie opgeslagen. Alleen geselecteerde velden in een deelscope worden zichtbaar.");
  expect(api.lastBody("PATCH /api/trips/trip/media/p1/derivatives/x1/presentation")).toMatchObject({ caption: "Kust bij zonsopgang", focal_x: 40, travel_update_id: null });
  await waitFor(() => expect((screen.getByLabelText("Bijschrift") as HTMLInputElement).value).toBe("Kust bij zonsopgang"));
});

it("reviews possible visits without storing them, and attaches media to an existing reisupdate", async () => {
  api.on("POST", /\/media\/visit-candidates$/, () => ({ grouping_window_minutes: 120, gps_agreement_metres: 500, unavailable_media_asset_ids: [], candidates: [{ id: "c1", media_asset_ids: ["p1"], starts_at: null, ends_at: null, time_options: [], location_options: [] }] }));
  api.on("PATCH", /\/travel-updates\/e1$/, () => ({ id: "e1" }));
  renderMedia();
  await screen.findByText("kust.jpg");
  fireEvent.click(screen.getByRole("button", { name: "Geselecteerde media beoordelen" }));
  await screen.findByText("Kies eerst private media om als mogelijke bezoeken te bekijken.");
  fireEvent.click(screen.getAllByLabelText("Bezoeken beoordelen")[0]);
  fireEvent.click(screen.getByRole("button", { name: "Geselecteerde media beoordelen" }));
  await screen.findByText("Kandidaten zijn alleen voor deze private review berekend; er is niets opgeslagen.");
  expect(api.lastBody("POST /api/trips/trip/media/visit-candidates")).toEqual({ media_asset_ids: ["p1"] });

  fireEvent.change(screen.getByLabelText("Koppel aan"), { target: { value: "e1" } });
  fireEvent.click(screen.getByRole("button", { name: "Aan reisupdate koppelen" }));
  await screen.findByText("Private media gekoppeld aan “Eerste avond”. Er is geen locatie of deelbare inhoud gemaakt.");
  expect(api.lastBody("PATCH /api/trips/trip/travel-updates/e1")).toEqual({ media_asset_ids: ["p2", "p1"] });
});

it("starts an import and reports a selection that is not ready yet", async () => {
  api.on("POST", /\/media\/imports\/gopro_cloud\/sessions$/, () => ({ id: "sess", provider: "gopro_cloud", state: "pending", picker_uri: "https://picker.example/x", expires_at: null }));
  api.on("POST", /\/media\/imports\/gopro_cloud\/sessions\/sess\/complete$/, () => ({ ready: false, imported: [], failed: [] }));
  renderMedia();
  fireEvent.click(await screen.findByRole("button", { name: "Kies in GoPro Cloud" }));
  await screen.findByText("GoPro Cloud-selectie");
  fireEvent.click(screen.getByRole("button", { name: "Selectie importeren" }));
  await screen.findByText("Je selectie is nog niet klaar bij de provider. Probeer opnieuw wanneer je klaar bent.");
});

it("hides a provider the server does not offer and disables one the owner has not connected", async () => {
  providers = [{ provider: "google_photos_picker", available: true, connected: false }, { provider: "gopro_cloud", available: false, connected: false }];
  renderMedia();
  const google = await screen.findByRole("button", { name: "Kies in Google Photos" });
  expect((google as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Kies in GoPro Cloud" })).toBeNull();
});

it("offers no provider import when OAuth is not configured on the server", async () => {
  providers = [{ provider: "google_photos_picker", available: false, connected: false }, { provider: "gopro_cloud", available: false, connected: false }];
  renderMedia();
  await screen.findByText(/Providerimport is op deze server nog niet beschikbaar/);
  expect(screen.queryByRole("button", { name: "Kies in Google Photos" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Kies in GoPro Cloud" })).toBeNull();
});
