// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { BroadPlace, BroadStayCard, DocumentAsset, Stay, TransportLeg, Trip } from "../tracker-model";
import { BroadPlaceManager } from "./BroadPlaceManager";
import { StayManager } from "./StayManager";
import { TransportLegManager } from "./TransportLegManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: "2054-11-16", ends_on: null, visibility: "private", publication_state: "draft", route_stages: [], highlights: [], moments: [], moment_excerpts: [] };
const broadPlace: BroadPlace = { id: "broad", label: "Taipei", country_code: "TW", region: "Taipei City", latitude: 25.03, longitude: 121.56, timezone: "Asia/Taipei" };
const stay = (id: string, name: string): Stay => ({ id, check_in_date: "2054-11-16", check_out_date: "2054-11-18", check_in_time: null, check_out_time: null, status: "booked", property_name: name, website_url: null, booking_reference: "ABC", contact_details: null, notes: null, place: null, broad_place: broadPlace });
const leg = (id: string, from: string): TransportLeg => ({ id, kind: "flight", status: "booked", departure_place: { locality: from, display_name: "BRU" } as TransportLeg["departure_place"], arrival_place: { locality: "Taipei", display_name: "TPE" } as TransportLeg["arrival_place"], departs_at: "2054-11-16T09:00:00Z", arrives_at: "2054-11-16T21:00:00Z", departure_timezone: "Europe/Brussels", arrival_timezone: "Asia/Taipei", carrier: null, service_reference: null, travel_class: null, booking_reference: "REF", notes: null, document_asset_ids: [] });
const document = (id: string, title: string) => ({ id, title, document_kind: "booking", byte_size: 1, content_type: "application/pdf", original_filename: null, created_at: "2054-01-01T00:00:00Z", file_url: `/files/${id}` }) as DocumentAsset;

let api: FakeApi;
beforeEach(() => { auth.session = { accessToken: testToken() }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); expect(api.unexpected).toEqual([]); });

const confirmDelete = () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }));

it("opens a broad place in detail before its editor, prefilled", async () => {
  api = fakeApi().collection("/api/trips/trip/places/broad", [broadPlace]);
  renderWithOwner(<BroadPlaceManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Brede plaats Taipei bekijken" }));
  expect(screen.getByRole("heading", { name: "Taipei" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Brede plaats bewerken" })).toBeTruthy();
  expect((screen.getByLabelText("Naam") as HTMLInputElement).value).toBe("Taipei");
  expect((screen.getByLabelText("Brede breedtegraad (optioneel)") as HTMLInputElement).value).toBe("25.03");
});

it("shows an edited broad place at once and adds a new one to the list", async () => {
  api = fakeApi().collection("/api/trips/trip/places/broad", [broadPlace]);
  renderWithOwner(<BroadPlaceManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Brede plaats Taipei bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Nieuw-Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Brede plaats opslaan" }));
  await screen.findByRole("button", { name: "Brede plaats Nieuw-Taipei bekijken" });
  expect(screen.queryByRole("button", { name: "Brede plaats Taipei bekijken" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Brede plaats toevoegen" }));
  fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Tainan" } });
  fireEvent.change(screen.getByLabelText("Landcode (optioneel)"), { target: { value: "tw" } });
  fireEvent.click(screen.getByRole("button", { name: "Brede plaats opslaan" }));
  await screen.findByRole("button", { name: "Brede plaats Tainan bekijken" });
  expect(api.lastBody("POST /api/trips/trip/places/broad")).toMatchObject({ label: "Tainan", country_code: "TW", latitude: null, longitude: null });
});

it("asks for both broad coordinates or neither", async () => {
  api = fakeApi().collection("/api/trips/trip/places/broad", []);
  renderWithOwner(<BroadPlaceManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Brede plaats toevoegen" }));
  fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Taipei" } });
  fireEvent.change(screen.getByLabelText("Brede breedtegraad (optioneel)"), { target: { value: "25" } });
  fireEvent.click(screen.getByRole("button", { name: "Brede plaats opslaan" }));
  await screen.findByText("Vul beide brede coördinaten in of laat beide leeg.");
  expect(api.count("POST /api/trips/trip/places/broad")).toBe(0);
});

it("opens a stay in private detail before editing, prefilled", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", [stay("s1", "Hotel")]).collection("/api/trips/trip/broad-stay-cards", []);
  renderWithOwner(<StayManager trip={trip} broadPlaces={[broadPlace]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Hotel/ }));
  expect(screen.getByText("Boekingsreferentie: ABC")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Verblijf bewerken" })).toBeTruthy();
  expect((screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)") as HTMLInputElement).value).toBe("Hotel");
  expect((screen.getByLabelText("Eerste nacht (inchecken)") as HTMLInputElement).value).toBe("2054-11-16");
  expect((screen.getByLabelText("Boekingsreferentie (optioneel)") as HTMLInputElement).value).toBe("ABC");
});

it("shows an edited stay and removes a deleted one without a reload", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", [stay("s1", "Hotel"), stay("s2", "Hostel")]).collection("/api/trips/trip/broad-stay-cards", []);
  renderWithOwner(<StayManager trip={trip} broadPlaces={[broadPlace]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Hotel/ }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)"), { target: { value: "Hotel Royal" } });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await screen.findByRole("button", { name: /Hotel Royal/ });
  expect(screen.queryByRole("button", { name: /^Hotel · / })).toBeNull();
  expect(screen.getByText("Privéverblijf opgeslagen.")).toBeTruthy();

  fireEvent.click(screen.getAllByRole("button", { name: "Verwijderen" })[1]);
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("button", { name: /Hostel/ })).toBeNull());
  expect(screen.getByRole("button", { name: /Hotel Royal/ })).toBeTruthy();
  expect(api.count("DELETE /api/trips/trip/stays/s2")).toBe(1);
});

it("rewrites a stay's place only when a place field changed", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", [stay("s1", "Hotel")]).collection("/api/trips/trip/broad-stay-cards", []);
  renderWithOwner(<StayManager trip={trip} broadPlaces={[broadPlace]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Hotel/ }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Notities (optioneel)"), { target: { value: "Late check-in" } });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/stays/s1")).toMatchObject({ notes: "Late check-in" });
  expect(api.lastBody("PATCH /api/trips/trip/stays/s1")).not.toHaveProperty("place");
});

it("keeps check-out after check-in and moves it along with the first night", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", []).collection("/api/trips/trip/broad-stay-cards", []);
  renderWithOwner(<StayManager trip={trip} broadPlaces={[]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw verblijf" }));
  fireEvent.change(screen.getByLabelText("Eerste nacht (inchecken)"), { target: { value: "2054-11-20" } });
  await waitFor(() => expect((screen.getByLabelText("Uitchecken (ochtend)") as HTMLInputElement).value).toBe("2054-11-21"));
  fireEvent.change(screen.getByLabelText("Uitchecken (ochtend)"), { target: { value: "2054-11-19" } });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await screen.findByText("Uitchecken gebeurt ten vroegste de ochtend na de eerste nacht.");
  expect(api.count("POST /api/trips/trip/stays")).toBe(0);
});

it("adds, edits and deletes a broad stay card", async () => {
  const card: BroadStayCard = { id: "c1", title: "Een paar nachten in Taipei", date_precision: "month", place: broadPlace } as BroadStayCard;
  api = fakeApi().collection("/api/trips/trip/stays", []).collection("/api/trips/trip/broad-stay-cards", [card], { update: (row, body) => ({ ...row, title: body.title }) });
  renderWithOwner(<StayManager trip={trip} broadPlaces={[broadPlace]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Een paar nachten in Taipei/ }));
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Een paar nachten in Taipei");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Een week in Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Kaart opslaan" }));
  await screen.findByRole("button", { name: /Een week in Taipei/ });
  expect(screen.queryByRole("button", { name: /Een paar nachten/ })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("button", { name: /Een week in Taipei/ })).toBeNull());
});

it("opens transport detail before its editor, prefilled", async () => {
  api = fakeApi().collection("/api/trips/trip/transport-legs", [leg("l1", "Brussels")]).collection("/api/trips/trip/documents", []);
  renderWithOwner(<TransportLegManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Vlucht: Brussels/ }));
  expect(screen.getByText("Boekingsreferentie: REF")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Transportonderdeel bewerken" })).toBeTruthy();
  expect((screen.getByLabelText("Boekingsreferentie (optioneel)") as HTMLInputElement).value).toBe("REF");
  expect((screen.getByLabelText("Tijdzone vertrek") as HTMLInputElement).value).toBe("Europe/Brussels");
});

it("shows an edited leg and forgets a deleted one, linking documents on the way", async () => {
  api = fakeApi().collection("/api/trips/trip/transport-legs", [leg("l1", "Brussels"), leg("l2", "Parijs")]).collection("/api/trips/trip/documents", [document("d1", "Ticket")]);
  renderWithOwner(<TransportLegManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Vlucht: Brussels/ }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Vervoerder (optioneel)"), { target: { value: "EVA Air" } });
  fireEvent.click(await screen.findByLabelText("Ticket"));
  fireEvent.click(screen.getByRole("button", { name: "Onderdeel opslaan" }));
  await screen.findByText(/EVA Air/);
  expect(api.lastBody("PATCH /api/trips/trip/transport-legs/l1")).toMatchObject({ carrier: "EVA Air", document_asset_ids: ["d1"] });
  // The departure place is untouched, so it is not sent again.
  expect(api.lastBody("PATCH /api/trips/trip/transport-legs/l1")).not.toHaveProperty("departure_place");

  fireEvent.click(screen.getAllByRole("button", { name: "Verwijderen" })[1]);
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("button", { name: /Parijs/ })).toBeNull());
  expect(screen.getByRole("button", { name: /Brussels/ })).toBeTruthy();
});
