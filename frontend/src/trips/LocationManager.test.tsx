import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { chooseOption, openAdvanced, renderWithOwner, testToken } from "../query/test-utils";
import { answerConfirmation } from "../test-confirm";
import type { Area, Location, Trip } from "../api-types";
import { changeLocale } from "@/i18n/locale";
import { LocationManager } from "@/features/trips/locations/LocationManager";

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
  starts_on: null,
  ends_on: null,
  travel_updates: [],
};
const location = {
  id: "e1",
  area_id: "a1",
  label: null,
  visibility: "private",
  share_address: false,
  display_name: "Beitou Hot Spring, 12 Guangming Road, Taipei",
  osm_element_type: "node",
  osm_element_id: "42",
  osm_url: "https://www.openstreetmap.org/node/42",
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
  api = fakeApi().collection<Api.LocationResponse>("/api/trips/trip/locations", [location], {
    update: (row, body) => ({ ...row, ...body }),
  });
  api.value<Api.PublicProjectionStatusResponse>("/api/trips/trip/public-projection", {
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
  });
  api.value<Api.ShareLinkResponse[]>("/api/trips/trip/share-links", []);
  api.on<Api.VisibilityUpdate>(
    "PUT",
    /\/visibility\/location\/e1$/,
    (body) => body as Api.VisibilityUpdate,
  );
});
afterEach(() => {
  cleanup();
  act(() => changeLocale("nl"));
  vi.unstubAllGlobals();
  expect(api.unexpected).toEqual([]);
});

it("opens saved details and edits the address with an explicit save", async () => {
  renderWithOwner(
    <LocationManager
      trip={trip}
      areas={[taipei]}
      request={{ id: "e1", token: 1 }}
      onNeedArea={() => undefined}
    />,
  );
  expect(await screen.findByText(/Opgeslagen adres: 12 Guangming Road/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "node 42" }).getAttribute("href")).toBe(location.osm_url);
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Adresregel 1 (optioneel)"), {
    target: { value: "14 Guangming Road" },
  });
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
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [])
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
  renderWithOwner(
    <LocationManager
      trip={trip}
      areas={[taipei]}
      request={{ areaId: "a1", token: 2 }}
      onNeedArea={() => undefined}
    />,
  );
  fireEvent.change(await screen.findByLabelText("Eigen naam (optioneel)"), {
    target: { value: "Warmwaterbron" },
  });
  fireEvent.change(screen.getByLabelText("Adresregel 1 (optioneel)"), {
    target: { value: "12 Guangming Road" },
  });
  expect(api.count("POST /api/trips/trip/locations")).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Locatie opslaan" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/locations")).toMatchObject({
      area_id: "a1",
      display_name: "Warmwaterbron",
      address_line1: "12 Guangming Road",
    }),
  );
  expect(
    api.lastBody<Record<string, unknown>>("POST /api/trips/trip/locations")?.share_address,
  ).toBeUndefined();
});

it("previews only projected address fields and names the live recipients", async () => {
  api = fakeApi()
    .collection<Api.LocationResponse>(
      "/api/trips/trip/locations",
      [{ ...location, visibility: "custom", share_address: true, notes: "Secret room" }],
      { update: (row, body) => ({ ...row, ...body }) },
    )
    .value<Api.PublicProjectionStatusResponse>("/api/trips/trip/public-projection", {
      revision: 0,
      applied_preset: null,
      applied_preset_at: null,
      preset_exceptions: null,
      trip_id: "trip",
      surface_state: "published",
      scope: {
        schema_version: "travel/share-scope@1",
        trip: { title: true, summary: true, dates: null },
        items: [],
      },
      slug: "trip",
    })
    .value<Api.ShareLinkResponse[]>("/api/trips/trip/share-links", [
      {
        feed_token: null,
        feed_expires_at: null,
        revision: 0,
        series_id: "synthetic",
        token: null,
        created_at: "2054-01-01T00:00:00Z",
        activated_at: null,
        revoked_at: null,
        exclusions: { excluded: [], also_hidden: {}, stale: 0 },
        applied_preset: null,
        applied_preset_at: null,
        preset_exceptions: null,
        id: "live",
        label: "Familie",
        state: "active",
        scope: {
          schema_version: "travel/share-scope@1",
          trip: { title: true, summary: true, dates: null },
          items: [{ kind: "location", id: "e1" }],
        },
        expires_at: null,
      },
    ]);
  renderWithOwner(
    <LocationManager
      trip={trip}
      areas={[taipei]}
      request={{ id: "e1", token: 3 }}
      onNeedArea={() => undefined}
    />,
  );
  expect(await screen.findByText(/Bereikt momenteel: deellink “Familie”/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(
    screen.getByText(
      /Exact adresveld voor bezoekers als Adres delen aanstaat: Adresregel 1: 12 Guangming Road; Plaats: Taipei/,
    ),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Adresregel 2 (optioneel)"), {
    target: { value: "Floor 4" },
  });
  expect(screen.getByText(/Adresregel 2: Floor 4/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Locatie bewerken sluiten/ }));
  await answerConfirmation("Wijzigingen verwerpen");
  expect(api.count("PATCH /api/trips/trip/locations/e1")).toBe(0);
});

it("blocks address sharing without address parts", async () => {
  api = fakeApi()
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [
      { ...location, address_line1: null, locality: null, country_code: "TW" },
    ])
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
  renderWithOwner(
    <LocationManager
      trip={trip}
      areas={[taipei]}
      request={{ id: "e1", token: 4 }}
      onNeedArea={() => undefined}
    />,
  );
  expect(await screen.findByText(/Geen adres vastgelegd/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  openAdvanced();
  expect(
    screen
      .getByRole("checkbox", { name: "Adres ook delen met ontvangers van deze locatie" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
});

it("reviews and corrects an OSM snapshot without changing its saved point", async () => {
  api = fakeApi()
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [])
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
    <LocationManager
      trip={trip}
      areas={[taipei]}
      request={{ areaId: "a1", token: 5 }}
      onNeedArea={() => undefined}
    />,
  );
  fireEvent.change(screen.getByLabelText("Zoek via OpenStreetMap"), {
    target: { value: "Hotel Taipei" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Hotel Taipei" }));
  expect(screen.getByText(/Opgeslagen kaartpunt en navigatiedoel: 25.034, 121.565/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Adresregel 1 (optioneel)"), {
    target: { value: "2 New Road" },
  });
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

it("describes the shareable address in words, never as raw JSON", async () => {
  renderWithOwner(
    <LocationManager
      trip={trip}
      areas={[taipei]}
      request={{ id: "e1", token: 1 }}
      onNeedArea={() => undefined}
    />,
  );
  await screen.findByText(/Opgeslagen adres: 12 Guangming Road/);
  expect(screen.getByText(/Adresregel 1: 12 Guangming Road; Plaats: Taipei/)).toBeTruthy();
  act(() => changeLocale("en"));
  expect(screen.getByText(/Address line 1: 12 Guangming Road; City: Taipei/)).toBeTruthy();
  expect(screen.queryByText(/Adresregel 1:/)).toBeNull();
  expect(document.body.textContent).not.toContain('"line1"');
});

it("deletes an unused location after confirmation", async () => {
  renderWithOwner(
    <LocationManager
      trip={trip}
      areas={[taipei]}
      request={{ id: "e1", token: 1 }}
      onNeedArea={() => undefined}
    />,
  );
  await screen.findByText(/Opgeslagen adres/);
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  const confirmation = await screen.findByRole("alertdialog");
  fireEvent.click(within(confirmation).getByRole("button", { name: "Verwijderen" }));
  await waitFor(() => expect(api.count("DELETE /api/trips/trip/locations/e1")).toBe(1));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("keeps a location that is still in use and shows why", async () => {
  renderWithOwner(
    <LocationManager
      trip={trip}
      areas={[taipei]}
      request={{ id: "e1", token: 1 }}
      onNeedArea={() => undefined}
    />,
  );
  await screen.findByText(/Opgeslagen adres/);
  api.failNext = {
    status: 409,
    body: {
      detail: "dependency diagnostic",
      errors: [{ code: "resource_in_use", path: [], params: { count: 1, visits: 1 } }],
    },
  };
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );
  expect(await screen.findByText(/wordt nog gebruikt door 1 onderdeel/)).toBeTruthy();
  expect(screen.getByRole("dialog")).toBeTruthy();
});

const sharedLocation = {
  ...location,
  visibility: "everyone",
  label: "Hotel Riverside",
} as Location;
const review = (changes: unknown[]) => ({
  status: 409,
  body: {
    detail: { code: "visitor_visible_change_needs_acknowledgement", changes },
    errors: [{ code: "visitor_visible_change_needs_acknowledgement", params: {}, path: [] }],
  },
});
const publicAudience = { id: "public", label: null };

function shareEverywhere() {
  api = fakeApi()
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [sharedLocation], {
      update: (row, body) => ({ ...row, ...body }),
    })
    .value<Api.PublicProjectionStatusResponse>("/api/trips/trip/public-projection", {
      revision: 0,
      applied_preset: null,
      applied_preset_at: null,
      preset_exceptions: null,
      trip_id: "trip",
      surface_state: "published",
      scope: {
        schema_version: "travel/share-scope@1",
        trip: { title: true, summary: true, dates: null },
        items: [],
      },
      slug: "slug",
    })
    .value<Api.ShareLinkResponse[]>("/api/trips/trip/share-links", []);
}
async function editLabel(value: string) {
  renderWithOwner(
    <LocationManager
      trip={trip}
      areas={[taipei]}
      request={{ id: "e1", token: 1 }}
      onNeedArea={() => undefined}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Publieke naam (optioneel)"), { target: { value } });
}

it("previews which edited fields visitors read, then asks to acknowledge before saving", async () => {
  shareEverywhere();
  await editLabel("Hotel Elsewhere");
  expect(await screen.findByText(/Publieke naam \(gelezen door publieke pagina\)/)).toBeTruthy();

  api.failNext = review([
    {
      field: "label",
      before: "Hotel Riverside",
      after: "Hotel Elsewhere",
      audiences: [publicAudience],
    },
  ]);
  const save = screen.getByRole("button", { name: "Locatie opslaan" });
  fireEvent.click(save);
  const dialog = await screen.findByRole("alertdialog", {
    name: "Bevestig wat bezoekers gaan lezen",
  });
  expect(within(dialog).getByText("Voor: Hotel Riverside")).toBeTruthy();
  expect(within(dialog).getByText("Na: Hotel Elsewhere")).toBeTruthy();
  expect(within(dialog).getByText("Gelezen door: publieke pagina")).toBeTruthy();
  expect(api.lastBody("PATCH /api/trips/trip/locations/e1")).not.toHaveProperty(
    "acknowledge_visitor_changes",
  );

  fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan voor bezoekers" }));
  await waitFor(() => expect(api.count("PATCH /api/trips/trip/locations/e1")).toBe(2));
  expect(api.lastBody("PATCH /api/trips/trip/locations/e1")).toMatchObject({
    label_nl: "Hotel Elsewhere",
    acknowledge_visitor_changes: true,
  });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});

it("keeps the edit and returns focus when the owner declines the visitor-facing change", async () => {
  shareEverywhere();
  await editLabel("Hotel Elsewhere");
  api.failNext = review([
    {
      field: "label",
      before: "Hotel Riverside",
      after: "Hotel Elsewhere",
      audiences: [publicAudience],
    },
  ]);
  const save = screen.getByRole("button", { name: "Locatie opslaan" });
  fireEvent.click(save);
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(api.count("PATCH /api/trips/trip/locations/e1")).toBe(1);
  expect((screen.getByLabelText("Publieke naam (optioneel)") as HTMLInputElement).value).toBe(
    "Hotel Elsewhere",
  );
  // The refusal was a question, not an error: nothing is reported in the form.
  expect(screen.queryByRole("alert")).toBeNull();
});

it("previews a changed local name like the public name, and the review names it", async () => {
  shareEverywhere();
  renderWithOwner(
    <LocationManager
      trip={trip}
      areas={[taipei]}
      request={{ id: "e1", token: 1 }}
      onNeedArea={() => undefined}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Lokale naam (optioneel)"), {
    target: { value: "河畔飯店" },
  });
  expect(await screen.findByText(/Lokale naam \(gelezen door publieke pagina\)/)).toBeTruthy();
  api.failNext = review([
    { field: "local_name", before: null, after: "河畔飯店", audiences: [publicAudience] },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Locatie opslaan" }));
  const dialog = await screen.findByRole("alertdialog", {
    name: "Bevestig wat bezoekers gaan lezen",
  });
  expect(within(dialog).getByText("Na: 河畔飯店")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Opslaan voor bezoekers" }));
  await waitFor(() => expect(api.count("PATCH /api/trips/trip/locations/e1")).toBe(2));
  expect(api.lastBody("PATCH /api/trips/trip/locations/e1")).toMatchObject({
    local_name: "河畔飯店",
    acknowledge_visitor_changes: true,
  });
});

it("fills the local name from a search result and offers its Dutch and English names for the public name", async () => {
  api = fakeApi()
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [])
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
        admin_area: null,
        postal_code: null,
        viewport_north: null,
        viewport_south: null,
        viewport_east: null,
        viewport_west: null,
        osm_element_type: "node",
        osm_element_id: "42",
        display_name: "Senso-ji, Asakusa, Tokyo, Japan",
        locality: "Tokyo",
        country_code: "JP",
        latitude: 35.7148,
        longitude: 139.7967,
        local_name: "浅草寺",
        name_nl: "Sensō-ji",
        name_en: "Senso-ji",
      },
    ],
  }));
  renderWithOwner(
    <LocationManager
      trip={trip}
      areas={[taipei]}
      request={{ areaId: "a1", token: 7 }}
      onNeedArea={() => undefined}
    />,
  );
  fireEvent.change(screen.getByLabelText("Zoek via OpenStreetMap"), {
    target: { value: "Senso-ji" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  const found = await screen.findByRole("button", { name: /^Senso-ji, Asakusa/ });
  expect(within(found).getByText("浅草寺").getAttribute("lang")).toBe("");
  fireEvent.click(found);
  const local = screen.getByLabelText("Lokale naam (optioneel)") as HTMLInputElement;
  expect(local.value).toBe("浅草寺");
  // Nothing was applied to the public name: the owner decides.
  expect((screen.getByLabelText("Publieke naam (optioneel)") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Deze namen gebruiken" }));
  expect((screen.getByLabelText("Publieke naam (optioneel)") as HTMLInputElement).value).toBe(
    "Sensō-ji",
  );
  fireEvent.click(screen.getByRole("button", { name: "Locatie opslaan" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/locations")).toMatchObject({
      label_nl: "Sensō-ji",
      label_en: "Senso-ji",
      local_name: "浅草寺",
    }),
  );
  // What was sent is a location: the suggestion fields are not part of it.
  expect(api.lastBody("POST /api/trips/trip/locations")).not.toHaveProperty("name_nl");
});

it("names the areas and what moves along when the owner moves a shared location", async () => {
  shareEverywhere();
  const tainan = { ...taipei, id: "a2", label: "Tainan" } as Area;
  renderWithOwner(
    <LocationManager
      trip={trip}
      areas={[taipei, tainan]}
      request={{ id: "e1", token: 1 }}
      onNeedArea={() => undefined}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Bewerken" }));
  chooseOption("Gebied", "Tainan");
  expect(await screen.findByText(/Als je deze locatie naar een ander gebied/)).toBeTruthy();
  api.failNext = review([
    {
      field: "area_id",
      before: "a1",
      after: "a2",
      before_label: "Taipei",
      after_label: "Tainan",
      visits: 2,
      routes: 1,
      audiences: [publicAudience, { id: "link:l1", label: "Familie" }],
    },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Locatie opslaan" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText("Voor: Taipei")).toBeTruthy();
  expect(within(dialog).getByText("Na: Tainan")).toBeTruthy();
  expect(within(dialog).getByText(/Bezoeken: 2, routes: 1/)).toBeTruthy();
  expect(
    within(dialog).getByText("Gelezen door: publieke pagina, deellink “Familie”"),
  ).toBeTruthy();
});

it("does not mistake other conflicts for a visitor review", async () => {
  shareEverywhere();
  await editLabel("Hotel Elsewhere");
  api.failNext = { status: 409, body: { detail: { code: "other", changes: [] }, errors: [] } };
  fireEvent.click(screen.getByRole("button", { name: "Locatie opslaan" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
