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
      return json(route, [{ ...ownerTrip, travel_updates: record.updates.map(saved) }]);
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
