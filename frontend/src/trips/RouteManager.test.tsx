// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { Area, DocumentAsset, Location, Route, Trip } from "../tracker-model";
import { RouteManager } from "./RouteManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const area = (id: string, label: string, latitude: number | null = null, longitude: number | null = null): Area => ({ id, visibility: "private", label, country_code: "TW", region: null, latitude, longitude, timezone: null });
const taipei = area("taipei", "Taipei", 25.03, 121.56), tainan = area("tainan", "Tainan", 23.0, 120.2);
const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, travel_updates: [] };
const savedLocation = { id: "main-station", visibility: "private", label: null, area_id: "taipei", share_address: false, display_name: "Taipei Main Station", locality: "Taipei", country_code: "TW" } as Location;
const route = (id: string, label: string | null, overrides: Partial<Route> = {}): Route => ({
  id, mode: "train", status: "booked", label, departure_area: taipei, arrival_area: tainan, departure_location: null, arrival_location: null,
  departs_at: null, arrives_at: null, departure_timezone: null, arrival_timezone: null, carrier: null, service_reference: null, travel_class: null,
  booking_reference: null, notes: null, document_asset_ids: [], geometry: null, visibility: "private", ...overrides,
});
const flight = route("r-flight", null, {
  mode: "flight", departure_area: area("ams", "Amsterdam"), arrival_area: area("tpe", "Taoyuan"),
  departure_location: { id: "ams-airport", area_id: "ams", display_name: "Amsterdam Schiphol", locality: "Amsterdam" } as Location,
  departs_at: "2054-11-16T09:40:00Z", arrives_at: "2054-11-16T22:25:00Z", departure_timezone: "Europe/Amsterdam", arrival_timezone: "Asia/Taipei",
  booking_reference: "REF", carrier: "China Airlines",
});
const line = route("r-line", "Oostkust", { geometry: { type: "LineString", coordinates: [[121.5, 25], [121.6, 25.1]] } });
const ticket = { id: "d1", title: "Ticket" } as DocumentAsset;

let api: FakeApi;
function seed(routes: Route[] = [], locations: Location[] = [], areas: Area[] = [taipei, tainan]) {
  api = fakeApi()
    .collection("/api/trips/trip/routes", routes, {
      // The service answers with the areas the ends were filed under.
      create: (body, count) => route(`new-${count}`, (body.label as string | null) ?? null, {
        mode: body.mode as Route["mode"], departure_area: areas.find((item) => item.id === body.departure_area_id) ?? taipei, arrival_area: areas.find((item) => item.id === body.arrival_area_id) ?? tainan,
      }),
      update: (row, body) => ({ ...row, ...body }),
    })
    .collection("/api/trips/trip/areas", areas)
    .collection("/api/trips/trip/documents", [ticket])
    .collection("/api/trips/trip/locations", locations);
}
beforeEach(() => { auth.session = { accessToken: testToken() }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expect(api.unexpected).toEqual([]); });

const pickAreas = (from = "area:taipei", to = "area:tainan") => {
  fireEvent.change(screen.getByLabelText("Vertrek"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("Aankomst"), { target: { value: to } });
};

it("needs only a mode and two areas", async () => {
  seed();
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  expect(screen.getByRole("heading", { name: "Route toevoegen" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await screen.findByText("Kies waar de route begint: een gebied of een locatie.");
  expect(api.count("POST /api/trips/trip/routes")).toBe(0);

  fireEvent.change(screen.getByLabelText("Vervoer"), { target: { value: "bike" } });
  pickAreas();
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await screen.findByRole("button", { name: "Route Taipei → Tainan bekijken" });
  expect(api.lastBody("POST /api/trips/trip/routes")).toMatchObject({
    mode: "bike", departure_area_id: "taipei", arrival_area_id: "tainan", departs_at: null, arrives_at: null, geometry: null, label: null,
  });
  expect(api.lastBody<{ departure_location: unknown }>("POST /api/trips/trip/routes")?.departure_location).toBeNull();
  expect(screen.getByText("Route opgeslagen.")).toBeTruthy();
});

it("takes both times or neither", async () => {
  seed();
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  pickAreas();
  fireEvent.change(screen.getByLabelText("Vertrektijd (lokaal) (optioneel)"), { target: { value: "2054-11-16T10:40" } });
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await screen.findByText("Geef zowel de vertrek- als de aankomsttijd op, of geen van beide.");
  expect(api.count("POST /api/trips/trip/routes")).toBe(0);

  fireEvent.change(screen.getByLabelText("Tijdzone vertrek (optioneel)"), { target: { value: "Europe/Amsterdam" } });
  fireEvent.change(screen.getByLabelText("Aankomsttijd (lokaal) (optioneel)"), { target: { value: "2054-11-17T06:25" } });
  fireEvent.change(screen.getByLabelText("Tijdzone aankomst (optioneel)"), { target: { value: "Asia/Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("POST /api/trips/trip/routes")).toMatchObject({
    departs_at: "2054-11-16T10:40:00", arrives_at: "2054-11-17T06:25:00", departure_timezone: "Europe/Amsterdam", arrival_timezone: "Asia/Taipei",
  });
});

it("opens a route in detail before its editor, prefilled with its bookings and times", async () => {
  seed([flight], [flight.departure_location!], [flight.departure_area, flight.arrival_area]);
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Route Amsterdam → Taoyuan bekijken" }));
  expect(screen.getByText("Boekingsreferentie: REF")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Route bewerken" })).toBeTruthy();
  expect((screen.getByLabelText("Vertrek") as HTMLSelectElement).value).toBe("location:ams-airport");
  expect((screen.getByLabelText("Aankomst") as HTMLSelectElement).value).toBe("area:tpe");
  expect((screen.getByLabelText("Boekingsreferentie (optioneel)") as HTMLInputElement).value).toBe("REF");
  expect((screen.getByLabelText("Tijdzone vertrek (optioneel)") as HTMLInputElement).value).toBe("Europe/Amsterdam");
  expect((screen.getByLabelText("Vertrektijd (lokaal) (optioneel)") as HTMLInputElement).value).toBe("2054-11-16T10:40");
});

it("files a new location under the chosen area", async () => {
  seed();
  api.on("POST", /\/places\/search$/, () => ({ attribution: "© OpenStreetMap contributors", attribution_url: "https://www.openstreetmap.org/copyright", results: [{ osm_element_type: "node", osm_element_id: "8", display_name: "Taipei Main Station", locality: "Taipei", country_code: "TW", latitude: 25.048, longitude: 121.517 }] }));
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  pickAreas("new", "area:tainan");
  fireEvent.change(screen.getByLabelText("Zoek locatie (vertrek)"), { target: { value: "Taipei Main Station" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Zoeken" })[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Taipei Main Station" }));
  fireEvent.change(screen.getByLabelText("Gebied van de nieuwe locatie (vertrek)"), { target: { value: "taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("POST /api/trips/trip/routes")).toMatchObject({
    departure_location: { osm_element_type: "node", osm_element_id: "8", latitude: 25.048, longitude: 121.517, locality: "Taipei", area_id: "taipei" },
    arrival_area_id: "tainan",
  });
});

it("reuses a saved location, which is already part of its area", async () => {
  seed([], [savedLocation]);
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  const departure = screen.getByLabelText("Vertrek") as HTMLSelectElement;
  // The location is listed under its area, so one choice says both.
  expect(within(departure.querySelector("optgroup[label='Taipei']") as HTMLElement).getByText("Taipei Main Station")).toBeTruthy();
  pickAreas("location:main-station", "area:tainan");
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const sent = api.lastBody<Record<string, unknown>>("POST /api/trips/trip/routes")!;
  expect(sent.departure_location).toEqual({ existing_location_id: "main-station" });
  expect(sent).not.toHaveProperty("departure_area_id");
});

it("rewrites an end only when it changed, and moving to the whole area clears the location", async () => {
  const withStation = route("r1", null, { departure_location: savedLocation });
  seed([withStation], [savedLocation]);
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Route Taipei → Tainan bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect((screen.getByLabelText("Vertrek") as HTMLSelectElement).value).toBe("location:main-station");
  fireEvent.change(screen.getByLabelText("Vervoerder (optioneel)"), { target: { value: "THSR" } });
  fireEvent.click(screen.getByRole("button", { name: "Route opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/routes/r1")).toMatchObject({ carrier: "THSR" });
  for (const untouched of ["departure_location", "departure_area_id", "arrival_area_id", "arrival_location"]) expect(api.lastBody("PATCH /api/trips/trip/routes/r1")).not.toHaveProperty(untouched);

  fireEvent.click(await screen.findByRole("button", { name: /Route Taipei → Tainan bekijken/ }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Vertrek"), { target: { value: "area:taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Route opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/routes/r1")).toMatchObject({ departure_area_id: "taipei", departure_location: null });
});

it("offers the areas' points to a drawn line, and shows a saved line in its editor", async () => {
  seed([line]);
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Route Oostkust bekijken" }));
  expect(screen.getByRole("heading", { name: "Routevoorbeeld" })).toBeTruthy();
  expect(screen.getByText("2 algemene punten in deze route.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Route tekenen op kaart" })).toBeTruthy();
  expect(screen.getByText("2 punten · minstens twee punten zijn nodig.")).toBeTruthy();
  fireEvent.click(screen.getByText("Geavanceerd: coördinaten als JSON plakken"));
  expect((screen.getByLabelText("Lijncoördinaten (JSON) (optioneel)") as HTMLTextAreaElement).value).toBe("[[121.5,25],[121.6,25.1]]");
  fireEvent.change(screen.getAllByLabelText("Naam (optioneel)")[0], { target: { value: "Oostkust noord" } });
  fireEvent.click(screen.getByRole("button", { name: "Route opslaan" }));
  await screen.findByRole("button", { name: "Route Oostkust noord bekijken" });
  expect(api.lastBody("PATCH /api/trips/trip/routes/r-line")).toMatchObject({ label: "Oostkust noord", geometry: { type: "LineString", coordinates: [[121.5, 25], [121.6, 25.1]] } });
  expect(screen.getByText("Route opgeslagen.")).toBeTruthy();
});

it("sends a pasted line only when it has at least two valid points", async () => {
  seed();
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  pickAreas();
  fireEvent.click(screen.getByText("Geavanceerd: coördinaten als JSON plakken"));
  fireEvent.change(screen.getByLabelText("Lijncoördinaten (JSON) (optioneel)"), { target: { value: "[[121.5,25]]" } });
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await screen.findByText("Een lijn heeft minstens twee punten nodig.");
  fireEvent.change(screen.getByLabelText("Lijncoördinaten (JSON) (optioneel)"), { target: { value: "geen json" } });
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await screen.findByText("Gebruik geldige JSON met minstens twee [lengtegraad, breedtegraad]-paren.");
  expect(api.count("POST /api/trips/trip/routes")).toBe(0);

  fireEvent.change(screen.getByLabelText("Lijncoördinaten (JSON) (optioneel)"), { target: { value: "[[121.5,25],[121.7,25.2]]" } });
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await waitFor(() => expect(api.lastBody("POST /api/trips/trip/routes")).toMatchObject({ geometry: { type: "LineString", coordinates: [[121.5, 25], [121.7, 25.2]] } }));
});

it("links documents to a route and forgets a deleted one after the in-app confirmation", async () => {
  seed([flight, line], [], [flight.departure_area, flight.arrival_area, taipei, tainan]);
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Route Amsterdam → Taoyuan bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.click(await screen.findByLabelText("Ticket"));
  fireEvent.click(screen.getByRole("button", { name: "Route opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/routes/r-flight")).toMatchObject({ document_asset_ids: ["d1"] });

  fireEvent.click(screen.getAllByRole("button", { name: "Verwijderen" })[1]);
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: /Oostkust/ })).toBeNull());
  expect(screen.getByRole("button", { name: /Amsterdam → Taoyuan/ })).toBeTruthy();
  expect(api.count("DELETE /api/trips/trip/routes/r-line")).toBe(1);
});
