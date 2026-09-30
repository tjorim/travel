// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { chooseOption, renderWithOwner, selectedOption, testToken } from "../query/test-utils";
import type { Area, Location, Stay, Trip } from "../tracker-model";
import { AreaManager } from "./AreaManager";
import { StayManager } from "./StayManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = {
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: "2054-11-16",
  ends_on: null,
  travel_updates: [],
};
const area: Area = {
  id: "area-1",
  visibility: "private",
  label: "Taipei",
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
  create: (body: Record<string, unknown>, count: number) => ({ id: `new-${count}`, area, ...body }),
};
const stay = (id: string, name: string): Stay => ({
  id,
  check_in_date: "2054-11-16",
  check_out_date: "2054-11-18",
  check_in_time: null,
  check_out_time: null,
  status: "booked",
  property_name: name,
  website_url: null,
  booking_reference: "ABC",
  contact_details: null,
  notes: null,
  location: {} as Stay["location"],
  area: area,
  visibility: "private",
  share_date_precision: "month",
});

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(api.unexpected).toEqual([]);
});

const confirmDelete = () =>
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }));

it("opens an area in detail before its editor, prefilled", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/areas", [area])
    .collection("/api/trips/trip/locations", [])
    .collection("/api/trips/trip/stays", [], createdStay)
    .collection("/api/trips/trip/routes", [])
    .collection("/api/trips/trip/visits", [])
    .value("/api/trips/trip/public-projection", {
      trip_id: "trip",
      surface_state: "unpublished",
      scope: { items: [] },
      slug: null,
    })
    .value("/api/trips/trip/share-links", []);
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied Taipei bekijken" }));
  expect(screen.getByRole("heading", { name: "Taipei" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Gebied bewerken" })).toBeTruthy();
  expect((screen.getByLabelText("Naam") as HTMLInputElement).value).toBe("Taipei");
  expect((screen.getByLabelText("Breedtegraad (optioneel)") as HTMLInputElement).value).toBe("25.03");
});

it("lists what belongs to an area in its detail, so areas need no separate overview", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/areas", [area])
    .collection("/api/trips/trip/locations", [{ ...savedLocation, label: "Vliegveld" }])
    .collection("/api/trips/trip/stays", [], createdStay)
    .collection("/api/trips/trip/routes", [])
    .collection("/api/trips/trip/visits", [])
    .value("/api/trips/trip/public-projection", {
      trip_id: "trip",
      surface_state: "unpublished",
      scope: { items: [] },
      slug: null,
    })
    .value("/api/trips/trip/share-links", []);
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied Taipei bekijken" }));
  await screen.findAllByText(/Vliegveld/);
  expect(screen.getByText("Locaties")).toBeTruthy();
});

it("deletes an unused area", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/areas", [area])
    .collection("/api/trips/trip/locations", [])
    .collection("/api/trips/trip/stays", [], createdStay)
    .collection("/api/trips/trip/routes", [])
    .collection("/api/trips/trip/visits", [])
    .value("/api/trips/trip/public-projection", {
      trip_id: "trip",
      surface_state: "unpublished",
      scope: { items: [] },
      slug: null,
    })
    .value("/api/trips/trip/share-links", []);
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied Taipei bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Gebied Taipei bekijken" })).toBeNull());
  expect(screen.getByText("Gebied verwijderd.")).toBeTruthy();
  expect(api.count("DELETE /api/trips/trip/areas/area-1")).toBe(1);
});

it("shows an edited area at once and adds a new one to the list", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/areas", [area])
    .collection("/api/trips/trip/locations", [])
    .collection("/api/trips/trip/stays", [], createdStay)
    .collection("/api/trips/trip/routes", [])
    .collection("/api/trips/trip/visits", [])
    .value("/api/trips/trip/public-projection", {
      trip_id: "trip",
      surface_state: "unpublished",
      scope: { items: [] },
      slug: null,
    })
    .value("/api/trips/trip/share-links", []);
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied Taipei bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Nieuw-Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Gebied opslaan" }));
  await screen.findByRole("button", { name: "Gebied Nieuw-Taipei bekijken" });
  expect(screen.queryByRole("button", { name: "Gebied Taipei bekijken" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Gebied toevoegen" }));
  fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Tainan" } });
  fireEvent.change(screen.getByLabelText("Landcode (optioneel)"), { target: { value: "tw" } });
  fireEvent.click(screen.getByRole("button", { name: "Gebied opslaan" }));
  await screen.findByRole("button", { name: "Gebied Tainan bekijken" });
  expect(api.lastBody("POST /api/trips/trip/areas")).toMatchObject({
    label: "Tainan",
    country_code: "TW",
    latitude: null,
    longitude: null,
  });
});

it("asks for both area coordinates or neither", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/areas", [])
    .collection("/api/trips/trip/locations", [])
    .collection("/api/trips/trip/stays", [], createdStay)
    .collection("/api/trips/trip/routes", [])
    .collection("/api/trips/trip/visits", [])
    .value("/api/trips/trip/public-projection", {
      trip_id: "trip",
      surface_state: "unpublished",
      scope: { items: [] },
      slug: null,
    })
    .value("/api/trips/trip/share-links", []);
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied toevoegen" }));
  fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Taipei" } });
  fireEvent.change(screen.getByLabelText("Breedtegraad (optioneel)"), { target: { value: "25" } });
  fireEvent.click(screen.getByRole("button", { name: "Gebied opslaan" }));
  await screen.findByText("Vul beide kaartcoördinaten in of laat beide leeg.");
  expect(api.count("POST /api/trips/trip/areas")).toBe(0);
});

it("turns a place lookup into an editable, rounded area", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/areas", [])
    .collection("/api/trips/trip/locations", [])
    .collection("/api/trips/trip/stays", [], createdStay)
    .collection("/api/trips/trip/routes", [])
    .collection("/api/trips/trip/visits", [])
    .value("/api/trips/trip/public-projection", {
      trip_id: "trip",
      surface_state: "unpublished",
      scope: { items: [] },
      slug: null,
    })
    .value("/api/trips/trip/share-links", []);
  api.on("POST", /\/places\/search$/, () => ({
    attribution: "© OpenStreetMap contributors",
    attribution_url: "https://www.openstreetmap.org/copyright",
    results: [
      {
        osm_element_type: "relation",
        osm_element_id: "123",
        display_name: "Taipei, Exampleland",
        locality: "Taipei",
        admin_area: "Taipei City",
        country_code: "TW",
        latitude: 25.033964,
        longitude: 121.564468,
      },
    ],
  }));
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied toevoegen" }));
  fireEvent.change(screen.getByLabelText("Zoek stad of regio"), { target: { value: "Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Taipei, Exampleland" }));
  expect((screen.getByLabelText("Naam") as HTMLInputElement).value).toBe("Taipei");
  expect((screen.getByLabelText("Regio (optioneel)") as HTMLInputElement).value).toBe("Taipei City");
  expect((screen.getByLabelText("Breedtegraad (optioneel)") as HTMLInputElement).value).toBe("25.03");
  expect((screen.getByLabelText("Lengtegraad (optioneel)") as HTMLInputElement).value).toBe("121.56");
});

it("keeps an exact looked-up stay place private until the stay is saved", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", [], createdStay).collection("/api/trips/trip/locations", []);
  api.on("POST", /\/places\/search$/, () => ({
    attribution: "© OpenStreetMap contributors",
    attribution_url: "https://www.openstreetmap.org/copyright",
    results: [
      {
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
  renderWithOwner(<StayManager trip={trip} areas={[area]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw verblijf" }));
  fireEvent.change(screen.getByLabelText("Zoek verblijf of adres"), { target: { value: "Hotel Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Hotel Taipei" }));
  expect((screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)") as HTMLInputElement).value).toBe(
    "Hotel Taipei",
  );
  expect((screen.getByLabelText("Adres (optioneel)") as HTMLInputElement).value).toBe("1 Example Road");
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
    .collection("/api/trips/trip/stays", [], createdStay)
    .collection("/api/trips/trip/locations", [savedLocation]);
  api.on("GET", /\/locations\?q=Brussels&limit=50$/, () => [savedLocation]);
  renderWithOwner(<StayManager trip={trip} areas={[area]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw verblijf" }));
  fireEvent.change(await screen.findByLabelText("Gebruik een bestaande locatie"), { target: { value: "Brussels" } });
  fireEvent.click(await screen.findByRole("option", { name: "Brussels Airport · Zaventem" }));
  expect(api.count("GET /api/trips/trip/locations?q=Brussels&limit=50")).toBe(1);
  expect((screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)") as HTMLInputElement).value).toBe(
    "Brussels Airport",
  );
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody<{ location: unknown }>("POST /api/trips/trip/stays")?.location).toEqual({
    existing_location_id: "bru",
  });
});

it("keeps a stay's saved location when a hotel detail is corrected", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/stays", [{ ...stay("s1", "Airport hotel"), location: savedLocation }])
    .collection("/api/trips/trip/locations", [savedLocation]);
  renderWithOwner(<StayManager trip={trip} areas={[area]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Airport hotel/ }));
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
    .collection("/api/trips/trip/stays", [stay("s1", "Hotel")])
    .collection("/api/trips/trip/locations", []);
  renderWithOwner(<StayManager trip={trip} areas={[area]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Hotel/ }));
  expect(screen.getByText("Boekingsreferentie: ABC")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Verblijf bewerken" })).toBeTruthy();
  expect((screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)") as HTMLInputElement).value).toBe("Hotel");
  expect((screen.getByLabelText("Eerste nacht (inchecken)") as HTMLInputElement).value).toBe("2054-11-16");
  expect((screen.getByLabelText("Boekingsreferentie (optioneel)") as HTMLInputElement).value).toBe("ABC");
});

it("shows an edited stay and removes a deleted one without a reload", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/stays", [stay("s1", "Hotel"), stay("s2", "Hostel")])
    .collection("/api/trips/trip/locations", []);
  renderWithOwner(<StayManager trip={trip} areas={[area]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Hotel/ }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Accommodatie (leeg zolang je nog kiest)"), {
    target: { value: "Hotel Royal" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await screen.findByRole("button", { name: /Hotel Royal/ });
  expect(screen.queryByRole("button", { name: /^Hotel · / })).toBeNull();
  expect(screen.getByText("Privéverblijf opgeslagen.")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /Hostel/ }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("button", { name: /Hostel/ })).toBeNull());
  expect(screen.getByRole("button", { name: /Hotel Royal/ })).toBeTruthy();
  expect(api.count("DELETE /api/trips/trip/stays/s2")).toBe(1);
});

it("rewrites a stay's place only when a place field changed", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/stays", [stay("s1", "Hotel")])
    .collection("/api/trips/trip/locations", []);
  renderWithOwner(<StayManager trip={trip} areas={[area]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Hotel/ }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Notities (optioneel)"), { target: { value: "Late check-in" } });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.lastBody("PATCH /api/trips/trip/stays/s1")).toMatchObject({ notes: "Late check-in" });
  expect(api.lastBody("PATCH /api/trips/trip/stays/s1")).not.toHaveProperty("place");
});

it("keeps check-out after check-in and moves it along with the first night", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", [], createdStay).collection("/api/trips/trip/locations", []);
  renderWithOwner(<StayManager trip={trip} areas={[]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw verblijf" }));
  fireEvent.change(screen.getByLabelText("Eerste nacht (inchecken)"), { target: { value: "2054-11-20" } });
  await waitFor(() =>
    expect((screen.getByLabelText("Uitchecken (ochtend)") as HTMLInputElement).value).toBe("2054-11-21"),
  );
  fireEvent.change(screen.getByLabelText("Uitchecken (ochtend)"), { target: { value: "2054-11-19" } });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await screen.findByText("Uitchecken gebeurt ten vroegste de ochtend na de eerste nacht.");
  expect(api.count("POST /api/trips/trip/stays")).toBe(0);
});

it("sets who sees a stay from its own detail, with the same control as everywhere", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/stays", [stay("s1", "Hotel")])
    .collection("/api/trips/trip/locations", []);
  api.on("PUT", /\/visibility\/stay\/s1$/, (body) => body);
  renderWithOwner(<StayManager trip={trip} areas={[area]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Hotel/ }));
  expect(selectedOption("Zichtbaarheid van Hotel")).toBe("Privé — alleen ik");
  chooseOption("Zichtbaarheid van Hotel", "Iedereen — alle bezoekers");
  await waitFor(() =>
    expect(api.lastBody("PUT /api/trips/trip/visibility/stay/s1")).toEqual({ visibility: "everyone" }),
  );
});

it("lets the owner choose how precisely visitors see a stay's nights", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", [], createdStay).collection("/api/trips/trip/locations", []);
  renderWithOwner(<StayManager trip={trip} areas={[area]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw verblijf" }));
  expect(selectedOption("Datums voor bezoekers")).toBe("Alleen maanden");
  chooseOption("Datums voor bezoekers", "Volledige datums");
  fireEvent.change(screen.getByLabelText("Plaats (optioneel)"), { target: { value: "Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/stays")).toMatchObject({ share_date_precision: "day" }),
  );
});

it("refuses a stay without a location, but accepts a city on its own", async () => {
  api = fakeApi().collection("/api/trips/trip/stays", [], createdStay).collection("/api/trips/trip/locations", []);
  renderWithOwner(<StayManager trip={trip} areas={[area]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw verblijf" }));
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await screen.findByText("Kies waar je verblijft: zoek een locatie, of vul een adres of plaats in.");
  // The message belongs to the Plaats field, which takes focus, rather than a banner at the foot of the form.
  expect(screen.getByLabelText("Plaats (optioneel)").getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(screen.getByLabelText("Plaats (optioneel)"));
  expect(api.count("POST /api/trips/trip/stays")).toBe(0);

  fireEvent.change(screen.getByLabelText("Plaats (optioneel)"), { target: { value: "Alishan" } });
  fireEvent.click(screen.getByRole("button", { name: "Verblijf toevoegen" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/stays")).toMatchObject({ location: { locality: "Alishan" } }),
  );
});

it("warns, without blocking, when a stay's nights overlap another stay", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/stays", [stay("s1", "Hotel")], createdStay)
    .collection("/api/trips/trip/locations", []);
  renderWithOwner(<StayManager trip={trip} areas={[area]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw verblijf" }));
  expect(screen.getByText(/Deze nachten overlappen met Hotel/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Eerste nacht (inchecken)"), { target: { value: "2054-11-18" } });
  await waitFor(() => expect(screen.queryByText(/Deze nachten overlappen/)).toBeNull());
});

it("names the location a stay is already linked to when editing it", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/stays", [{ ...stay("s1", "Hotel"), location: savedLocation }])
    .collection("/api/trips/trip/locations", []);
  renderWithOwner(<StayManager trip={trip} areas={[area]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Hotel/ }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByText(/Gekoppelde locatie: Brussels Airport · Zaventem/)).toBeTruthy();
});

it("reports a refused area delete inside the dialog, where the owner is looking", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/areas", [area])
    .collection("/api/trips/trip/locations", [])
    .collection("/api/trips/trip/stays", [], createdStay)
    .collection("/api/trips/trip/routes", [])
    .collection("/api/trips/trip/visits", [])
    .value("/api/trips/trip/public-projection", {
      trip_id: "trip",
      surface_state: "unpublished",
      scope: { items: [] },
      slug: null,
    })
    .value("/api/trips/trip/share-links", []);
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied Taipei bekijken" }));
  api.failNext = {
    status: 409,
    body: {
      detail: "dependency diagnostic",
      errors: [{ code: "resource_in_use", path: [], params: { count: 2, visits: 2 } }],
    },
  };
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  confirmDelete();
  const reason = await screen.findByText(/wordt nog gebruikt door 2 onderdelen/);
  expect(reason.getAttribute("role")).toBe("alert");
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect((await screen.findByRole("dialog")).contains(reason)).toBe(true);
});
