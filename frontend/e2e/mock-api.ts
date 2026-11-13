import type { Page, Route } from "@playwright/test";

export const ownerTrip = {
  id: "trip-1",
  title: "Exampleland 2054",
  summary: "Three weeks around the island.",
  summary_html: "<p>Three weeks around the island.</p>",
  starts_on: "2054-11-01",
  ends_on: "2054-11-21",
  travel_updates: [],
};

/** The trip as the owner's list returns it: no embedded records, only how many updates it has. */
export const summaryOf = ({
  travel_updates,
  ...fields
}: { travel_updates: unknown[] } & Record<string, unknown>) => ({
  ...fields,
  travel_update_count: travel_updates.length,
  last_update_at: null,
});

const publicTrip = {
  schema_version: "travel/public-trip@1",
  title: "Exampleland 2054",
  summary: "Three weeks around the island.",
  summary_html: "<p>Three weeks around the island.</p>",
  summary_text: "Three weeks around the island.",
  dates: { starts_on: "2054-11-01", ends_on: "2054-11-21" },
  visits: [],
  places: [],
  updates: [],
  stays: [],
  media: [],
  routes: [],
  navigation: [],
};

const sharedTrip = {
  ...publicTrip,
  schema_version: "travel/unlisted-trip@1",
  title: "Shared Exampleland",
};

export const sharedToken = "share-token-1";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** A 1×1 PNG, standing in for an owner photo's thumbnail. */
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** What the mocked owner API received: photos uploaded to the trip and travel updates saved to it. */
export type MockApiRecord = {
  uploads: { filename: string }[];
  updates: Record<string, unknown>[];
};

/** Answers the owner, public and shared APIs in the page; any other request leaves the machine only if it is local. */
export async function mockApi(page: Page): Promise<MockApiRecord> {
  const record: MockApiRecord = { uploads: [], updates: [] };
  const media = () =>
    record.uploads.map((upload, index) => ({
      id: `photo-${index + 1}`,
      media_kind: "photo",
      byte_size: 100,
      content_type: "image/png",
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
      return json(route, [
        {
          slug: "exampleland-2054",
          title: "Exampleland 2054",
          summary: "Three weeks around the island.",
          dates: null,
        },
      ]);
    }
    if (path === "/api/public/trips/exampleland-2054") return json(route, publicTrip);
    if (path === `/api/shared/${sharedToken}`) return json(route, sharedTrip);

    // Capture: choosing a photo uploads it, saving writes the update; both are kept for the test to inspect.
    if (
      route.request().method() === "POST" &&
      path === `/api/trips/${ownerTrip.id}/media/uploads`
    ) {
      const filename =
        /filename="([^"]*)"/.exec(route.request().postData() ?? "")?.[1] ?? "photo.png";
      record.uploads.push({ filename });
      return json(route, media().at(-1));
    }
    if (
      route.request().method() === "POST" &&
      path === `/api/trips/${ownerTrip.id}/travel-updates`
    ) {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      record.updates.push(body);
      return json(
        route,
        {
          id: `update-${record.updates.length}`,
          date_precision: "day",
          body: "",
          area_id: null,
          visibility: "private",
          location: null,
          ...body,
        },
        201,
      );
    }
    if (route.request().method() !== "GET") return json(route, { detail: "read-only mock" }, 405);
    if (path.includes("/media/") && (path.endsWith("/thumbnail") || path.endsWith("/file")))
      return route.fulfill({ status: 200, contentType: "image/png", body: pixel });
    if (path === `/api/trips/${ownerTrip.id}/media`) return json(route, media());
    if (path === "/api/trips")
      return json(route, [summaryOf({ ...ownerTrip, travel_updates: record.updates.map(saved) })]);
    if (path === `/api/trips/${ownerTrip.id}/travel-updates`)
      return json(route, record.updates.map(saved));
    if (path === `/api/trips/${ownerTrip.id}/public-projection`) {
      return json(route, {
        revision: 1,
        trip_id: ownerTrip.id,
        scope: {
          schema_version: "travel/share-scope@1",
          trip: { title: true, summary: true, dates: "day" },
          items: [],
        },
        surface_state: "unpublished",
        slug: null,
      });
    }
    if (path === `/api/trips/${ownerTrip.id}/overview`) {
      return json(route, {
        trip_id: ownerTrip.id,
        counts: {},
        visibility: {},
        audiences: [],
        warnings: [],
      });
    }
    if (path.startsWith("/api/trips/") && path.endsWith("/offline-map"))
      return json(route, { detail: "none" }, 404);
    // Every other owner collection (stays, routes, documents, library, provider status...) is empty.
    return json(route, []);
  });
  return record;
}

const saved = (body: Record<string, unknown>, index: number) => ({
  id: `update-${index + 1}`,
  date_precision: "day",
  body: "",
  area_id: null,
  visibility: "private",
  location: null,
  private_notes: null,
  media_asset_ids: [],
  ...body,
});

/** The unsigned token the dev server seeds (`devSession` in vite.config.ts); the mocked API never checks it. */
export async function signInOwner(page: Page) {
  await page.addInitScript(() => {
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    sessionStorage.setItem(
      "travel-tracker-session",
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
export const overdueTask = {
  id: "readiness-task",
  title: "Arrange synthetic documents",
  due_date: "2000-01-02",
  completed_at: null,
  notes: null,
  remind_at: null,
  reminded_at: null,
  links: [],
  created_at: "2000-01-01T00:00:00Z",
};

// --- Sharing presets (#241) ---

export const presetVisit = {
  id: "visit-1",
  title: "Night market",
  area: { label: "Taipei" },
  location: null,
  visibility: "everyone",
};
export const presetArrival = { kind: "travel_update", id: "update-1", label: "Arrival in Taipei" };
const market = { kind: "visit", id: presetVisit.id, label: presetVisit.title };

const scope = (items: { kind: string; id: string }[] = []) => ({
  schema_version: "travel/share-scope@1",
  trip: { title: true, summary: true, dates: null },
  defaults: { date_precision: "month" },
  items,
  exclude: [],
});

type Label = {
  applied_preset: string | null;
  applied_preset_at: string | null;
  preset_exceptions: { shown: unknown[]; hidden: unknown[]; count: number } | null;
};
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

const link = (state: "draft" | "active", revision: number, extra: Partial<Label> = {}) => ({
  revision,
  id: "link-1",
  series_id: "link-1",
  label: "Family",
  state,
  token: null,
  expires_at: null,
  created_at: "2054-01-01T00:00:00Z",
  activated_at: null,
  revoked_at: null,
  scope: scope(),
  ...unlabelled,
  ...extra,
});

const review = (id: string, kind: "public" | "link", live: boolean) => ({
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
  };
  const base = `**/api/trips/${ownerTrip.id}`;
  await page.route(`${base}/visits`, (route) => route.fulfill({ json: [presetVisit] }));
  await page.route(`${base}/audit-events`, (route) => route.fulfill({ json: [] }));
  await page.route(`${base}/share-links`, (route) => route.fulfill({ json: [current] }));
  await page.route(`${base}/public-projection`, (route) => route.fulfill({ json: publicStatus }));
  await page.route(`${base}/overview`, (route) =>
    route.fulfill({
      json: {
        trip_id: ownerTrip.id,
        counts: {},
        visibility: {},
        warnings: [],
        audiences: [
          {
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
      },
    }),
  );
  await page.route(`${base}/share-scope/exclusion-review`, (route) =>
    route.fulfill({
      json: {
        baseline: [{ kind: "visit", id: presetVisit.id }],
        excluded: [],
        also_hidden: {},
        stale: 0,
      },
    }),
  );
  await page.route(`${base}/share-links/link-1/preset/review`, (route) =>
    route.fulfill({ json: review("link:link-1", "link", state === "active") }),
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
      },
    });
  });
  await page.route(`${base}/public-projection/preset/review`, (route) =>
    route.fulfill({ json: review("public", "public", true) }),
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
      json: { applied: true, review: review("public", "public", true), audience: publicStatus },
    });
  });
  return applies;
}
