// @vitest-environment happy-dom
import { setDateTime, shownDateTime } from "../test-dates";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { chooseOption, renderWithOwner, selectedOption, testToken } from "../query/test-utils";
import type { Area, DocumentAsset, Location, Route, Trip } from "../api-types";
import { changeLocale } from "../locale";
import { RouteManager } from "./RouteManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const area = (
  id: string,
  label: string,
  latitude: number | null = null,
  longitude: number | null = null,
): Area => ({
  id,
  visibility: "private",
  label,
  country_code: "TW",
  region: null,
  latitude,
  longitude,
  timezone: null,
});
const taipei = area("taipei", "Taipei", 25.03, 121.56),
  tainan = area("tainan", "Tainan", 23.0, 120.2);
const trip: Trip = {
  owner_subject: "owner-1",
  cover_derivative_id: null,
  cover_url: null,
  summary_html: null,
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [],
};
const savedLocation = {
  id: "main-station",
  visibility: "private",
  label: null,
  area_id: "taipei",
  share_address: false,
  display_name: "Taipei Main Station",
  locality: "Taipei",
  country_code: "TW",
} as Location;
const route = (id: string, label: string | null, overrides: Partial<Route> = {}): Route => ({
  id,
  mode: "train",
  status: "confirmed",
  label,
  departure_area: taipei,
  arrival_area: tainan,
  departure_location: null,
  arrival_location: null,
  departs_on: null,
  departs_at: null,
  arrives_at: null,
  departure_timezone: null,
  arrival_timezone: null,
  carrier: null,
  service_reference: null,
  travel_class: null,
  booking_reference: null,
  notes: null,
  document_asset_ids: [],
  geometry: null,
  visibility: "private",
  notes_html: null,
  ...overrides,
});
const flight = route("r-flight", null, {
  mode: "flight",
  departure_area: area("ams", "Amsterdam"),
  arrival_area: area("tpe", "Taoyuan"),
  departure_location: {
    id: "ams-airport",
    area_id: "ams",
    display_name: "Amsterdam Schiphol",
    locality: "Amsterdam",
  } as Location,
  departs_on: "2054-11-16",
  departs_at: "2054-11-16T09:40:00Z",
  arrives_at: "2054-11-16T22:25:00Z",
  departure_timezone: "Europe/Amsterdam",
  arrival_timezone: "Asia/Taipei",
  booking_reference: "REF",
  carrier: "China Airlines",
});
const line = route("r-line", "Oostkust", {
  geometry: {
    type: "LineString",
    coordinates: [
      [121.5, 25],
      [121.6, 25.1],
    ],
  },
});
const ticket = { id: "d1", title: "Ticket" } as DocumentAsset;

let api: FakeApi;
function seed(routes: Route[] = [], locations: Location[] = [], areas: Area[] = [taipei, tainan]) {
  api = fakeApi()
    .collection("/api/trips/trip/routes", routes, {
      // The service answers with the areas the ends were filed under.
      create: (body, count) =>
        route(`new-${count}`, (body.label as string | null) ?? null, {
          mode: body.mode as Route["mode"],
          departure_area: areas.find((item) => item.id === body.departure_area_id) ?? taipei,
          arrival_area: areas.find((item) => item.id === body.arrival_area_id) ?? tainan,
        }),
      update: (row, body) => ({ ...row, ...body }),
    })
    .collection("/api/trips/trip/areas", areas)
    .collection("/api/trips/trip/documents", [ticket])
    .collection("/api/trips/trip/locations", locations);
  api.on("POST", /\/areas\/suggest$/, () => ({ existing_area_id: "taipei", area: taipei }));
}
beforeEach(() => {
  auth.session = { accessToken: testToken() };
});
afterEach(() => {
  cleanup();
  act(() => changeLocale("nl"));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(api.unexpected).toEqual([]);
});

const pickAreas = (from = "Taipei (heel gebied)", to = "Tainan (heel gebied)") => {
  chooseOption("Vertrek", from);
  chooseOption("Aankomst", to);
};

const idea = (id: string, label: string) =>
  route(id, label, { status: "idea", departs_on: "2054-12-01" });

it("lists a stored group of route ideas as alternatives and keeps them off the share controls", async () => {
  const ideas = [idea("i1", "HSR"), idea("i2", "Bus")];
  seed([
    ...ideas,
    route("r1", "Chosen train", { departs_on: "2054-12-01" }),
    route("i3", "Other day", { status: "idea", departs_on: "2054-12-02" }),
  ]);
  api.collection("/api/trips/trip/alternative-groups", [
    {
      id: "g1",
      kind: "route",
      label: null,
      chosen_id: null,
      members: ideas.map((item) => ({
        record_id: item.id,
        chosen: false,
        stay: null,
        visit: null,
        route: item,
      })),
      created_at: "2054-01-01T00:00:00Z",
      updated_at: "2054-01-01T00:00:00Z",
    },
  ]);
  renderWithOwner(<RouteManager trip={trip} />);
  const group = await screen.findByRole("group", { name: "Alternatieven · 1 dec" });
  expect(within(group).getByRole("button", { name: /^HSR/ }).textContent).toContain("Idee");
  expect(within(group).getByRole("button", { name: /^Bus/ })).toBeTruthy();
  expect(within(group).queryByRole("button", { name: /Chosen train/ })).toBeNull();
  // Ideas are never grouped by their dates alone.
  expect(screen.getAllByRole("group")).toHaveLength(1);

  fireEvent.click(within(group).getByRole("button", { name: /^HSR/ }));
  expect(screen.getByText(/Een idee is een kandidaat/)).toBeTruthy();
  expect(screen.queryByText("Wie mag dit zien?")).toBeNull();
});

it("offers to cancel the rejected ideas once a route for the same journey is chosen", async () => {
  seed([
    idea("i1", "HSR"),
    idea("i2", "Bus"),
    route("r1", "Chosen train", { departs_on: "2054-12-01" }),
  ]);
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Route Chosen train bekijken" }));
  expect(screen.getByText("2 ideeën voor dezelfde reis.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Annuleer 2 alternatieven" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/routes/i1")).toEqual({ status: "cancelled" });
  expect(api.lastBody("PATCH /api/trips/trip/routes/i2")).toEqual({ status: "cancelled" });
  expect(screen.getByText("Alternatieven geannuleerd.")).toBeTruthy();
  // An idea is not offered the cancel action for its own rivals.
  fireEvent.click(screen.getByRole("button", { name: "Route Chosen train bekijken" }));
  expect(screen.queryByRole("button", { name: /Annuleer/ })).toBeNull();
});

it("explains a route idea in the editor", async () => {
  seed();
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  chooseOption("Status", "Idee");
  expect(await screen.findByText(/Een idee is een kandidaat/)).toBeTruthy();
});

it("needs only a mode and two areas", async () => {
  seed();
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  expect(screen.getByRole("heading", { name: "Route toevoegen" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await screen.findByText("Kies waar de route begint: een gebied of een locatie.");
  expect(api.count("POST /api/trips/trip/routes")).toBe(0);

  chooseOption("Vervoer", "Fiets");
  pickAreas();
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await screen.findByRole("button", { name: "Route Taipei → Tainan bekijken" });
  expect(api.lastBody("POST /api/trips/trip/routes")).toMatchObject({
    mode: "bike",
    departure_area_id: "taipei",
    arrival_area_id: "tainan",
    departs_on: null,
    departs_at: null,
    arrives_at: null,
    geometry: null,
    label: null,
  });
  expect(
    api.lastBody<{ departure_location: unknown }>("POST /api/trips/trip/routes")
      ?.departure_location,
  ).toBeNull();
  expect(screen.getByText("Route opgeslagen.")).toBeTruthy();
});

it("refuses a route that starts and ends at the same place", async () => {
  seed();
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  pickAreas("Taipei (heel gebied)", "Taipei (heel gebied)");
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await screen.findByText("Kies twee verschillende plaatsen: vertrek en aankomst zijn hetzelfde.");
  expect(api.count("POST /api/trips/trip/routes")).toBe(0);
});

it("takes both times or neither", async () => {
  seed();
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  pickAreas();
  setDateTime("Vertrektijd (lokaal)", "2054-11-16T10:40");
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await screen.findByText("Geef zowel de vertrek- als de aankomsttijd op, of geen van beide.");
  expect(api.count("POST /api/trips/trip/routes")).toBe(0);

  fireEvent.change(screen.getByLabelText("Tijdzone vertrek (optioneel)"), {
    target: { value: "Europe/Amsterdam" },
  });
  setDateTime("Aankomsttijd (lokaal)", "2054-11-17T06:25");
  fireEvent.change(screen.getByLabelText("Tijdzone aankomst (optioneel)"), {
    target: { value: "Asia/Taipei" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("POST /api/trips/trip/routes")).toMatchObject({
    departs_on: "2054-11-16",
    departs_at: "2054-11-16T10:40:00",
    arrives_at: "2054-11-17T06:25:00",
    departure_timezone: "Europe/Amsterdam",
    arrival_timezone: "Asia/Taipei",
  });
});

it("takes a day first, and times only on that day", async () => {
  seed();
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  pickAreas();
  fireEvent.change(screen.getByLabelText("Dag van vertrek (optioneel)"), {
    target: { value: "2054-12-05" },
  });
  setDateTime("Vertrektijd (lokaal)", "2054-12-06T08:00");
  setDateTime("Aankomsttijd (lokaal)", "2054-12-06T10:00");
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await screen.findByText(/De vertrektijd valt op .*, niet op de gekozen dag/);
  expect(api.count("POST /api/trips/trip/routes")).toBe(0);
  act(() => changeLocale("en"));
  expect(screen.getByText(/The departure time falls on .*not on the selected day/)).toBeTruthy();
  act(() => changeLocale("nl"));

  // "Kaohsiung → Taipei on 5 December, no train yet": the day alone.
  setDateTime("Vertrektijd (lokaal)", "");
  setDateTime("Aankomsttijd (lokaal)", "");
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("POST /api/trips/trip/routes")).toMatchObject({
    departs_on: "2054-12-05",
    departs_at: null,
    arrives_at: null,
  });
});

it("shows a route's day while it has no times", async () => {
  seed([route("r-day", "Naar het noorden", { departs_on: "2054-12-05" })]);
  renderWithOwner(<RouteManager trip={trip} />);
  const row = await screen.findByRole("button", { name: "Route Naar het noorden bekijken" });
  expect(row.textContent).toContain("5 dec");
  fireEvent.click(row);
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect((screen.getByLabelText("Dag van vertrek (optioneel)") as HTMLInputElement).value).toBe(
    "5 dec 2054",
  );
});

it("opens a route in detail before its editor, prefilled with its bookings and times", async () => {
  seed([flight], [flight.departure_location!], [flight.departure_area, flight.arrival_area]);
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Route Amsterdam → Taoyuan bekijken" }),
  );
  expect(screen.getByText("Boekingsreferentie: REF")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Route bewerken" })).toBeTruthy();
  expect(selectedOption("Vertrek")).toBe("Amsterdam Schiphol");
  expect(selectedOption("Aankomst")).toBe("Taoyuan (heel gebied)");
  expect((screen.getByLabelText("Boekingsreferentie (optioneel)") as HTMLInputElement).value).toBe(
    "REF",
  );
  expect((screen.getByLabelText("Tijdzone vertrek (optioneel)") as HTMLInputElement).value).toBe(
    "Europe/Amsterdam",
  );
  expect(shownDateTime("Vertrektijd (lokaal)")).toBe("16 nov 2054 10:40");
});

it("files a new location under the chosen area", async () => {
  seed();
  api.on("POST", /\/places\/search$/, () => ({
    attribution: "© OpenStreetMap contributors",
    attribution_url: "https://www.openstreetmap.org/copyright",
    results: [
      {
        osm_element_type: "node",
        osm_element_id: "8",
        display_name: "Taipei Main Station",
        locality: "Taipei",
        country_code: "TW",
        latitude: 25.048,
        longitude: 121.517,
      },
    ],
  }));
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  pickAreas("Nieuwe locatie…", "Tainan (heel gebied)");
  fireEvent.change(screen.getByLabelText("Zoek locatie (Vertrek)"), {
    target: { value: "Taipei Main Station" },
  });
  fireEvent.click(screen.getAllByRole("button", { name: "Zoeken" })[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Taipei Main Station" }));
  chooseOption("Gebied van de nieuwe locatie (Vertrek)", "Taipei");
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("POST /api/trips/trip/routes")).toMatchObject({
    departure_location: {
      osm_element_type: "node",
      osm_element_id: "8",
      latitude: 25.048,
      longitude: 121.517,
      locality: "Taipei",
      area_id: "taipei",
    },
    arrival_area_id: "tainan",
  });
});

it("shows a nearby area suggestion before saving a new location", async () => {
  seed();
  api.on("POST", /\/places\/search$/, () => ({
    attribution: "Test",
    attribution_url: "https://example.test",
    results: [
      {
        osm_element_type: "node",
        osm_element_id: "8",
        display_name: "Taipei Main Station",
        locality: "Taipei",
        country_code: "TW",
        latitude: 25.048,
        longitude: 121.517,
      },
    ],
  }));
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  pickAreas("Nieuwe locatie…", "Tainan (heel gebied)");
  fireEvent.change(screen.getByLabelText("Zoek locatie (Vertrek)"), {
    target: { value: "Taipei Main Station" },
  });
  fireEvent.click(screen.getAllByRole("button", { name: "Zoeken" })[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Taipei Main Station" }));
  await waitFor(() =>
    expect(selectedOption("Gebied van de nieuwe locatie (Vertrek)")).toBe("Taipei"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await waitFor(() =>
    expect(
      api.lastBody<Record<string, { area_id: string }>>("POST /api/trips/trip/routes")
        ?.departure_location.area_id,
    ).toBe("taipei"),
  );
});

it("reuses a saved location, which is already part of its area", async () => {
  seed([], [savedLocation]);
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  // The location is listed under its area, so one choice says both.
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Vertrek" }), { key: "ArrowDown" });
  const stationOption = screen.getByRole("option", { name: "Taipei Main Station" });
  expect(stationOption.closest("[role=group]")?.textContent).toContain("Taipei");
  pickAreas("Taipei Main Station", "Tainan (heel gebied)");
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
  expect(selectedOption("Vertrek")).toBe("Taipei Main Station");
  fireEvent.change(screen.getByLabelText("Vervoerder (optioneel)"), { target: { value: "THSR" } });
  fireEvent.click(screen.getByRole("button", { name: "Route opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/routes/r1")).toMatchObject({ carrier: "THSR" });
  for (const untouched of [
    "departure_location",
    "departure_area_id",
    "arrival_area_id",
    "arrival_location",
  ])
    expect(api.lastBody("PATCH /api/trips/trip/routes/r1")).not.toHaveProperty(untouched);

  fireEvent.click(await screen.findByRole("button", { name: /Route Taipei → Tainan bekijken/ }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  chooseOption("Vertrek", "Taipei (heel gebied)");
  fireEvent.click(screen.getByRole("button", { name: "Route opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/routes/r1")).toMatchObject({
    departure_area_id: "taipei",
    departure_location: null,
  });
});

it("offers the areas' points to a drawn line, and shows a saved line in its editor", async () => {
  seed([line]);
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Route Oostkust bekijken" }));
  expect(screen.getByRole("heading", { name: "Routevoorbeeld" })).toBeTruthy();
  expect(screen.getByText("2 algemene punten in deze route.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Route tekenen op kaart" })).toBeTruthy();
  expect(screen.getByText("2 algemene punten in deze route.")).toBeTruthy();
  fireEvent.click(screen.getByText("Geavanceerd: coördinaten als JSON plakken"));
  expect(
    (screen.getByLabelText("Lijncoördinaten (JSON) (optioneel)") as HTMLTextAreaElement).value,
  ).toBe("[[121.5,25],[121.6,25.1]]");
  fireEvent.change(screen.getAllByLabelText("Naam (optioneel)")[0], {
    target: { value: "Oostkust noord" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Route opslaan" }));
  await screen.findByRole("button", { name: "Route Oostkust noord bekijken" });
  expect(api.lastBody("PATCH /api/trips/trip/routes/r-line")).toMatchObject({
    label: "Oostkust noord",
    geometry: {
      type: "LineString",
      coordinates: [
        [121.5, 25],
        [121.6, 25.1],
      ],
    },
  });
  expect(screen.getByText("Route opgeslagen.")).toBeTruthy();
});

it("sends a pasted line only when it has at least two valid points", async () => {
  seed();
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe route" }));
  pickAreas();
  fireEvent.click(screen.getByText("Geavanceerd: coördinaten als JSON plakken"));
  fireEvent.change(screen.getByLabelText("Lijncoördinaten (JSON) (optioneel)"), {
    target: { value: "[[121.5,25]]" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await screen.findByText("Een lijn heeft minstens twee punten nodig.");
  fireEvent.change(screen.getByLabelText("Lijncoördinaten (JSON) (optioneel)"), {
    target: { value: "geen json" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await screen.findByText(
    "Gebruik geldige JSON met minstens twee [lengtegraad, breedtegraad]-paren.",
  );
  expect(api.count("POST /api/trips/trip/routes")).toBe(0);

  fireEvent.change(screen.getByLabelText("Lijncoördinaten (JSON) (optioneel)"), {
    target: { value: "[[121.5,25],[121.7,25.2]]" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Route toevoegen" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/routes")).toMatchObject({
      geometry: {
        type: "LineString",
        coordinates: [
          [121.5, 25],
          [121.7, 25.2],
        ],
      },
    }),
  );
});

it("links documents to a route and forgets a deleted one after the in-app confirmation", async () => {
  seed([flight, line], [], [flight.departure_area, flight.arrival_area, taipei, tainan]);
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Route Amsterdam → Taoyuan bekijken" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Ticket" }));
  fireEvent.click(screen.getByRole("button", { name: "Route opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/routes/r-flight")).toMatchObject({
    document_asset_ids: ["d1"],
  });

  fireEvent.click(await screen.findByRole("button", { name: /Route Oostkust/ }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );
  await waitFor(() => expect(screen.queryByRole("button", { name: /Oostkust/ })).toBeNull());
  expect(await screen.findByRole("button", { name: /Amsterdam → Taoyuan/ })).toBeTruthy();
  expect(api.count("DELETE /api/trips/trip/routes/r-line")).toBe(1);
});

it("says which schedule fields a shared route reveals, in both languages", async () => {
  seed();
  renderWithOwner(<RouteManager trip={trip} />);
  for (const [locale, shared, never] of [
    ["nl", /vervoerder, dienstnummer en planning/, /Boekingen, reisklasse, notities en documenten/],
    ["en", /carrier, service number, schedule/, /Bookings, travel class, notes and documents/],
  ] as const) {
    act(() => changeLocale(locale));
    const text = (await screen.findAllByText(shared))[0]!.textContent ?? "";
    expect(text).toMatch(never);
    expect(text).not.toMatch(
      /times (stay|and bookings are optional and stay) private|tijden en boekingen zijn optioneel en blijven privé/,
    );
  }
});

it("reviews a local flight arc offline using area points, edits it, and saves only on request", async () => {
  const privateLocation = { ...savedLocation, latitude: 88, longitude: 99 };
  const localFlight = route("local", "Local flight", {
    mode: "flight",
    departure_location: privateLocation,
    geometry: line.geometry,
  });
  seed([localFlight], [privateLocation]);
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Route Local flight bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.click(screen.getByText("Geavanceerd: coördinaten als JSON plakken"));
  const input = screen.getByLabelText("Lijncoördinaten (JSON) (optioneel)") as HTMLTextAreaElement;
  expect(input.value).toBe(JSON.stringify(line.geometry!.coordinates));
  // Local calculation has no online dependency and sends no request.
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const before = [...api.requests];
  fireEvent.click(screen.getByRole("button", { name: "Vluchtlijn voorstellen" }));
  expect(api.requests).toEqual(before);
  const points = JSON.parse(input.value);
  expect(points[0]).toEqual([taipei.longitude, taipei.latitude]);
  expect(points.at(-1)).toEqual([tainan.longitude, tainan.latitude]);
  expect(points).not.toContainEqual([99, 88]);
  act(() => changeLocale("en"));
  expect(screen.getByText(/The flight line is ready to review/)).toBeTruthy();
  expect(input.value).toBe(JSON.stringify(points));
  fireEvent.click(screen.getByRole("button", { name: "Remove last point" }));
  expect(JSON.parse(input.value)).toEqual(points.slice(0, -1));
  vi.restoreAllMocks();
  api.failNext = { status: 503, body: { detail: "Private provider diagnostics" } };
  fireEvent.click(screen.getByRole("button", { name: "Save route" }));
  await screen.findByText(/The route could not be saved/);
  expect(screen.queryByText("Private provider diagnostics")).toBeNull();
  expect(api.rows("/api/trips/trip/routes")[0].geometry).toEqual(line.geometry);
  expect(JSON.parse(input.value)).toEqual(points.slice(0, -1));
  fireEvent.click(screen.getByRole("button", { name: "Save route" }));
  await waitFor(() => expect(api.count("PATCH /api/trips/trip/routes/local")).toBe(2));
  expect(api.lastBody("PATCH /api/trips/trip/routes/local")).toMatchObject({
    geometry: { type: "LineString", coordinates: points.slice(0, -1) },
  });
});

it("keeps a line on failed flight suggestion and discards a successful suggestion without saving", async () => {
  seed([route("local", "Local flight", { mode: "flight", geometry: line.geometry })]);
  renderWithOwner(<RouteManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Route Local flight bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.click(screen.getByText("Geavanceerd: coördinaten als JSON plakken"));
  const input = screen.getByLabelText("Lijncoördinaten (JSON) (optioneel)") as HTMLTextAreaElement;
  chooseOption("Aankomst", "Taipei (heel gebied)");
  fireEvent.click(screen.getByRole("button", { name: "Vluchtlijn voorstellen" }));
  expect(screen.getByText(/Er kon geen vluchtlijn/)).toBeTruthy();
  expect(input.value).toBe(JSON.stringify(line.geometry!.coordinates));
  chooseOption("Aankomst", "Tainan (heel gebied)");
  fireEvent.click(screen.getByRole("button", { name: "Vluchtlijn voorstellen" }));
  fireEvent.click(screen.getByRole("button", { name: "Route bewerken sluiten" }));
  fireEvent.click(await screen.findByRole("button", { name: "Wijzigingen verwerpen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.count("PATCH /api/trips/trip/routes/local")).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Route Local flight bekijken" }));
  expect(screen.getByText("2 algemene punten in deze route.")).toBeTruthy();
});
