import { responseFixtures } from "@/mocks/response-test-fixtures";
import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { Area, DocumentAsset, Location, Trip } from "../api-types";
import { AreaManager } from "./AreaManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("@/app/providers/auth-context", () => ({ useAuth: () => auth }));

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
const ticket = { id: "d1", title: "Hotelbevestiging" } as DocumentAsset;

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
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );

it("opens an area in detail before its editor, prefilled", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.RouteResponse>("/api/trips/trip/routes", [])
    .collection<Api.VisitResponse>("/api/trips/trip/visits", [])
    .value<Api.PublicProjectionStatusResponse>("/api/trips/trip/public-projection", {
      revision: 0,
      applied_preset: null,
      applied_preset_at: null,
      preset_exceptions: null,
      trip_id: "trip",
      surface_state: "unpublished",
      scope: {
        schema_version: "travel/share-scope@1",
        trip: { title: true, summary: true, dates: null },
        items: [],
      },
      slug: null,
    })
    .value<Api.ShareLinkResponse[]>("/api/trips/trip/share-links", []);
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied Taipei bekijken" }));
  expect(screen.getByRole("heading", { name: "Taipei" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Gebied bewerken" })).toBeTruthy();
  expect((screen.getByLabelText("Naam") as HTMLInputElement).value).toBe("Taipei");
  expect((screen.getByLabelText("Breedtegraad (optioneel)") as HTMLInputElement).value).toBe(
    "25.03",
  );
});

it("lists what belongs to an area in its detail, so areas need no separate overview", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [
      { ...savedLocation, label: "Vliegveld" },
    ])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.RouteResponse>("/api/trips/trip/routes", [])
    .collection<Api.VisitResponse>("/api/trips/trip/visits", [])
    .value<Api.PublicProjectionStatusResponse>("/api/trips/trip/public-projection", {
      revision: 0,
      applied_preset: null,
      applied_preset_at: null,
      preset_exceptions: null,
      trip_id: "trip",
      surface_state: "unpublished",
      scope: {
        schema_version: "travel/share-scope@1",
        trip: { title: true, summary: true, dates: null },
        items: [],
      },
      slug: null,
    })
    .value<Api.ShareLinkResponse[]>("/api/trips/trip/share-links", []);
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied Taipei bekijken" }));
  await screen.findAllByText(/Vliegveld/);
  expect(screen.getByText("Locaties")).toBeTruthy();
});

it("deletes an unused area", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.RouteResponse>("/api/trips/trip/routes", [])
    .collection<Api.VisitResponse>("/api/trips/trip/visits", [])
    .value<Api.PublicProjectionStatusResponse>("/api/trips/trip/public-projection", {
      revision: 0,
      applied_preset: null,
      applied_preset_at: null,
      preset_exceptions: null,
      trip_id: "trip",
      surface_state: "unpublished",
      scope: {
        schema_version: "travel/share-scope@1",
        trip: { title: true, summary: true, dates: null },
        items: [],
      },
      slug: null,
    })
    .value<Api.ShareLinkResponse[]>("/api/trips/trip/share-links", []);
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied Taipei bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  confirmDelete();
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Gebied Taipei bekijken" })).toBeNull(),
  );
  expect(await screen.findByText("Gebied verwijderd.")).toBeTruthy();
  expect(api.count("DELETE /api/trips/trip/areas/area-1")).toBe(1);
});

it("shows an edited area at once and adds a new one to the list", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.RouteResponse>("/api/trips/trip/routes", [])
    .collection<Api.VisitResponse>("/api/trips/trip/visits", [])
    .value<Api.PublicProjectionStatusResponse>("/api/trips/trip/public-projection", {
      revision: 0,
      applied_preset: null,
      applied_preset_at: null,
      preset_exceptions: null,
      trip_id: "trip",
      surface_state: "unpublished",
      scope: {
        schema_version: "travel/share-scope@1",
        trip: { title: true, summary: true, dates: null },
        items: [],
      },
      slug: null,
    })
    .value<Api.ShareLinkResponse[]>("/api/trips/trip/share-links", []);
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
    label_nl: "Tainan",
    label_en: null,
    country_code: "TW",
    latitude: null,
    longitude: null,
  });
});

it("asks for both area coordinates or neither", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.RouteResponse>("/api/trips/trip/routes", [])
    .collection<Api.VisitResponse>("/api/trips/trip/visits", [])
    .value<Api.PublicProjectionStatusResponse>("/api/trips/trip/public-projection", {
      revision: 0,
      applied_preset: null,
      applied_preset_at: null,
      preset_exceptions: null,
      trip_id: "trip",
      surface_state: "unpublished",
      scope: {
        schema_version: "travel/share-scope@1",
        trip: { title: true, summary: true, dates: null },
        items: [],
      },
      slug: null,
    })
    .value<Api.ShareLinkResponse[]>("/api/trips/trip/share-links", []);
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
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.RouteResponse>("/api/trips/trip/routes", [])
    .collection<Api.VisitResponse>("/api/trips/trip/visits", [])
    .value<Api.PublicProjectionStatusResponse>("/api/trips/trip/public-projection", {
      revision: 0,
      applied_preset: null,
      applied_preset_at: null,
      preset_exceptions: null,
      trip_id: "trip",
      surface_state: "unpublished",
      scope: {
        schema_version: "travel/share-scope@1",
        trip: { title: true, summary: true, dates: null },
        items: [],
      },
      slug: null,
    })
    .value<Api.ShareLinkResponse[]>("/api/trips/trip/share-links", []);
  api.on<Api.PlaceSearchResponse>("POST", /\/places\/search$/, () => ({
    provider: "synthetic",
    attribution: "© OpenStreetMap contributors",
    attribution_url: "https://www.openstreetmap.org/copyright",
    results: [
      {
        address_line1: null,
        address_line2: null,
        postal_code: null,
        local_name: null,
        name_nl: null,
        name_en: null,
        viewport_north: null,
        viewport_south: null,
        viewport_east: null,
        viewport_west: null,
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
  expect((screen.getByLabelText("Regio (optioneel)") as HTMLInputElement).value).toBe(
    "Taipei City",
  );
  expect((screen.getByLabelText("Breedtegraad (optioneel)") as HTMLInputElement).value).toBe(
    "25.03",
  );
  expect((screen.getByLabelText("Lengtegraad (optioneel)") as HTMLInputElement).value).toBe(
    "121.56",
  );
});

const emptyApi = () =>
  fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.RouteResponse>("/api/trips/trip/routes", [])
    .collection<Api.VisitResponse>("/api/trips/trip/visits", [])
    .value<Api.PublicProjectionStatusResponse>("/api/trips/trip/public-projection", {
      revision: 0,
      applied_preset: null,
      applied_preset_at: null,
      preset_exceptions: null,
      trip_id: "trip",
      surface_state: "unpublished",
      scope: {
        schema_version: "travel/share-scope@1",
        trip: { title: true, summary: true, dates: null },
        items: [],
      },
      slug: null,
    })
    .value<Api.ShareLinkResponse[]>("/api/trips/trip/share-links", []);

const searchResult: Api.PlaceSearchResult = {
  ...responseFixtures.PlaceSearchResult,
  osm_element_type: "relation",
  osm_element_id: "123",
  display_name: "Taipei, Taiwan",
  locality: "Taipei",
  admin_area: "Taipei City",
  country_code: "TW",
  latitude: 25.033964,
  longitude: 121.564468,
  local_name: "臺北市",
  name_nl: "Taipeh",
  name_en: "Taipei City",
};

it("shows the local name beside a search result and offers its names without saving them", async () => {
  api = emptyApi();
  api.on<Api.PlaceSearchResponse>("POST", /\/places\/search$/, () => ({
    provider: "synthetic",
    attribution: "© OpenStreetMap contributors",
    attribution_url: "https://www.openstreetmap.org/copyright",
    results: [
      searchResult,
      { ...searchResult, osm_element_id: "9", display_name: "Taipei 101, Xinyi, Taipei, Taiwan" },
    ],
  }));
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied toevoegen" }));
  fireEvent.change(screen.getByLabelText("Zoek stad of regio"), { target: { value: "Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  const city = await screen.findByRole("button", { name: /^Taipei, Taiwan/ });
  // The local name sits next to the translated one and marks its language unknown (`lang=""`).
  const shown = within(city).getByText("臺北市");
  expect(shown.getAttribute("lang")).toBe("");
  fireEvent.click(city);

  // The name from the result fills the editor's own field, which marks its language unknown (`lang=""`) either.
  const local = screen.getByLabelText("Lokale naam (optioneel)") as HTMLInputElement;
  expect(local.value).toBe("臺北市");
  expect(local.getAttribute("lang")).toBe("");
  expect(local.getAttribute("dir")).toBe("auto");
  // The provider's Dutch and English names are offered, not applied: the English one is not typed anywhere yet.
  expect((screen.getByLabelText("Naam") as HTMLInputElement).value).toBe("Taipei");
  expect(screen.getByText("Namen uit de kaartgegevens")).toBeTruthy();
  expect(screen.getByText("Taipeh").getAttribute("lang")).toBe("nl");
  expect(screen.getByText("Taipei City").getAttribute("lang")).toBe("en");
  fireEvent.click(screen.getByRole("button", { name: "Deze namen gebruiken" }));
  expect((screen.getByLabelText("Naam") as HTMLInputElement).value).toBe("Taipeh");
  expect(screen.queryByText("Namen uit de kaartgegevens")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Gebied opslaan" }));
  await screen.findByRole("button", { name: "Gebied Taipeh bekijken" });
  expect(api.lastBody("POST /api/trips/trip/areas")).toMatchObject({
    label_nl: "Taipeh",
    label_en: "Taipei City",
    local_name: "臺北市",
  });
});

it("takes no local name from a result that is only a place inside the city", async () => {
  api = emptyApi();
  api.on<Api.PlaceSearchResponse>("POST", /\/places\/search$/, () => ({
    provider: "synthetic",
    attribution: "© OpenStreetMap contributors",
    attribution_url: "https://www.openstreetmap.org/copyright",
    results: [
      { ...searchResult, display_name: "Taipei 101, Xinyi, Taipei, Taiwan", local_name: "台北101" },
    ],
  }));
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied toevoegen" }));
  fireEvent.change(screen.getByLabelText("Zoek stad of regio"), { target: { value: "101" } });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Taipei 101/ }));
  expect((screen.getByLabelText("Naam") as HTMLInputElement).value).toBe("Taipei");
  expect((screen.getByLabelText("Lokale naam (optioneel)") as HTMLInputElement).value).toBe("");
  expect(screen.queryByText("Namen uit de kaartgegevens")).toBeNull();
});

it("edits and clears an area's local name, shown in its detail", async () => {
  api = emptyApi().collection<Api.AreaResponse>("/api/trips/trip/areas", [
    { ...area, local_name: "臺北" },
  ]);
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied Taipei bekijken" }));
  expect(within(screen.getByRole("dialog")).getByText("臺北")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  const local = screen.getByLabelText("Lokale naam (optioneel)") as HTMLInputElement;
  expect(local.value).toBe("臺北");
  fireEvent.change(local, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Gebied opslaan" }));
  await waitFor(() => expect(api.count("PATCH /api/trips/trip/areas/area-1")).toBe(1));
  expect(api.lastBody("PATCH /api/trips/trip/areas/area-1")).toMatchObject({ local_name: null });
});

it("reports a refused area delete inside the dialog, where the owner is looking", async () => {
  api = fakeApi()
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [ticket])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [area])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [], createdStay)
    .collection<Api.RouteResponse>("/api/trips/trip/routes", [])
    .collection<Api.VisitResponse>("/api/trips/trip/visits", [])
    .value<Api.PublicProjectionStatusResponse>("/api/trips/trip/public-projection", {
      revision: 0,
      applied_preset: null,
      applied_preset_at: null,
      preset_exceptions: null,
      trip_id: "trip",
      surface_state: "unpublished",
      scope: {
        schema_version: "travel/share-scope@1",
        trip: { title: true, summary: true, dates: null },
        items: [],
      },
      slug: null,
    })
    .value<Api.ShareLinkResponse[]>("/api/trips/trip/share-links", []);
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
