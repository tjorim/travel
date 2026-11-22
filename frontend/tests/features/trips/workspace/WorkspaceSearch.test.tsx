import { responseFixtures } from "@/mocks/response-test-fixtures";
import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { createRootRoute } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../../../utils/fake-api";
import { renderRoutesWithOwner, testToken } from "../../../utils/query-test-utils";
import { WorkspaceSearch } from "@/features/trips/workspace/WorkspaceSearch";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("@/app/providers/auth-context", () => ({ useAuth: () => auth }));

let api: FakeApi | null = null;
beforeEach(() => {
  auth.session = null;
  api = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (api) expect(api.unexpected).toEqual([]);
});

/** The popup opens after the key press has been handled, so the option is awaited. */
async function choose(optionName: string) {
  fireEvent.keyDown(await screen.findByRole("combobox", { name: "Ga naar" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

const render = () =>
  renderRoutesWithOwner(createRootRoute({ component: () => <WorkspaceSearch tripId="t1" /> }), [
    "/",
  ]);

it("offers every tab and every block inside a tab", async () => {
  render();
  fireEvent.keyDown(await screen.findByRole("combobox", { name: "Ga naar" }), {
    key: "ArrowDown",
  });
  // The Visits, Stays and Routes blocks are gone, and their entries now lead to the agenda with that kind.
  for (const name of [
    "Overzicht",
    "Plan › Agenda",
    "Plan › Bezoeken",
    "Plan › Verblijven",
    "Plan › Routes",
    "Voorbereiden › Documenten",
    "Verhaal",
  ])
    expect(await screen.findByRole("option", { name })).toBeTruthy();
});

it("says what the empty field searches, while keeping its label as the name", async () => {
  render();
  const search = await screen.findByRole("combobox", { name: "Ga naar" });
  expect(search.getAttribute("placeholder")).toBe("Zoek in deze reis");
});

it("goes to a block with its hash, and asks it to expand", async () => {
  const { router } = render();
  await screen.findByRole("combobox", { name: "Ga naar" });
  await choose("Plan › Verblijven");
  await waitFor(() => expect(router.state.location.pathname).toBe("/trips/t1/plan"));
  expect(router.state.location.hash).toBe("stays");
  expect(router.state.location.state.openSection?.id).toBe("stays");
});

it("goes to a tab that has no blocks without a hash", async () => {
  const { router } = render();
  await screen.findByRole("combobox", { name: "Ga naar" });
  await choose("Inpakken");
  await waitFor(() => expect(router.state.location.pathname).toBe("/trips/t1/packing"));
  expect(router.state.location.hash).toBe("");
});

const area: Api.AreaResponse = {
  ...responseFixtures.AreaResponse,
  id: "a1",
  label: "Taipei",
  visibility: "private",
};

/** A trip with a stay, a task and a travel update, and a photo library big enough to overflow one kind's results. */
function signedIn() {
  auth.session = { accessToken: testToken() };
  const photo = (index: number): Api.MediaAssetResponse => ({
    ...responseFixtures.MediaAssetResponse,
    id: `m${index}`,
    media_kind: "photo",
    original_filename: `Strand ${index}.jpg`,
  });
  api = fakeApi();
  api.on<Api.TripSummaryResponse[]>("GET", /^\/api\/trips$/, () => [
    {
      owner_subject: "synthetic",
      content_language: "nl",
      translation_freshness: {},
      title_nl: null,
      title_en: null,
      summary: null,
      summary_nl: null,
      summary_en: null,
      starts_on: null,
      ends_on: null,
      cover_derivative_id: null,
      cover_url: null,
      summary_html: null,
      id: "t1",
      title: "Exampleland",
      travel_update_count: 1,
      last_update_at: "2054-11-16",
    },
  ]);
  api.collection<Api.TravelUpdateResponse>("/api/trips/t1/travel-updates", [
    {
      timezone: "synthetic",
      local_date: "2054-01-01",
      share_date_precision: "day",
      translation_freshness: {},
      title_nl: null,
      title_en: null,
      body: "synthetic",
      body_nl: null,
      body_en: null,
      private_notes: null,
      area_id: null,
      area: null,
      location: null,
      media_asset_ids: [],
      visibility: "private",
      body_html: null,
      private_notes_html: null,
      id: "u1",
      title: "Aankomst in Taipei",
      occurred_at: "2054-11-16",
    },
  ]);
  api.collection<Api.AreaResponse>("/api/trips/t1/areas", [area]);
  api.collection<Api.LocationResponse>("/api/trips/t1/locations", []);
  api.collection<Api.VisitResponse>("/api/trips/t1/visits", []);
  api.collection<Api.RouteResponse>("/api/trips/t1/routes", []);
  api.collection<Api.StayResponse>("/api/trips/t1/stays", [
    {
      check_in_date: "2054-01-01",
      check_out_date: "2054-01-01",
      check_in_time: null,
      check_out_time: null,
      status: "idea",
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
      property_name: "Café Hotel Taipei",
      area,
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
        translation_freshness: {},
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
    },
  ]);
  api.collection<Api.TripTaskResponse>("/api/trips/t1/trip-tasks", [
    {
      notes: null,
      due_date: null,
      remind_at: null,
      reminded_at: null,
      links: [],
      completed_at: null,
      created_at: "2054-01-01T00:00:00Z",
      notes_html: null,
      id: "k1",
      title: "Visum regelen",
    },
  ]);
  api.collection<Api.DocumentResponse>("/api/documents?trip_id=t1", []);
  api.collection<Api.MediaAssetResponse>(
    "/api/trips/t1/media",
    Array.from({ length: 7 }, (_, index) => photo(index + 1)),
  );
}

async function search(query: string) {
  fireEvent.change(await screen.findByRole("combobox", { name: "Ga naar" }), {
    target: { value: query },
  });
}

it("finds a record by its title, whatever the accents, and labels it with its tab and block", async () => {
  signedIn();
  const { router } = render();
  await waitFor(() => expect(api!.count("GET /api/trips/t1/media")).toBe(1));
  await search("cafe hotel");
  fireEvent.click(await screen.findByRole("option", { name: "Plan › Agenda › Café Hotel Taipei" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/trips/t1/plan"));
  expect(router.state.location.state.openRecord).toMatchObject({ kind: "stay", id: "s1" });
});

it("opens a task in Prepare and a travel update in Story", async () => {
  signedIn();
  const { router } = render();
  await waitFor(() => expect(api!.count("GET /api/trips/t1/media")).toBe(1));
  await search("visum");
  fireEvent.click(
    await screen.findByRole("option", { name: "Voorbereiden › Nog te regelen › Visum regelen" }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/trips/t1/prepare"));
  expect(router.state.location.state.openRecord).toMatchObject({ kind: "task", id: "k1" });

  await search("aankomst");
  fireEvent.click(
    await screen.findByRole("option", { name: "Verhaal › Reisupdates › Aankomst in Taipei" }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/trips/t1/story"));
  expect(router.state.location.state.openRecord).toMatchObject({ kind: "update", id: "u1" });
});

it("shows a few photos and counts the rest instead of listing a whole library", async () => {
  signedIn();
  render();
  await waitFor(() => expect(api!.count("GET /api/trips/t1/media")).toBe(1));
  await search("strand");
  expect(
    await screen.findAllByRole("option", { name: /Verhaal › Mediabibliotheek › Strand/ }),
  ).toHaveLength(5);
  const more = screen.getByRole("option", { name: /Nog 2 in Verhaal › Mediabibliotheek/ });
  expect(more.getAttribute("aria-disabled")).toBe("true");
});

it("sends no request that carries the search words", async () => {
  signedIn();
  render();
  await waitFor(() => expect(api!.count("GET /api/trips/t1/media")).toBe(1));
  await search("visum");
  await screen.findByRole("option", { name: /Visum regelen/ });
  expect(api!.requests.filter((request) => /visum/i.test(request))).toEqual([]);
});
