import { responseFixtures } from "../src/mocks/response-test-fixtures";
import type * as Api from "../src/api-schema";
import type { Page, Route } from "@playwright/test";

export const ownerTrip: Api.TripResponse & { travel_updates: Api.TravelUpdateResponse[] } = {
  id: "trip-1",
  owner_subject: "e2e-owner",
  cover_derivative_id: null,
  cover_url: null,
  content_language: "nl",
  title: "Exampleland 2054",
  translation_freshness: {},
  title_nl: "Exampleland 2054",
  title_en: null,
  summary: "Three weeks around the island.",
  summary_nl: "Three weeks around the island.",
  summary_en: null,
  summary_html: "<p>Three weeks around the island.</p>",
  starts_on: "2054-11-01",
  ends_on: "2054-11-21",
  travel_updates: [],
};

/** The trip as the owner's list returns it: no embedded records, only how many updates it has. */
export const summaryOf = ({
  travel_updates,
  ...fields
}: Api.TripResponse & { travel_updates: unknown[] }): Api.TripSummaryResponse => ({
  ...fields,
  travel_update_count: travel_updates.length,
  last_update_at: null,
});

const publicTrip: Api.ProjectionDocument = {
  schema_version: "travel/public-trip@1",
  title: "Exampleland 2054",
  summary: "Three weeks around the island.",
  summary_html: "<p>Three weeks around the island.</p>",
  summary_text: "Three weeks around the island.",
  dates: { starts_on: "2054-11-01", ends_on: "2054-11-21", date_precision: "day" },
  cover: null,
  visits: [],
  places: [],
  updates: [],
  stays: [],
  media: [],
  routes: [],
  navigation: [],
} satisfies Api.ProjectionDocument;

const sharedTrip: Api.ProjectionDocument = {
  ...publicTrip,
  schema_version: "travel/unlisted-trip@1",
  title: "Shared Exampleland",
};

export const sharedToken = "share-token-1";

export const json = <T = never>(route: Route, body: NoInfer<T>, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** A 1×1 PNG, standing in for an owner photo's thumbnail. */
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** What the mocked owner API received: photos uploaded to the trip and travel updates saved to it. */
export type MockApiRecord = {
  uploads: { filename: string }[];
  updates: Api.TravelUpdateCreate[];
};

/** Answers the owner, public and shared APIs in the page; any other request leaves the machine only if it is local. */
export async function mockApi(page: Page): Promise<MockApiRecord> {
  const record: MockApiRecord = { uploads: [], updates: [] };
  const media = (): Api.MediaAssetResponse[] =>
    record.uploads.map((upload, index) => ({
      id: `photo-${index + 1}`,
      media_kind: "photo",
      byte_size: 100,
      content_type: "image/png",
      deleted_at: null,
      captured_at: null,
      captured_local: false,
      created_at: "2054-11-02T10:00:00Z",
      original_filename: upload.filename,
      camera_make: null,
      camera_model: null,
      gps: null,
      file_url: `/api/trips/${ownerTrip.id}/media/photo-${index + 1}/file`,
      thumbnail_url: `/api/trips/${ownerTrip.id}/media/photo-${index + 1}/thumbnail`,
    }));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname;

    if (path === "/api/public/trips") {
      return json<Api.PublicTripCard[]>(route, [
        {
          slug: "exampleland-2054",
          title: "Exampleland 2054",
          summary: "Three weeks around the island.",
          dates: null,
          cover: null,
          summary_text: "Three weeks around the island.",
        } satisfies Api.PublicTripCard,
      ]);
    }
    if (path === "/api/public/trips/exampleland-2054")
      return json<Api.ProjectionDocument>(route, publicTrip);
    if (path === `/api/shared/${sharedToken}`)
      return json<Api.ProjectionDocument>(route, sharedTrip);

    // Capture: choosing a photo uploads it, saving writes the update; both are kept for the test to inspect.
    if (
      route.request().method() === "POST" &&
      path === `/api/trips/${ownerTrip.id}/media/uploads`
    ) {
      const filename =
        /filename="([^"]*)"/.exec(route.request().postData() ?? "")?.[1] ?? "photo.png";
      record.uploads.push({ filename });
      return json<Api.MediaAssetResponse>(route, media().at(-1)!);
    }
    if (
      route.request().method() === "POST" &&
      path === `/api/trips/${ownerTrip.id}/travel-updates`
    ) {
      const body = JSON.parse(route.request().postData() ?? "{}") as Api.TravelUpdateCreate;
      record.updates.push(body);
      return json<Api.TravelUpdateResponse>(route, saved(body, record.updates.length - 1), 201);
    }
    if (route.request().method() !== "GET")
      return json<{ detail: string }>(route, { detail: "read-only mock" }, 405);
    if (path.includes("/media/") && (path.endsWith("/thumbnail") || path.endsWith("/file")))
      return route.fulfill({ status: 200, contentType: "image/png", body: pixel });
    if (path === `/api/trips/${ownerTrip.id}/media`)
      return json<Api.MediaAssetResponse[]>(route, media());
    if (path === "/api/trips")
      return json<Api.TripSummaryResponse[]>(route, [
        summaryOf({ ...ownerTrip, travel_updates: record.updates.map(saved) }),
      ]);
    if (path === `/api/trips/${ownerTrip.id}/travel-updates`)
      return json<Api.TravelUpdateResponse[]>(route, record.updates.map(saved));
    if (path === `/api/trips/${ownerTrip.id}/public-projection`) {
      return json<Api.PublicProjectionStatusResponse>(route, {
        ...unlabelled,
        revision: 1,
        trip_id: ownerTrip.id,
        scope: {
          schema_version: "travel/share-scope@1",
          trip: { title: true, summary: true, dates: "day" },
          items: [],
        },
        surface_state: "unpublished",
        slug: null,
      } satisfies Api.PublicProjectionStatusResponse);
    }
    if (path === `/api/trips/${ownerTrip.id}/overview`) {
      return json<Api.TripOverviewResponse>(route, {
        title: ownerTrip.title,
        starts_on: ownerTrip.starts_on,
        ends_on: ownerTrip.ends_on,
        trip_id: ownerTrip.id,
        counts: {},
        visibility: {},
        audiences: [],
        warnings: [],
      } satisfies Api.TripOverviewResponse);
    }
    if (path.startsWith("/api/trips/") && path.endsWith("/offline-map"))
      return json<{ detail: string }>(route, { detail: "none" }, 404);
    // Every other owner collection (stays, routes, documents, library, provider status...) is empty.
    return json<never[]>(route, []);
  });
  return record;
}

/** The server reads a wall clock typed without an offset in the update's zone, which these mocks always keep as UTC. */
const withInstant = (body: Api.TravelUpdateCreate) => {
  const typed = String(body.occurred_at ?? "");
  const occurred_at = /(Z|[+-]\d\d:\d\d)$/.test(typed) ? typed : `${typed}:00Z`;
  return { ...body, occurred_at, local_date: occurred_at.slice(0, 10) };
};

const savedDefaults = (
  id: string,
): Omit<Api.TravelUpdateResponse, "occurred_at" | "local_date"> => ({
  title: "",
  translation_freshness: {},
  title_nl: null,
  title_en: null,
  body_nl: null,
  body_en: null,
  area: null,
  body_html: null,
  private_notes_html: null,
  id,
  timezone: "UTC",
  share_date_precision: "day",
  body: "",
  area_id: null,
  visibility: "private",
  location: null,
  private_notes: null,
  media_asset_ids: [],
});

const saved = (body: Api.TravelUpdateCreate, index: number): Api.TravelUpdateResponse => ({
  ...savedDefaults(`update-${index + 1}`),
  ...withInstant(body),
  title: body.title ?? body.title_nl ?? body.title_en ?? "",
  body: body.body ?? body.body_nl ?? body.body_en ?? "",
  location: body.location
    ? {
        ...responseFixtures.LocationResponse,
        ...body.location,
        area_id: body.location.area_id ?? "synthetic",
      }
    : null,
});

/** The unsigned token the dev server seeds (`devSession` in vite.config.ts); the mocked API never checks it. */
export async function signInOwner(page: Page) {
  await page.addInitScript(() => {
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    sessionStorage.setItem(
      "travel-session",
      JSON.stringify({
        accessToken: `${encode({ alg: "none" })}.${encode({ sub: "e2e-owner" })}.`,
        expiresAt: Date.now() + 60 * 60 * 1000,
      }),
    );
  });
}

export async function choosePreferences(page: Page, locale: "nl" | "en", theme: "light" | "dark") {
  await page.addInitScript(
    ([storedLocale, storedTheme]) => {
      localStorage.setItem("travel-locale", storedLocale);
      localStorage.setItem("travel-appearance", storedTheme);
    },
    [locale, theme],
  );
}

/** A dated synthetic task for the readiness and overdue checks. */
export const overdueTask: Api.TripTaskResponse = {
  id: "readiness-task",
  title: "Arrange synthetic documents",
  due_date: "2000-01-02",
  completed_at: null,
  notes: null,
  notes_html: null,
  remind_at: null,
  reminded_at: null,
  links: [],
  created_at: "2000-01-01T00:00:00Z",
} satisfies Api.TripTaskResponse;

// --- Sharing presets (#241) ---

export const presetVisit = {
  translation_freshness: {},
  title_nl: null,
  title_en: null,
  kind: null,
  status: "idea",
  starts_on: null,
  ends_on: null,
  start_time: null,
  end_time: null,
  notes: null,
  summary: null,
  summary_nl: null,
  summary_en: null,
  share_time: false,
  share_date_precision: null,
  possible_route_duplicates: [],
  notes_html: null,
  summary_html: null,
  id: "visit-1",
  title: "Night market",
  area: {
    translation_freshness: {},
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
  location: null,
  visibility: "everyone",
} satisfies Api.VisitResponse;
export const presetArrival = {
  kind: "travel_update",
  id: "update-1",
  label: "Arrival in Taipei",
  day: null,
} as const;
const market = { kind: "visit", id: presetVisit.id, label: presetVisit.title, day: null } as const;

const scope = (items: Api.ShareScopeItem[] = []): Api.ShareScope =>
  ({
    schema_version: "travel/share-scope@1",
    trip: { title: true, summary: true, dates: null },
    defaults: { date_precision: "month" },
    items,
    exclude: [],
  }) satisfies Api.ShareScope;

type Label = Pick<
  Api.ShareLinkResponse,
  "applied_preset" | "applied_preset_at" | "preset_exceptions"
>;
const unlabelled: Label = {
  applied_preset: null,
  applied_preset_at: null,
  preset_exceptions: null,
};
const labelled: Label = {
  applied_preset: "story_and_route",
  applied_preset_at: "2054-01-02T00:00:00Z",
  preset_exceptions: { shown: [market], hidden: [], count: 1 },
};

const link = (
  state: "draft" | "active",
  revision: number,
  extra: Partial<Label> = {},
): Api.ShareLinkResponse =>
  ({
    revision,
    id: "link-1",
    series_id: "link-1",
    label: "Family",
    state,
    token: null,
    feed_token: null,
    feed_expires_at: null,
    exclusions: { excluded: [], also_hidden: {}, stale: 0 },
    expires_at: null,
    created_at: "2054-01-01T00:00:00Z",
    activated_at: null,
    revoked_at: null,
    scope: scope(),
    ...unlabelled,
    ...extra,
  }) satisfies Api.ShareLinkResponse;

const review = (id: string, kind: "public" | "link", live: boolean): Api.SharingPresetReview => ({
  schema_version: "travel/sharing-preset@1",
  preset: "story_and_route",
  audience: { id, kind, label: kind === "link" ? "Family" : null, live },
  applicable: true,
  refusal: null,
  changes: [{ ...presetArrival, action: "promote" }],
  change_counts: { promote: 1 },
  precision: { before: null, after: "month", changed: false, reads_coarser: {} },
  comparison: {
    before: { visit: 1 },
    after: { visit: 1, travel_update: 1 },
    added: { travel_update: 1 },
    removed: {},
    widened: [presetArrival],
    narrowed: [],
  },
  left_as_is: [{ ...market, reason: "everyone_on_public_view", way_out: "change_visibility" }],
  needs_decision: [],
  replaces_exceptions: [],
  requires_acknowledgement: live,
  fingerprint: "fingerprint-1",
});

/**
 * The sharing screens with one visit, a hidden link (`state`) and the preset review and apply routes (#241). The apply
 * records what it received and moves the link and the public view to their labelled, revision-2 state.
 */
export async function mockSharingPresets(page: Page, state: "draft" | "active") {
  const applies: { body: Record<string, unknown>; ifMatch: string | null; url: string }[] = [];
  let current = link(state, 1);
  let publicStatus = {
    revision: 1,
    trip_id: ownerTrip.id,
    scope: scope(),
    surface_state: "published",
    slug: "exampleland-2054",
    ...unlabelled,
  } satisfies Api.PublicProjectionStatusResponse;
  const base = `**/api/trips/${ownerTrip.id}`;
  await page.route(`${base}/visits`, (route) =>
    route.fulfill({ json: [presetVisit] satisfies Api.VisitResponse[] }),
  );
  await page.route(`${base}/audit-events`, (route) =>
    route.fulfill({ json: [] satisfies Api.AuditEventResponse[] }),
  );
  await page.route(`${base}/share-links`, (route) =>
    route.fulfill({ json: [current] satisfies Api.ShareLinkResponse[] }),
  );
  await page.route(`${base}/public-projection`, (route) =>
    route.fulfill({ json: publicStatus satisfies Api.PublicProjectionStatusResponse }),
  );
  await page.route(`${base}/overview`, (route) =>
    route.fulfill({
      json: {
        title: "synthetic",
        starts_on: null,
        ends_on: null,
        trip_id: ownerTrip.id,
        counts: {},
        visibility: {},
        warnings: [],
        audiences: [
          {
            numbers: {},
            excluded: 0,
            excluded_also_hides: {},
            kind: "share_link",
            id: "link-1",
            label: "Family",
            state,
            live: state === "active",
            shares_title: true,
            shares_summary: true,
            dates_precision: null,
            date_precision: "month",
            record_precision: {},
            scope_items: 0,
            delivered: { visits: 1, places: 0, stays: 0, routes: 0, updates: 0, media: 0 },
            without_map_point: { visits: 0, stays: 0, updates: 0 },
            shows_cover: false,
            preset: current.applied_preset,
            preset_exceptions: current.preset_exceptions?.count ?? 0,
          },
        ],
      } satisfies Api.TripOverviewResponse,
    }),
  );
  await page.route(`${base}/share-scope/exclusion-review`, (route) =>
    route.fulfill({
      json: {
        baseline: [{ kind: "visit", id: presetVisit.id }],
        excluded: [],
        also_hidden: {},
        stale: 0,
      } satisfies Api.ExclusionReview,
    }),
  );
  await page.route(`${base}/share-links/link-1/preset/review`, (route) =>
    route.fulfill({
      json: review("link:link-1", "link", state === "active") satisfies Api.SharingPresetReview,
    }),
  );
  await page.route(`${base}/share-links/link-1/preset`, (route) => {
    const request = route.request();
    applies.push({
      body: JSON.parse(request.postData() ?? "{}"),
      ifMatch: request.headers()["if-match"] ?? null,
      url: request.url(),
    });
    current = link(state, 2, labelled);
    return route.fulfill({
      json: {
        applied: true,
        review: review("link:link-1", "link", state === "active"),
        audience: current,
      } satisfies Api.LinkPresetApplyResult,
    });
  });
  await page.route(`${base}/public-projection/preset/review`, (route) =>
    route.fulfill({ json: review("public", "public", true) satisfies Api.SharingPresetReview }),
  );
  await page.route(`${base}/public-projection/preset`, (route) => {
    const request = route.request();
    applies.push({
      body: JSON.parse(request.postData() ?? "{}"),
      ifMatch: request.headers()["if-match"] ?? null,
      url: request.url(),
    });
    publicStatus = { ...publicStatus, revision: 2, ...labelled };
    return route.fulfill({
      json: {
        applied: true,
        review: review("public", "public", true),
        audience: publicStatus,
      } satisfies Api.PublicPresetApplyResult,
    });
  });
  return applies;
}
