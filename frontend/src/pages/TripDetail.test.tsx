import { jsonResponse, fixtureResponse } from "@/mocks/response";
import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { createRootRoute, createRoute } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import {
  renderRoutesWithOwner,
  restoreObjectUrls,
  stubObjectUrls,
  testToken,
} from "../query/test-utils";
import type { Trip } from "../api-types";
import { TripDetail } from "./TripDetail";
import { serveApi } from "../query/serve-api";

const rootRoute = createRootRoute();
const tripDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "trips/$tripId/details",
  component: TripDetail,
});
const tripsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "trips",
  component: () => <p>Alle reizen</p>,
});
const routeTree = rootRoute.addChildren([tripDetailRoute, tripsListRoute]);

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

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
  summary: "Drie weken",
  summary_nl: "Drie weken",
  summary_en: null,
  starts_on: "2054-11-16",
  ends_on: "2054-12-06",
  travel_updates: [
    {
      area: null,
      body_html: null,
      private_notes_html: null,
      id: "m1",
      occurred_at: "2054-11-17T10:00:00Z",
      timezone: "UTC",
      local_date: "2054-11-17",
      share_date_precision: "day",
      title: "Eerste avond",
      title_nl: "Eerste avond",
      title_en: null,
      body: "",
      body_nl: "",
      body_en: null,
      private_notes: "Nachtmarkt",
      area_id: null,
      location: null,
      media_asset_ids: [],
      visibility: "private",
    },
  ],
};
const path = (resource: string) =>
  resource === "documents" ? "/api/documents?trip_id=trip" : `/api/trips/trip/${resource}`;

let api: FakeApi;
type SeedRecords = {
  locations: Api.LocationResponse[];
  areas: Api.AreaResponse[];
  routes: Api.RouteResponse[];
  stays: Api.StayResponse[];
  visits: Api.VisitResponse[];
  "trip-tasks": Api.TripTaskResponse[];
  documents: Api.DocumentResponse[];
  media: Api.MediaAssetResponse[];
};
function seed(overrides: Partial<SeedRecords> = {}) {
  const collections: SeedRecords = {
    locations: [],
    areas: [],
    routes: [],
    stays: [],
    visits: [],
    "trip-tasks": [],
    documents: [],
    media: [],
    ...overrides,
  };
  api = fakeApi();
  api.collection<Api.TripSummaryResponse>("/api/trips", [
    { ...trip, travel_update_count: trip.travel_updates.length, last_update_at: null },
  ]);
  api.collection<Api.TravelUpdateResponse>("/api/trips/trip/travel-updates", trip.travel_updates);
  for (const [resource, rows] of Object.entries(collections))
    api.collection<SeedRecords[keyof SeedRecords][number]>(path(resource), rows);
}
const renderDetail = () => renderRoutesWithOwner(routeTree, ["/trips/trip/details"]);

beforeEach(() => {
  auth.session = { accessToken: testToken() };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreObjectUrls();
});

it("shows the whole private trip once every read has arrived", async () => {
  seed({
    stays: [
      {
        check_in_time: null,
        check_out_time: null,
        website_url: null,
        contact_details: null,
        notes: null,
        document_asset_ids: [],
        visibility: "private",
        share_date_precision: null,
        notes_html: null,
        contact_details_html: null,
        id: "s1",
        check_in_date: "2054-11-16",
        check_out_date: "2054-11-18",
        status: "confirmed",
        property_name: "Hotel Royal",
        location: {
          osm_element_type: null,
          osm_element_id: null,
          display_name: null,
          address_line1: null,
          address_line2: null,
          locality: null,
          admin_area: null,
          postal_code: null,
          country_code: null,
          latitude: null,
          longitude: null,
          viewport_north: null,
          viewport_south: null,
          viewport_east: null,
          viewport_west: null,
          navigation_provider: null,
          navigation_provider_place_id: null,
          notes: null,
          label: null,
          label_nl: null,
          label_en: null,
          local_name: null,
          area_id: "synthetic",
          share_address: false,
          id: "synthetic",
          visibility: "private",
          osm_url: null,
          notes_html: null,
        },
        area: {
          label_nl: null,
          label_en: null,
          local_name: null,
          country_code: null,
          region: null,
          latitude: null,
          longitude: null,
          timezone: null,
          id: "synthetic",
          visibility: "private",
          label: "Taipei",
        },
        booking_reference: "ABC",
      },
    ],
    "trip-tasks": [
      {
        remind_at: null,
        reminded_at: null,
        created_at: "2054-01-01T00:00:00Z",
        notes_html: null,
        id: "t1",
        title: "Visum regelen",
        due_date: null,
        completed_at: null,
        notes: null,
        links: [],
      },
    ],
  });
  renderDetail();
  await screen.findByRole("heading", { name: "Exampleland" });
  expect(screen.getByText("Eerste avond")).toBeTruthy();
  expect(screen.getByText("Hotel Royal")).toBeTruthy();
  expect(screen.getByText("Boekingsreferentie: ABC")).toBeTruthy();
  expect(screen.getByText("Visum regelen")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Naar reisbeheer" }).getAttribute("href")).toBe(
    "/trips/trip",
  );
  expect(api.unexpected).toEqual([]);
});

it("shows a saved location's own name instead of its repeated locality", async () => {
  seed({
    locations: [
      {
        osm_element_type: null,
        osm_element_id: null,
        address_line1: null,
        address_line2: null,
        admin_area: null,
        postal_code: null,
        latitude: null,
        longitude: null,
        viewport_north: null,
        viewport_south: null,
        viewport_east: null,
        viewport_west: null,
        navigation_provider: null,
        navigation_provider_place_id: null,
        notes: null,
        label_nl: null,
        label_en: null,
        local_name: null,
        area_id: "synthetic",
        share_address: false,
        visibility: "private",
        osm_url: null,
        notes_html: null,
        id: "l1",
        label: "Longshan Temple",
        display_name: null,
        locality: "Taipei",
        country_code: "TW",
      },
    ],
  });
  renderDetail();
  await screen.findByRole("heading", { name: "Exampleland" });
  expect(screen.getByRole("heading", { name: "Longshan Temple · Taipei · TW" })).toBeTruthy();
});

it("shows saved travel context and update media in the private overview", async () => {
  stubObjectUrls("blob:preview");
  seed({
    locations: [
      {
        osm_element_type: null,
        osm_element_id: null,
        display_name: null,
        latitude: null,
        longitude: null,
        viewport_north: null,
        viewport_south: null,
        viewport_east: null,
        viewport_west: null,
        navigation_provider: null,
        navigation_provider_place_id: null,
        notes: null,
        label_nl: null,
        label_en: null,
        local_name: null,
        area_id: "synthetic",
        share_address: false,
        visibility: "private",
        osm_url: null,
        notes_html: null,
        id: "l1",
        label: "Hotel",
        address_line1: "Main Street 1",
        address_line2: "Floor 2",
        postal_code: "1000",
        locality: "Brussels",
        admin_area: "Brussels-Capital",
        country_code: "BE",
      },
    ],
    stays: [
      {
        website_url: null,
        booking_reference: null,
        contact_details: null,
        notes: null,
        document_asset_ids: [],
        visibility: "private",
        share_date_precision: null,
        notes_html: null,
        contact_details_html: null,
        id: "s1",
        check_in_date: "2054-11-16",
        check_out_date: "2054-11-18",
        check_in_time: "15:30:00",
        check_out_time: "10:00:00",
        status: "confirmed",
        property_name: "Hotel Royal",
        location: {
          osm_element_type: null,
          osm_element_id: null,
          display_name: null,
          address_line1: null,
          address_line2: null,
          locality: null,
          admin_area: null,
          postal_code: null,
          country_code: null,
          latitude: null,
          longitude: null,
          viewport_north: null,
          viewport_south: null,
          viewport_east: null,
          viewport_west: null,
          navigation_provider: null,
          navigation_provider_place_id: null,
          notes: null,
          label: null,
          label_nl: null,
          label_en: null,
          local_name: null,
          area_id: "synthetic",
          share_address: false,
          id: "synthetic",
          visibility: "private",
          osm_url: null,
          notes_html: null,
        },
        area: {
          label_nl: null,
          label_en: null,
          local_name: null,
          country_code: null,
          region: null,
          latitude: null,
          longitude: null,
          id: "synthetic",
          visibility: "private",
          label: "Taipei",
          timezone: "Asia/Taipei",
        },
      },
    ],
    routes: [
      {
        label_nl: null,
        label_en: null,
        booking_reference: null,
        notes: null,
        document_asset_ids: [],
        visibility: "private",
        notes_html: null,
        id: "r1",
        mode: "flight",
        status: "confirmed",
        label: "BR76",
        departure_area: {
          label_nl: null,
          label_en: null,
          local_name: null,
          country_code: null,
          region: null,
          latitude: null,
          longitude: null,
          timezone: null,
          id: "synthetic",
          visibility: "private",
          label: "Amsterdam",
        },
        arrival_area: {
          label_nl: null,
          label_en: null,
          local_name: null,
          country_code: null,
          region: null,
          latitude: null,
          longitude: null,
          timezone: null,
          id: "synthetic",
          visibility: "private",
          label: "Taipei",
        },
        departure_location: null,
        arrival_location: null,
        departs_on: "2054-11-16",
        departs_at: "2054-11-16T09:40:00Z",
        arrives_at: "2054-11-16T22:25:00Z",
        departure_timezone: "Europe/Amsterdam",
        arrival_timezone: "Asia/Taipei",
        carrier: null,
        service_reference: null,
        travel_class: null,
        geometry: null,
      },
    ],
    "trip-tasks": [
      {
        reminded_at: null,
        created_at: "2054-01-01T00:00:00Z",
        notes_html: null,
        id: "t1",
        title: "Visum regelen",
        due_date: null,
        remind_at: "2054-11-01T09:00:00Z",
        completed_at: null,
        notes: null,
        links: [],
      },
    ],
    media: [
      {
        content_type: "synthetic",
        captured_local: false,
        created_at: "2054-01-01T00:00:00Z",
        deleted_at: null,
        camera_make: null,
        camera_model: null,
        id: "p1",
        media_kind: "photo",
        byte_size: 200,
        captured_at: null,
        original_filename: "arrival.jpg",
        thumbnail_url: "/api/trips/trip/media/p1/thumbnail",
        file_url: "/api/trips/trip/media/p1/original",
        gps: null,
      },
    ],
  });
  api.collection<Api.TravelUpdateResponse>("/api/trips/trip/travel-updates", [
    { ...trip.travel_updates[0], media_asset_ids: ["p1"] },
  ]);
  api.on<object | string>(
    /* Fixture exception: File/thumbnail transport sentinel; no JSON API record. */ "GET",
    /\/media\/p1\/thumbnail$/,
    () => "image",
  );
  renderDetail();
  await screen.findByRole("heading", { name: "Exampleland" });
  expect(screen.getByText("Drie weken")).toBeTruthy();
  expect(screen.getByText("Inchecken 15:30 · Uitchecken 10:00 (Asia/Taipei)")).toBeTruthy();
  expect(screen.getByText(/Amsterdam → Taipei/)).toBeTruthy();
  expect(
    screen.getByText(
      /16 nov 2054, 10:40 \(Europe\/Amsterdam\) → 17 nov 2054, 06:25 \(Asia\/Taipei\)/,
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", {
      name: "Hotel · Main Street 1 · Floor 2 · 1000 · Brussels · Brussels-Capital · BE",
    }),
  ).toBeTruthy();
  expect(screen.getByText(/Herinnering:/)).toBeTruthy();
  await waitFor(() =>
    expect(
      screen.getByRole("group", { name: "Media bij Eerste avond" }).querySelector("img"),
    ).toBeTruthy(),
  );
  expect(
    screen
      .getByRole("group", { name: "Media bij Eerste avond" })
      .querySelector("a")
      ?.getAttribute("href"),
  ).toBe("/trips/trip/story");
  expect(api.unexpected).toEqual([]);
});

it("shows a loading state, then an error rather than half a trip when one read fails", async () => {
  seed();
  serveApi(
    vi.fn((url: string) =>
      Promise.resolve(
        url === "/api/trips"
          ? jsonResponse<Api.TripSummaryResponse[]>(
              [{ ...trip, travel_update_count: trip.travel_updates.length, last_update_at: null }],
              { status: 200 },
            )
          : url.startsWith("/api/documents")
            ? fixtureResponse(
                /* Fixture exception: Error or persistence-control fixture; no successful Travel record is consumed. */ {
                  detail: "kapot",
                },
                { status: 500 },
              )
            : jsonResponse<never[]>([], { status: 200 }),
      ),
    ),
  );
  renderDetail();
  expect(await screen.findByText("Private reis laden…")).toBeTruthy();
  await screen.findByText(
    "De private reis kon niet volledig worden geladen. De server reageert niet goed. Probeer het later opnieuw.",
  );
  expect(screen.queryByRole("heading", { name: "Exampleland" })).toBeNull();
});

it("says so when the trip does not exist, and reads nothing for it", async () => {
  seed();
  api.collection<Api.TripSummaryResponse>("/api/trips", []);
  renderDetail();
  await screen.findByText("Reis niet gevonden");
  expect(api.requests.filter((request) => request.includes("/api/trips/trip/"))).toEqual([]);
});

it("opens a private document with the authenticated download", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
  stubObjectUrls("blob:doc");
  seed({
    documents: [
      {
        content_type: "synthetic",
        trip_id: null,
        created_at: "2054-01-01T00:00:00Z",
        id: "d1",
        title: "Vliegticket",
        document_kind: "booking",
        original_filename: "ticket.pdf",
        byte_size: 100,
        file_url: "/api/documents/d1/original",
      },
    ],
  });
  api.on<object | string>(
    /* Fixture exception: File/thumbnail transport sentinel; no JSON API record. */ "GET",
    /\/documents\/d1\/original$/,
    () => "pdf",
  );
  renderDetail();
  fireEvent.click(await screen.findByRole("button", { name: "Document openen" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith("blob:doc", "_blank", "noopener"));
  const original = api.requests.find((request) => request.endsWith("/original"))!;
  expect(api.lastHeaders(original)?.get("authorization")).toMatch(/^Bearer /);
});

it("reports a document that cannot be opened without leaving the page", async () => {
  seed({
    documents: [
      {
        content_type: "synthetic",
        trip_id: null,
        created_at: "2054-01-01T00:00:00Z",
        id: "d1",
        title: "Vliegticket",
        document_kind: "booking",
        original_filename: "ticket.pdf",
        byte_size: 100,
        file_url: "/api/documents/d1/original",
      },
    ],
  });
  api.on<object | string>(
    /* Fixture exception: File/thumbnail transport sentinel; no JSON API record. */ "GET",
    /\/documents\/d1\/original$/,
    () => {
      throw new Error("unused");
    },
  );
  // Layered over the default API: only the download fails, everything else falls through.
  serveApi((url) =>
    url.endsWith("/original")
      ? fixtureResponse(
          /* Fixture exception: Error or persistence-control fixture; no successful Travel record is consumed. */ {
            detail: "Bestand ontbreekt.",
          },
          { status: 404 },
        )
      : undefined,
  );
  renderDetail();
  fireEvent.click(await screen.findByRole("button", { name: "Document openen" }));
  await screen.findByText("Dit kon niet worden uitgevoerd. Probeer opnieuw.");
  expect(screen.getByRole("heading", { name: "Exampleland" })).toBeTruthy();
});
