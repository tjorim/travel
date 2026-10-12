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

const sharedTrip = { ...publicTrip, schema_version: "travel/unlisted-trip@1", title: "Shared Exampleland" };

export const sharedToken = "share-token-1";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Answers the owner, public and shared APIs in the page; any other request leaves the machine only if it is local. */
export async function mockApi(page: Page) {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname;

    if (path === "/api/public/trips") {
      return json(route, [
        { slug: "exampleland-2054", title: "Exampleland 2054", summary: "Three weeks around the island.", dates: null },
      ]);
    }
    if (path === "/api/public/trips/exampleland-2054") return json(route, publicTrip);
    if (path === `/api/shared/${sharedToken}`) return json(route, sharedTrip);

    if (route.request().method() !== "GET") return json(route, { detail: "read-only mock" }, 405);
    if (path === "/api/trips") return json(route, [ownerTrip]);
    if (path === `/api/trips/${ownerTrip.id}/public-projection`) {
      return json(route, {
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
      return json(route, { trip_id: ownerTrip.id, counts: {}, visibility: {}, audiences: [], warnings: [] });
    }
    if (path.startsWith("/api/trips/") && path.endsWith("/offline-map")) return json(route, { detail: "none" }, 404);
    // Every other owner collection (stays, routes, documents, library, provider status...) is empty.
    return json(route, []);
  });
}

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
