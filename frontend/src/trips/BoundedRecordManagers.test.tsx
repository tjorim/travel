// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { BroadPlace, DocumentAsset, Place, Stay, TransportLeg, Trip } from "../tracker-model";
import { BroadPlaceManager } from "./BroadPlaceManager";
import { StayManager } from "./StayManager";
import { TransportLegManager } from "./TransportLegManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: "2054-11-16", ends_on: null, route_stages: [], travel_updates: [] };
const broadPlace: BroadPlace = { id: "broad", visibility: "private", label: "Taipei", country_code: "TW", region: "Taipei City", latitude: 25.03, longitude: 121.56, timezone: "Asia/Taipei" };
const savedSpot = { id: "bru", visibility: "private", label: null, area_id: "broad", share_address: false, display_name: "Brussels Airport", address_line1: "Leopoldlaan", locality: "Zaventem", country_code: "BE" } as Place;
const stay = (id: string, name: string): Stay => ({ id, check_in_date: "2054-11-16", check_out_date: "2054-11-18", check_in_time: null, check_out_time: null, status: "booked", property_name: name, website_url: null, booking_reference: "ABC", contact_details: null, notes: null, place: null, broad_place: broadPlace, visibility: "private", share_date_precision: "month" });
const leg = (id: string, from: string): TransportLeg => ({ id, kind: "flight", status: "booked", departure_place: { locality: from, display_name: "BRU" } as TransportLeg["departure_place"], arrival_place: { locality: "Taipei", display_name: "TPE" } as TransportLeg["arrival_place"], departs_at: "2054-11-16T09:00:00Z", arrives_at: "2054-11-16T21:00:00Z", departure_timezone: "Europe/Brussels", arrival_timezone: "Asia/Taipei", carrier: null, service_reference: null, travel_class: null, booking_reference: "REF", notes: null, document_asset_ids: [], visibility: "private" });
const document = (id: string, title: string) => ({ id, title, document_kind: "booking", byte_size: 1, content_type: "application/pdf", original_filename: null, created_at: "2054-01-01T00:00:00Z", file_url: `/files/${id}` }) as DocumentAsset;

let api: FakeApi;
beforeEach(() => { auth.session = { accessToken: testToken() }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); expect(api.unexpected).toEqual([]); });

const confirmDelete = () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }));

it("opens a broad place in detail before its editor, prefilled", async () => {
  api = fakeApi().collection("/api/trips/trip/places/broad", [broadPlace]);
  renderWithOwner(<BroadPlaceManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Plaats Taipei bekijken" }));
  expect(screen.getByRole("heading", { name: "Taipei" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Plaats bewerken" })).toBeTruthy();
  expect((screen.getByLabelText("Naam") as HTMLInputElement).value).toBe("Taipei");
  expect((screen.getByLabelText("Breedtegraad (optioneel)") as HTMLInputElement).value).toBe("25.03");
});

it("deletes an unused broad place", async () => {
  api = fakeApi().collection("/api/trips/trip/places/broad", [broadPlace]);
  renderWithOwner(<BroadPlaceManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Plaats Taipei bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Plaats Taipei bekijken" })).toBeNull());
  expect(screen.getByText("Plaats verwijderd.")).toBeTruthy();
  expect(api.count("DELETE /api/trips/trip/places/broad/broad")).toBe(1);
});

it("shows an edited broad place at once and adds a new one to the list", async () => {
  api = fakeApi().collection("/api/trips/trip/places/broad", [broadPlace]);
  renderWithOwner(<BroadPlaceManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Plaats Taipei bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Nieuw-Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Plaats opslaan" }));
  await screen.findByRole("button", { name: "Plaats Nieuw-Taipei bekijken" });
  expect(screen.queryByRole("button", { name: "Plaats Taipei bekijken" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Plaats toevoegen" }));
  fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Tainan" } });
  fireEvent.change(screen.getByLabelText("Landcode (optioneel)"), { target: { value: "tw" } });
  fireEvent.click(screen.getByRole("button", { name: "Plaats opslaan" }));
  await screen.findByRole("button", { name: "Plaats Tainan bekijken" });
  expect(api.lastBody("POST /api/trips/trip/places/broad")).toMatchObject({ label: "Tainan", country_code: "TW", latitude: null, longitude: null });
});

it("asks for both broad coordinates or neither", async () => {
  api = fakeApi().collection("/api/trips/trip/places/broad", []);
  renderWithOwner(<BroadPlaceManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Plaats toevoegen" }));
  fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Taipei" } });
  fireEvent.change(screen.getByLabelText("Breedtegraad (optioneel)"), { target: { value: "25" } });
  fireEvent.click(screen.getByRole("button", { name: "Plaats opslaan" }));
  await screen.findByText("Vul beide kaartcoördinaten in of laat beide leeg.");
  expect(api.count("POST /api/trips/trip/places/broad")).toBe(0);
});

it("turns a place lookup into an editable, rounded broad place", async () => {
  api = fakeApi().collection("/api/trips/trip/places/broad", []);
  api.on("POST", /\/places\/search$/, () => ({ attribution: "© OpenStreetMap contributors", attribution_url: "https://www.openstreetmap.org/copyright", results: [{ osm_element_type: "relation", osm_element_id: "123", display_name: "Taipei, Exampleland", locality: "Taipei", admin_area: "Taipei City", country_code: "TW", latitude: 25.033964, longitude: 121.564468 }] }));
  renderWithOwner(<BroadPlaceManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Plaats toevoegen" }));
  fireEvent.change(screen.getByLabelText("Zoek stad of gebied"), { target: { value: "Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Taipei, Exampleland" }));
  expect((screen.getByLabelText("Naam") as HTMLInputElement).value).toBe("Taipei");
  expect((screen.getByLabelText("Regio (optioneel)") as HTMLInputElement).value).toBe("Taipei City");
  expect((screen.getByLabelText("Breedtegraad (optioneel)") as HTMLInputElement).value).toBe("25.03");
  expect((screen.getByLabelText("Lengtegraad (optioneel)") as HTMLInputElement).value).toBe("121.56");
});

it("keeps an exact looked-up stay place private until the stay is saved", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", []).collection("/api/trips/trip/places", []);
  api.on("POST", /\/places\/search$/, () => ({ attribution: "© OpenStreetMap contributors", attribution_url: "https://www.openstreetmap.org/copyright", results: [{ osm_element_type: "node", osm_element_id: "42", display_name: "Hotel Taipei", address_line1: "1 Example Road", locality: "Taipei", country_code: "TW", latitude: 25.034, longitude: 121.565 }] }));
  renderWithOwner(<StayManager trip={trip} broadPlaces={[broadPlace]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw verblijf" }));
  fireEvent.change(screen.getByLabelText("Zoek verblijf of adres"), { target: { value: "Hotel Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Hotel Taipei" }));
  expect((screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)") as HTMLInputElement).value).toBe("Hotel Taipei");
  expect((screen.getByLabelText("Adres (optioneel)") as HTMLInputElement).value).toBe("1 Example Road");
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("POST /api/trips/trip/stays")).toMatchObject({ place: { osm_element_type: "node", osm_element_id: "42", latitude: 25.034, longitude: 121.565, locality: "Taipei" } });
});

it("reuses a saved spot for a new stay instead of copying its address", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", []).collection("/api/trips/trip/places", [savedSpot]);
  renderWithOwner(<StayManager trip={trip} broadPlaces={[broadPlace]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw verblijf" }));
  fireEvent.change(await screen.findByLabelText("Gebruik een bestaande plek"), { target: { value: "bru" } });
  expect((screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)") as HTMLInputElement).value).toBe("Brussels Airport");
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody<{ place: unknown }>("POST /api/trips/trip/stays")?.place).toEqual({ existing_place_id: "bru" });
});

it("keeps a stay's saved spot when a hotel detail is corrected", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", [{ ...stay("s1", "Airport hotel"), place: savedSpot }]).collection("/api/trips/trip/places", [savedSpot]);
  renderWithOwner(<StayManager trip={trip} broadPlaces={[broadPlace]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Airport hotel/ }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)"), { target: { value: "Airport hotel Brussels" } });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody<{ place: unknown }>("PATCH /api/trips/trip/stays/s1")?.place).toEqual({ existing_place_id: "bru" });
});

it("opens a stay in private detail before editing, prefilled", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", [stay("s1", "Hotel")]).collection("/api/trips/trip/places", []);
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
  api = fakeApi().collection("/api/trips/trip/stays", [stay("s1", "Hotel"), stay("s2", "Hostel")]).collection("/api/trips/trip/places", []);
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
  api = fakeApi().collection("/api/trips/trip/stays", [stay("s1", "Hotel")]).collection("/api/trips/trip/places", []);
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
  api = fakeApi().collection("/api/trips/trip/stays", []).collection("/api/trips/trip/places", []);
  renderWithOwner(<StayManager trip={trip} broadPlaces={[]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw verblijf" }));
  fireEvent.change(screen.getByLabelText("Eerste nacht (inchecken)"), { target: { value: "2054-11-20" } });
  await waitFor(() => expect((screen.getByLabelText("Uitchecken (ochtend)") as HTMLInputElement).value).toBe("2054-11-21"));
  fireEvent.change(screen.getByLabelText("Uitchecken (ochtend)"), { target: { value: "2054-11-19" } });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await screen.findByText("Uitchecken gebeurt ten vroegste de ochtend na de eerste nacht.");
  expect(api.count("POST /api/trips/trip/stays")).toBe(0);
});

it("sets who sees a stay from its own detail, with the same control as everywhere", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", [stay("s1", "Hotel")]).collection("/api/trips/trip/places", []);
  api.on("PUT", /\/visibility\/stay\/s1$/, (body) => body);
  renderWithOwner(<StayManager trip={trip} broadPlaces={[broadPlace]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Hotel/ }));
  const control = screen.getByLabelText("Zichtbaarheid van Hotel") as HTMLSelectElement;
  expect(control.value).toBe("private");
  fireEvent.change(control, { target: { value: "everyone" } });
  await waitFor(() => expect(api.lastBody("PUT /api/trips/trip/visibility/stay/s1")).toEqual({ visibility: "everyone" }));
});

it("lets the owner choose how precisely visitors see a stay's nights", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", []).collection("/api/trips/trip/places", []);
  renderWithOwner(<StayManager trip={trip} broadPlaces={[broadPlace]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw verblijf" }));
  expect((screen.getByLabelText("Datums voor bezoekers") as HTMLSelectElement).value).toBe("month");
  fireEvent.change(screen.getByLabelText("Datums voor bezoekers"), { target: { value: "day" } });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() => expect(api.lastBody("POST /api/trips/trip/stays")).toMatchObject({ share_date_precision: "day" }));
});

it("opens transport detail before its editor, prefilled", async () => {
  api = fakeApi().collection("/api/trips/trip/transport-legs", [leg("l1", "Brussels")]).collection("/api/trips/trip/documents", []).collection("/api/trips/trip/places", []);
  renderWithOwner(<TransportLegManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Vlucht: Brussels/ }));
  expect(screen.getByText("Boekingsreferentie: REF")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Transportonderdeel bewerken" })).toBeTruthy();
  expect((screen.getByLabelText("Boekingsreferentie (optioneel)") as HTMLInputElement).value).toBe("REF");
  expect((screen.getByLabelText("Tijdzone vertrek") as HTMLInputElement).value).toBe("Europe/Brussels");
});

it("uses the exact selected place when saving a transport endpoint", async () => {
  api = fakeApi().collection("/api/trips/trip/transport-legs", []).collection("/api/trips/trip/documents", []).collection("/api/trips/trip/places", []);
  api.on("POST", /\/places\/search$/, () => ({ attribution: "© OpenStreetMap contributors", attribution_url: "https://www.openstreetmap.org/copyright", results: [{ osm_element_type: "node", osm_element_id: "8", display_name: "Brussels Airport", locality: "Zaventem", country_code: "BE", latitude: 50.901, longitude: 4.484 }] }));
  renderWithOwner(<TransportLegManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw onderdeel" }));
  fireEvent.change(screen.getByLabelText("Zoek vertrekplaats"), { target: { value: "Brussels Airport" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Zoeken" })[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Brussels Airport" }));
  expect((screen.getAllByLabelText("Naam (optioneel)")[0] as HTMLInputElement).value).toBe("Brussels Airport");
  fireEvent.click(screen.getByRole("button", { name: "Onderdeel toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("POST /api/trips/trip/transport-legs")).toMatchObject({ departure_place: { osm_element_type: "node", osm_element_id: "8", latitude: 50.901, longitude: 4.484, locality: "Zaventem" } });
});

it("reuses a saved spot for a transport endpoint", async () => {
  api = fakeApi().collection("/api/trips/trip/transport-legs", []).collection("/api/trips/trip/documents", []).collection("/api/trips/trip/places", [savedSpot]);
  renderWithOwner(<TransportLegManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw onderdeel" }));
  fireEvent.change((await screen.findAllByLabelText("Gebruik een bestaande plek"))[0], { target: { value: "bru" } });
  fireEvent.click(screen.getByRole("button", { name: "Onderdeel toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody<{ departure_place: unknown }>("POST /api/trips/trip/transport-legs")?.departure_place).toEqual({ existing_place_id: "bru" });
});

it("keeps a transport endpoint's saved spot when its name is corrected", async () => {
  const savedLeg = { ...leg("l1", "Zaventem"), departure_place: savedSpot, arrival_place: savedSpot };
  api = fakeApi().collection("/api/trips/trip/transport-legs", [savedLeg]).collection("/api/trips/trip/documents", []).collection("/api/trips/trip/places", [savedSpot]);
  renderWithOwner(<TransportLegManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Vlucht: Zaventem/ }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getAllByLabelText("Naam (optioneel)")[0], { target: { value: "Brussels National Airport" } });
  fireEvent.click(screen.getByRole("button", { name: "Onderdeel opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody<{ departure_place: unknown }>("PATCH /api/trips/trip/transport-legs/l1")?.departure_place).toEqual({ existing_place_id: "bru" });
});

it("shows an edited leg and forgets a deleted one, linking documents on the way", async () => {
  api = fakeApi().collection("/api/trips/trip/transport-legs", [leg("l1", "Brussels"), leg("l2", "Parijs")]).collection("/api/trips/trip/documents", [document("d1", "Ticket")]).collection("/api/trips/trip/places", []);
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
