// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { Area, Location, Trip } from "../tracker-model";
import { LocationManager } from "./LocationManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, travel_updates: [] };
const location = {
  id: "e1",
  area_id: "a1",
  label: null,
  visibility: "private",
  share_address: false,
  display_name: "Beitou Hot Spring, 12 Guangming Road, Taipei",
  locality: "Taipei",
  country_code: "TW",
  address_line1: "12 Guangming Road",
} as Location;
const taipei = {
  id: "a1",
  label: "Taipei",
  visibility: "private",
  country_code: "TW",
  region: null,
  latitude: null,
  longitude: null,
  timezone: null,
} as Area;

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi().collection("/api/trips/trip/locations", [location], { update: (row, body) => ({ ...row, ...body }) });
  api.value("/api/trips/trip/public-projection", {
    trip_id: "trip",
    surface_state: "unpublished",
    scope: { items: [] },
    slug: null,
  });
  api.value("/api/trips/trip/share-links", []);
  api.on("PUT", /\/visibility\/location\/e1$/, (body) => body);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(api.unexpected).toEqual([]);
});

it("opens saved details and edits the address with an explicit save", async () => {
  renderWithOwner(
    <LocationManager trip={trip} areas={[taipei]} request={{ id: "e1", token: 1 }} onNeedArea={() => undefined} />,
  );
  expect(await screen.findByText(/Opgeslagen adres: 12 Guangming Road/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Adresregel 1 (optioneel)"), { target: { value: "14 Guangming Road" } });
  fireEvent.click(screen.getByRole("button", { name: "Locatie opslaan" }));
  await waitFor(() =>
    expect(api.lastBody("PATCH /api/trips/trip/locations/e1")).toMatchObject({
      address_line1: "14 Guangming Road",
      area_id: "a1",
    }),
  );
});

it("creates a manual location only after saving and keeps address sharing off", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/locations", [])
    .value("/api/trips/trip/public-projection", {
      trip_id: "trip",
      surface_state: "unpublished",
      scope: { items: [] },
      slug: null,
    })
    .value("/api/trips/trip/share-links", []);
  renderWithOwner(
    <LocationManager trip={trip} areas={[taipei]} request={{ areaId: "a1", token: 2 }} onNeedArea={() => undefined} />,
  );
  fireEvent.change(await screen.findByLabelText("Eigen naam (optioneel)"), { target: { value: "Warmwaterbron" } });
  fireEvent.change(screen.getByLabelText("Adresregel 1 (optioneel)"), { target: { value: "12 Guangming Road" } });
  expect(api.count("POST /api/trips/trip/locations")).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Locatie opslaan" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/locations")).toMatchObject({
      area_id: "a1",
      display_name: "Warmwaterbron",
      address_line1: "12 Guangming Road",
    }),
  );
  expect(api.lastBody<Record<string, unknown>>("POST /api/trips/trip/locations")?.share_address).toBeUndefined();
});

it("previews only projected address fields and names the live recipients", async () => {
  api = fakeApi()
    .collection(
      "/api/trips/trip/locations",
      [{ ...location, visibility: "custom", share_address: true, notes: "Secret room" }],
      { update: (row, body) => ({ ...row, ...body }) },
    )
    .value("/api/trips/trip/public-projection", {
      trip_id: "trip",
      surface_state: "published",
      scope: { items: [] },
      slug: "trip",
    })
    .value("/api/trips/trip/share-links", [
      {
        id: "live",
        label: "Familie",
        state: "active",
        scope: { items: [{ kind: "location", id: "e1" }] },
        expires_at: null,
      },
    ]);
  renderWithOwner(
    <LocationManager trip={trip} areas={[taipei]} request={{ id: "e1", token: 3 }} onNeedArea={() => undefined} />,
  );
  expect(await screen.findByText(/Bereikt momenteel: deellink “Familie”/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(
    screen.getByText(
      /Exact adresveld voor bezoekers als Adres delen aanstaat: {"line1":"12 Guangming Road","locality":"Taipei"}/,
    ),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Adresregel 2 (optioneel)"), { target: { value: "Floor 4" } });
  expect(screen.getByText(/"line2":"Floor 4"/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Annuleren" }));
  expect(api.count("PATCH /api/trips/trip/locations/e1")).toBe(0);
});

it("blocks address sharing without address parts", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/locations", [{ ...location, address_line1: null, locality: null, country_code: "TW" }])
    .value("/api/trips/trip/public-projection", {
      trip_id: "trip",
      surface_state: "unpublished",
      scope: { items: [] },
      slug: null,
    })
    .value("/api/trips/trip/share-links", []);
  renderWithOwner(
    <LocationManager trip={trip} areas={[taipei]} request={{ id: "e1", token: 4 }} onNeedArea={() => undefined} />,
  );
  expect(await screen.findByText(/Geen adres vastgelegd/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByLabelText("Adres ook delen met ontvangers van deze locatie")).toHaveProperty("disabled", true);
});

it("reviews and corrects an OSM snapshot without changing its saved point", async () => {
  api = fakeApi()
    .collection("/api/trips/trip/locations", [])
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
        osm_element_type: "node",
        osm_element_id: "42",
        display_name: "Hotel Taipei",
        address_line1: "1 Old Road",
        address_line2: "Old floor",
        postal_code: "100",
        locality: "Taipei",
        admin_area: "Taipei City",
        country_code: "TW",
        latitude: 25.034,
        longitude: 121.565,
      },
    ],
  }));
  renderWithOwner(
    <LocationManager trip={trip} areas={[taipei]} request={{ areaId: "a1", token: 5 }} onNeedArea={() => undefined} />,
  );
  fireEvent.change(screen.getByLabelText("Zoek via OpenStreetMap"), { target: { value: "Hotel Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Hotel Taipei" }));
  expect(screen.getByText(/Opgeslagen kaartpunt en navigatiedoel: 25.034, 121.565/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Adresregel 1 (optioneel)"), { target: { value: "2 New Road" } });
  fireEvent.change(screen.getByLabelText("Adresregel 2 (optioneel)"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Locatie opslaan" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/locations")).toMatchObject({
      osm_element_type: "node",
      osm_element_id: "42",
      latitude: 25.034,
      longitude: 121.565,
      address_line1: "2 New Road",
      address_line2: null,
      postal_code: "100",
      admin_area: "Taipei City",
    }),
  );
});
