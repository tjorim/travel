import { responseFixtures } from "@/mocks/response-test-fixtures";
import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../../query/fake-api";
import {
  chooseOption,
  openAdvanced,
  renderWithOwner,
  selectedOption,
  testToken,
} from "../../query/test-utils";
import type { Area, DocumentAsset, Location, Stay, Trip } from "../../api-types";
import {
  agendaRow,
  ensurePlanApi,
  getAgendaRow,
  PlanHarness,
  queryAgendaRow,
  startNew,
} from "../plan-test-utils";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = {
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
  starts_on: "2054-11-16",
  ends_on: null,
  travel_updates: [],
};
const area: Area = {
  id: "area-1",
  visibility: "private",
  label: "Taipei",
  label_nl: "Taipei",
  label_en: null,
  local_name: null,
  country_code: "TW",
  region: "Taipei City",
  latitude: 25.03,
  longitude: 121.56,
  timezone: "Asia/Taipei",
};
const savedLocation = {
  id: "bru",
  visibility: "private",
  label: null,
  area_id: "area-1",
  share_address: false,
  display_name: "Brussels Airport",
  address_line1: "Leopoldlaan",
  locality: "Zaventem",
  country_code: "BE",
} as Location;
// A created stay comes back with the area its location was filed under.
const createdStay = {
  create: (body: Record<string, unknown>, count: number) => ({
    ...responseFixtures.StayResponse,
    id: `new-${count}`,
    area,
    ...body,
  }),
};
const stay = (id: string, name: string): Stay => ({
  notes_html: null,
  contact_details_html: null,
  id,
  check_in_date: "2054-11-16",
  check_out_date: "2054-11-18",
  check_in_time: null,
  check_out_time: null,
  status: "confirmed",
  property_name: name,
  website_url: null,
  booking_reference: "ABC",
  contact_details: null,
  notes: null,
  location: null,
  area: area,
  visibility: "private",
  share_date_precision: "month",
  document_asset_ids: [],
});
const ticket = { id: "d1", title: "Hotelbevestiging" } as DocumentAsset;

let api: FakeApi;
/** The agenda with the plan's dialogs, over the records a test seeded. */
const renderPlan = () => {
  ensurePlanApi(api);
  return renderWithOwner(<PlanHarness trip={trip} />);
};
beforeEach(() => {
  auth.session = { accessToken: testToken() };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(api.unexpected).toEqual([]);
});

/** Opens the stay editor's area choice and picks an area, waiting for the areas to load. */
async function chooseArea(name: string) {
  fireEvent.keyDown(await screen.findByRole("combobox", { name: "Gebied" }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name }));
}

const confirmDelete = () =>
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );

it("keeps an exact looked-up stay place private until the stay is saved", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  api.on<Api.PlaceSearchResponse>("POST", /\/places\/search$/, () => ({
    provider: "synthetic",
    attribution: "© OpenStreetMap contributors",
    attribution_url: "https://www.openstreetmap.org/copyright",
    results: [
      {
        address_line2: null,
        admin_area: null,
        postal_code: null,
        local_name: null,
        name_nl: null,
        name_en: null,
        viewport_north: null,
        viewport_south: null,
        viewport_east: null,
        viewport_west: null,
        osm_element_type: "node",
        osm_element_id: "42",
        display_name: "Hotel Taipei",
        address_line1: "1 Example Road",
        locality: "Taipei",
        country_code: "TW",
        latitude: 25.034,
        longitude: 121.565,
      },
    ],
  }));
  renderPlan();
  await startNew("Nieuw verblijf");
  fireEvent.change(screen.getByLabelText("Zoek verblijf of adres"), {
    target: { value: "Hotel Taipei" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Hotel Taipei" }));
  expect(
    (screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)") as HTMLInputElement).value,
  ).toBe("Hotel Taipei");
  expect((screen.getByLabelText("Adres (optioneel)") as HTMLInputElement).value).toBe(
    "1 Example Road",
  );
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("POST /api/trips/trip/stays")).toMatchObject({
    location: {
      osm_element_type: "node",
      osm_element_id: "42",
      latitude: 25.034,
      longitude: 121.565,
      locality: "Taipei",
    },
  });
});

it("reuses a saved location for a new stay instead of copying its address", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [savedLocation]);
  api.on<Api.LocationResponse[]>("GET", /\/locations\?q=Brussels&limit=50$/, () => [savedLocation]);
  renderPlan();
  await startNew("Nieuw verblijf");
  fireEvent.change(await screen.findByLabelText("Gebruik een bestaande locatie"), {
    target: { value: "Brussels" },
  });
  fireEvent.click(await screen.findByRole("option", { name: "Brussels Airport · Zaventem" }));
  expect(api.count("GET /api/trips/trip/locations?q=Brussels&limit=50")).toBe(1);
  expect(
    (screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)") as HTMLInputElement).value,
  ).toBe("Brussels Airport");
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody<{ location: unknown }>("POST /api/trips/trip/stays")?.location).toEqual({
    existing_location_id: "bru",
  });
});

it("keeps a stay's saved location when a hotel detail is corrected", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [
      { ...stay("s1", "Airport hotel"), location: savedLocation },
    ])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [savedLocation]);
  renderPlan();
  fireEvent.click(await agendaRow("Verblijf: Airport hotel"));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)"), {
    target: { value: "Airport hotel Brussels" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody<{ location: unknown }>("PATCH /api/trips/trip/stays/s1")?.location).toEqual({
    existing_location_id: "bru",
  });
});

it("opens a stay in private detail before editing, prefilled", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [stay("s1", "Hotel")])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  fireEvent.click(await agendaRow("Verblijf: Hotel"));
  expect(screen.getByText("Boekingsreferentie: ABC")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Verblijf bewerken" })).toBeTruthy();
  expect(
    (screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)") as HTMLInputElement).value,
  ).toBe("Hotel");
  expect((screen.getByLabelText("Eerste nacht (inchecken)") as HTMLInputElement).value).toBe(
    "16 nov 2054",
  );
  expect((screen.getByLabelText("Boekingsreferentie (optioneel)") as HTMLInputElement).value).toBe(
    "ABC",
  );
});

it("shows an edited stay and removes a deleted one without a reload", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [
      stay("s1", "Hotel"),
      stay("s2", "Hostel"),
    ])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  fireEvent.click(await agendaRow("Verblijf: Hotel"));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)"), {
    target: { value: "Hotel Royal" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await agendaRow("Verblijf: Hotel Royal");
  expect(queryAgendaRow("Verblijf: Hotel Taipei")).toBeNull();
  expect(screen.getByText("Privéverblijf opgeslagen.")).toBeTruthy();

  fireEvent.click(getAgendaRow("Verblijf: Hostel"));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  confirmDelete();
  await waitFor(() => expect(queryAgendaRow("Verblijf: Hostel")).toBeNull());
  expect(await agendaRow("Verblijf: Hotel Royal")).toBeTruthy();
  expect(api.count("DELETE /api/trips/trip/stays/s2")).toBe(1);
});

it("lists a stored group of ideas as alternatives, never groups ideas by itself, and keeps them off the share controls", async () => {
  const idea = (id: string, name: string): Stay => ({
    ...stay(id, name),
    status: "idea",
    booking_reference: null,
  });
  const ideas = [idea("i1", "Hotel A"), idea("i2", "Hotel B")];
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [...ideas, stay("s1", "Hotel C")])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [])
    .collection<Api.AlternativeGroupResponse>("/api/trips/trip/alternative-groups", [
      {
        id: "g1",
        kind: "stay",
        label: null,
        chosen_id: null,
        members: ideas.map((item) => ({
          record_id: item.id,
          chosen: false,
          stay: item,
          visit: null,
          route: null,
        })),
        created_at: "2054-01-01T00:00:00Z",
        updated_at: "2054-01-01T00:00:00Z",
      },
    ]);
  renderPlan();
  const group = await screen.findByRole("group", { name: "Alternatieven · 16 nov → 18 nov" });
  expect(within(group).getByRole("button", { name: /^Hotel A/ }).textContent).toContain("Idee");
  expect(within(group).getByRole("button", { name: /^Hotel B/ })).toBeTruthy();
  expect(within(group).queryByRole("button", { name: /Hotel C/ })).toBeNull();
  // Only the stored group is a group: the same ideas in the list are not grouped again.
  expect(screen.getAllByRole("group", { name: /^Alternatieven/ })).toHaveLength(1);

  fireEvent.click(within(group).getByRole("button", { name: /^Hotel A/ }));
  expect(screen.getByText(/Een idee is een kandidaat/)).toBeTruthy();
  expect(screen.queryByText("Wie mag dit zien?")).toBeNull();
});

it("offers to cancel the rejected ideas once a stay for the same nights is chosen", async () => {
  const idea = (id: string, name: string): Stay => ({ ...stay(id, name), status: "idea" });
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [
      idea("i1", "Hotel A"),
      idea("i2", "Hotel B"),
      stay("s1", "Hotel C"),
    ])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  fireEvent.click(await agendaRow("Verblijf: Hotel C"));
  expect(screen.getByText("2 ideeën overlappen deze nachten.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Annuleer 2 alternatieven" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/stays/i1")).toEqual({ status: "cancelled" });
  expect(api.lastBody("PATCH /api/trips/trip/stays/i2")).toEqual({ status: "cancelled" });
  expect(screen.getByText("Alternatieven geannuleerd.")).toBeTruthy();
  // A candidate is not offered the cancel action for its own rivals.
  fireEvent.click(getAgendaRow("Verblijf: Hotel C"));
  expect(screen.queryByRole("button", { name: /Annuleer/ })).toBeNull();
});

it("creates a stay idea without warning about overlapping stays", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [stay("s1", "Hotel")], createdStay)
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  await startNew("Nieuw verblijf");
  expect(screen.getByText(/Deze nachten overlappen met/)).toBeTruthy();
  chooseOption("Status", "Idee");
  expect(await screen.findByText(/Een idee is een kandidaat/)).toBeTruthy();
  expect(screen.queryByText(/Deze nachten overlappen met/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)"), {
    target: { value: "Hotel Alt" },
  });
  await chooseArea("Taipei");
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("POST /api/trips/trip/stays")).toMatchObject({
    status: "idea",
    property_name: "Hotel Alt",
  });
});

it("rewrites a stay's place only when a place field changed", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [stay("s1", "Hotel")])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  fireEvent.click(await agendaRow("Verblijf: Hotel"));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Notities (optioneel)"), {
    target: { value: "Late check-in" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/stays/s1")).toMatchObject({ notes: "Late check-in" });
  expect(api.lastBody("PATCH /api/trips/trip/stays/s1")).not.toHaveProperty("place");
});

it("keeps check-out after check-in and moves it along with the first night", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  await startNew("Nieuw verblijf");
  fireEvent.change(screen.getByLabelText("Eerste nacht (inchecken)"), {
    target: { value: "2054-11-20" },
  });
  await waitFor(() =>
    expect((screen.getByLabelText("Uitchecken (ochtend)") as HTMLInputElement).value).toBe(
      "21 nov 2054",
    ),
  );
  fireEvent.change(screen.getByLabelText("Uitchecken (ochtend)"), {
    target: { value: "2054-11-19" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await screen.findByText("Uitchecken gebeurt ten vroegste de ochtend na de eerste nacht.");
  expect(api.count("POST /api/trips/trip/stays")).toBe(0);
});

it("sets who sees a stay from its own detail, with the same control as everywhere", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [stay("s1", "Hotel")])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  api.on<Api.VisibilityUpdate>(
    "PUT",
    /\/visibility\/stay\/s1$/,
    (body) => body as Api.VisibilityUpdate,
  );
  renderPlan();
  fireEvent.click(await agendaRow("Verblijf: Hotel"));
  expect(selectedOption("Zichtbaarheid van Hotel")).toBe("Privé — alleen ik");
  chooseOption("Zichtbaarheid van Hotel", "Iedereen — alle bezoekers");
  await waitFor(() =>
    expect(api.lastBody("PUT /api/trips/trip/visibility/stay/s1")).toEqual({
      visibility: "everyone",
    }),
  );
});

it("lets the owner choose how precisely visitors see a stay's nights", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  await startNew("Nieuw verblijf");
  // A new stay follows the audience, which also limits its dates; the coarser choice applies.
  openAdvanced();
  expect(selectedOption("Datums voor bezoekers")).toBe("Zoals het publiek");
  chooseOption("Datums voor bezoekers", "Volledige datums");
  await chooseArea("Taipei");
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/stays")).toMatchObject({
      share_date_precision: "day",
    }),
  );
});

it("lets a stay follow the audience's date precision, sending null", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  await startNew("Nieuw verblijf");
  expect(
    within(screen.getByRole("dialog")).getByText(/elk publiek beperkt zijn datums/i),
  ).toBeTruthy();
  await chooseArea("Taipei");
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/stays")).toMatchObject({
      share_date_precision: null,
    }),
  );
});

it("refuses a stay with neither an area nor an accommodation, then files it under its area alone", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  await startNew("Nieuw verblijf");
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await screen.findByText("Kies het gebied van dit verblijf, of zoek de accommodatie.");
  expect(api.count("POST /api/trips/trip/stays")).toBe(0);

  // Only the area is chosen: no location is sent, so none is created.
  await chooseArea("Taipei");
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const body = api.lastBody<Record<string, unknown>>("POST /api/trips/trip/stays");
  expect(body).toMatchObject({ area_id: "area-1", location: null });
  expect(getAgendaRow("Verblijf: Nog te kiezen in Taipei")).toBeTruthy();
});

it("accepts a typed address without choosing an area, deriving the area from its city", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  await startNew("Nieuw verblijf");
  fireEvent.change(screen.getByLabelText("Adres (optioneel)"), {
    target: { value: "1 Alishan Road" },
  });
  fireEvent.change(screen.getByLabelText("Plaats (optioneel)"), { target: { value: "Alishan" } });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/stays")).toMatchObject({
      location: { address_line1: "1 Alishan Road", locality: "Alishan" },
    }),
  );
  expect(api.lastBody("POST /api/trips/trip/stays")).not.toHaveProperty("area_id");
});

it("chooses the accommodation later and can go back to not having one", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [
      { ...stay("s1", "Hotel"), property_name: null },
    ])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [savedLocation]);
  api.on<Api.LocationResponse[]>("GET", /\/locations\?q=Brussels&limit=50$/, () => [savedLocation]);
  renderPlan();
  fireEvent.click(await agendaRow("Verblijf: Nog te kiezen in Taipei"));
  expect(screen.getByText("Accommodatie nog niet gekozen · Taipei")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  await waitFor(() => expect(selectedOption("Gebied")).toBe("Taipei"));
  expect(screen.queryByRole("button", { name: "Accommodatie loskoppelen" })).toBeNull();

  // A saved location is chosen: it settles the area, which then follows it and cannot be edited apart.
  fireEvent.change(await screen.findByLabelText("Gebruik een bestaande locatie"), {
    target: { value: "Brussels" },
  });
  fireEvent.click(await screen.findByRole("option", { name: "Brussels Airport · Zaventem" }));
  expect(screen.getByText("Het gebied volgt de gekozen accommodatie.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/stays/s1")).toMatchObject({
    location: { existing_location_id: "bru" },
  });
});

it("adds an exact location to an area-only stay by searching for its property name", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [stay("s1", "Hotel Idea")])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  api.on<Api.PlaceSearchResponse>("POST", /\/places\/search$/, () => ({
    provider: "synthetic",
    attribution: "© OpenStreetMap contributors",
    attribution_url: "https://www.openstreetmap.org/copyright",
    results: [
      {
        address_line2: null,
        admin_area: null,
        postal_code: null,
        local_name: null,
        name_nl: null,
        name_en: null,
        viewport_north: null,
        viewport_south: null,
        viewport_east: null,
        viewport_west: null,
        osm_element_type: "node",
        osm_element_id: "7",
        display_name: "Hotel Idea",
        address_line1: "1 Example Road",
        locality: "Taipei",
        country_code: "TW",
        latitude: 25.047,
        longitude: 121.51,
      },
    ],
  }));
  renderPlan();
  // A confirmed stay does not read as undecided just because no location is linked.
  expect(await agendaRow("Verblijf: Hotel Idea")).toBeTruthy();
  expect(screen.queryByText(/Locatie nog niet gekoppeld/)).toBeNull();
  fireEvent.click(getAgendaRow("Verblijf: Hotel Idea"));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.click(screen.getByRole("button", { name: "Zoek “Hotel Idea”" }));
  const result = await screen.findByRole("button", { name: /^Hotel Idea$/ });
  expect(api.lastBody("POST /api/trips/trip/places/search")).toEqual({ query: "Hotel Idea" });
  fireEvent.click(result);
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/stays/s1")).toMatchObject({
    location: { osm_element_id: "7", latitude: 25.047, longitude: 121.51, area_id: "area-1" },
  });
});

it("returns a stay with an accommodation to its area alone", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [
      { ...stay("s1", "Airport hotel"), location: savedLocation },
    ])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [savedLocation]);
  renderPlan();
  fireEvent.click(await agendaRow("Verblijf: Airport hotel"));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.click(screen.getByRole("button", { name: "Accommodatie loskoppelen" }));
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/stays/s1")).toMatchObject({
    area_id: "area-1",
    location: null,
  });
});

it("warns, without blocking, when a stay's nights overlap another stay", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [stay("s1", "Hotel")], createdStay)
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  await startNew("Nieuw verblijf");
  expect(screen.getByText(/Deze nachten overlappen met Hotel/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Eerste nacht (inchecken)"), {
    target: { value: "2054-11-18" },
  });
  await waitFor(() => expect(screen.queryByText(/Deze nachten overlappen/)).toBeNull());
});

it("names the location a stay is already linked to when editing it", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [
      { ...stay("s1", "Hotel"), location: savedLocation },
    ])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  fireEvent.click(await agendaRow("Verblijf: Hotel"));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByText(/Gekoppelde locatie: Brussels Airport · Zaventem/)).toBeTruthy();
});

it("links a hotel confirmation to a stay, shows it in the detail and detaches it again", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [stay("s1", "Hotel")], {
      update: (row, body) => ({ ...row, ...body }),
    })
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  fireEvent.click(await agendaRow("Verblijf: Hotel"));
  expect(screen.queryByText("Gekoppelde documenten")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  // Nothing is linked yet: the picker is the same list of checkboxes a route has.
  const confirmation = await screen.findByRole("checkbox", { name: "Hotelbevestiging" });
  expect(confirmation.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(confirmation);
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/stays/s1")).toMatchObject({
    document_asset_ids: ["d1"],
  });
  // The place is not rewritten by an attachment alone.
  expect(api.lastBody("PATCH /api/trips/trip/stays/s1")).not.toHaveProperty("location");

  fireEvent.click(await agendaRow("Verblijf: Hotel"));
  expect(await screen.findByText("Gekoppelde documenten")).toBeTruthy();
  expect(screen.getByText("Hotelbevestiging")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Hotelbevestiging" }));
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/stays/s1")).toMatchObject({ document_asset_ids: [] });
});

it("sends the documents chosen for a new stay", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  await startNew("Nieuw verblijf");
  await chooseArea("Taipei");
  fireEvent.click(await screen.findByRole("checkbox", { name: "Hotelbevestiging" }));
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() => expect(api.count("POST /api/trips/trip/stays")).toBe(1));
  expect(api.lastBody("POST /api/trips/trip/stays")).toMatchObject({ document_asset_ids: ["d1"] });
});

it("offers no document picker for a stay when the trip has no document", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [stay("s1", "Hotel")])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", []);
  renderPlan();
  fireEvent.click(await agendaRow("Verblijf: Hotel"));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  await screen.findByRole("heading", { name: "Verblijf bewerken" });
  expect(screen.queryByText("Gekoppelde documenten")).toBeNull();
});
