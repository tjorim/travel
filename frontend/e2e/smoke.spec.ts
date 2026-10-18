import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { locales, message, type Locale } from "./messages";
import { choosePreferences, mockApi, ownerTrip, sharedToken, signInOwner } from "./mock-api";

const themes = ["light", "dark"] as const;
const narrow = { width: 360, height: 740 };

async function open(
  page: Page,
  path: string,
  locale: Locale,
  theme: (typeof themes)[number],
  owner = false,
) {
  await mockApi(page);
  if (owner) await signInOwner(page);
  await choosePreferences(page, locale, theme);
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

// The scanned screens: each one is loaded and has settled when its heading is visible.
const screens = (locale: Locale) => [
  {
    name: "public trip index",
    path: "/trips",
    owner: false,
    ready: (page: Page) => page.getByRole("heading", { name: ownerTrip.title, level: 2 }),
  },
  {
    name: "public trip",
    path: "/trips/exampleland-2054",
    owner: false,
    ready: (page: Page) => page.getByRole("heading", { name: ownerTrip.title, level: 1 }),
  },
  {
    name: "shared trip",
    path: `/share/${sharedToken}`,
    owner: false,
    ready: (page: Page) => page.getByRole("heading", { name: "Shared Exampleland", level: 1 }),
  },
  {
    name: "owner trips",
    path: "/admin/trips",
    owner: true,
    ready: (page: Page) => page.getByRole("heading", { name: message(locale, "trips"), level: 2 }),
  },
  {
    name: "owner trip plan",
    path: `/admin/trips/${ownerTrip.id}/plan`,
    owner: true,
    ready: (page: Page) =>
      page.getByRole("button", { name: new RegExp(`^${message(locale, "owner_agenda")}`) }),
  },
  {
    name: "owner trip workspace",
    path: `/admin/trips/${ownerTrip.id}`,
    owner: true,
    ready: (page: Page) => page.getByRole("heading", { name: ownerTrip.title, level: 2 }),
  },
];

test.describe("visitor views", () => {
  test("the trip index links to a public trip", async ({ page }) => {
    await open(page, "/trips", "en", "light");
    await page.getByRole("link", { name: new RegExp(ownerTrip.title) }).click();
    await expect(page).toHaveURL(/\/trips\/exampleland-2054$/);
    await expect(page.getByRole("heading", { name: ownerTrip.title, level: 1 })).toBeVisible();
  });

  test("an unlisted share link renders its trip and unknown links are unavailable", async ({
    page,
  }) => {
    await open(page, `/share/${sharedToken}`, "en", "light");
    await expect(page.getByRole("heading", { name: "Shared Exampleland", level: 1 })).toBeVisible();
    // The capability route is never cached or sent on as a referrer (vite.config.ts mirrors Caddy).
    const response = await page.request.get(`/share/${sharedToken}`);
    expect(response.headers()["cache-control"]).toBe("no-store, private");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  });

  test("a missing share link is reported as unavailable", async ({ page }) => {
    await mockApi(page);
    await page.route("**/api/shared/gone", (route) => route.fulfill({ status: 404, body: "{}" }));
    await choosePreferences(page, "nl", "light");
    await page.goto("/share/gone");
    await expect(
      page.getByRole("heading", { name: message("nl", "unavailable_trip") }),
    ).toBeVisible();
  });
});

test.describe("owner navigation", () => {
  test("moves between the owner sections", async ({ page }) => {
    await open(page, "/admin/", "en", "light", true);
    const nav = page.getByRole("navigation").first();
    for (const key of ["trips", "library", "settings"]) {
      await nav.getByRole("link", { name: message("en", key), exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/${key}$`));
      await expect(page.getByRole("heading", { name: message("en", key), level: 2 })).toBeVisible();
    }
  });

  test("the site nav lists places only; Capture is a button that locks to the trip you are in", async ({
    page,
  }) => {
    await open(page, `/admin/trips/${ownerTrip.id}`, "en", "light", true);
    const nav = page.getByRole("navigation", { name: message("en", "navigation") });
    await expect(nav.getByRole("link")).toHaveText(["Home", "Trips", "Library", "Settings"]);
    await expect(nav.getByRole("link", { name: "Trips" })).toHaveAttribute("aria-current", "page");
    // The trip header says where you are.
    const here = page.getByRole("navigation", { name: message("en", "breadcrumb") });
    await expect(here.getByRole("link", { name: "Trips" })).toBeVisible();
    await expect(here.getByText(ownerTrip.title)).toHaveAttribute("aria-current", "page");

    await page.getByRole("button", { name: message("en", "owner_capture_in_trip") }).click();
    await expect(
      page.getByRole("heading", { name: `Capture a moment — ${ownerTrip.title}` }),
    ).toBeVisible();
  });

  test("walks the trip workspace tabs", async ({ page }) => {
    await open(page, `/admin/trips/${ownerTrip.id}`, "en", "light", true);
    const tabs = page.getByRole("navigation", { name: message("en", "owner_trip_sections") });
    await expect(tabs.getByRole("link", { name: message("en", "owner_overview") })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const [key, section] of [
      ["owner_plan", "plan"],
      ["owner_prepare", "prepare"],
      ["owner_packing", "packing"],
      ["owner_story", "story"],
      ["owner_sharing", "sharing"],
    ] as const) {
      await tabs.getByRole("link", { name: message("en", key) }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/trips/${ownerTrip.id}/${section}$`));
      await expect(tabs.getByRole("link", { name: message("en", key) })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByRole("heading", { name: ownerTrip.title, level: 2 })).toBeVisible();
    }
  });
});

test.describe("deferred owner views", () => {
  test("a view whose chunk fails to load keeps the shell usable and recovers on reload", async ({
    page,
  }) => {
    await open(page, "/admin/", "en", "light", true);
    const nav = page.getByRole("navigation").first();
    let blocked = true;
    await page.route(/\/src\/pages\/Library\.tsx/, (route) =>
      blocked ? route.abort("failed") : route.continue(),
    );
    await nav.getByRole("link", { name: message("en", "library"), exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/library$/);
    await expect(page.getByRole("alert")).toContainText(message("en", "owner_view_unavailable"));
    await expect(
      nav.getByRole("link", { name: message("en", "settings"), exact: true }),
    ).toBeVisible();

    // A browser remembers a failed import for the life of the page, so recovery is a reload of the same URL.
    blocked = false;
    await page.getByRole("button", { name: message("en", "owner_view_reload") }).click();
    await expect(
      page.getByRole("heading", { name: message("en", "library"), level: 2 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/library$/);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  for (const theme of themes) {
    test(`the unavailable view has no axe violations (narrow, ${theme})`, async ({ page }) => {
      await page.setViewportSize(narrow);
      await open(page, "/admin/", "en", theme, true);
      await page.route(/\/src\/pages\/Library\.tsx/, (route) => route.abort("failed"));
      await page
        .getByRole("navigation")
        .first()
        .getByRole("link", { name: message("en", "library"), exact: true })
        .click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }

  test("a link to the old media tab lands on the story tab", async ({ page }) => {
    await open(page, `/admin/trips/${ownerTrip.id}/media`, "en", "light", true);
    await expect(page).toHaveURL(new RegExp(`/admin/trips/${ownerTrip.id}/story$`));
    await expect(page.getByRole("button", { name: /Media library/ })).toBeVisible();
  });

  test("the jump search opens a block of a tab and scrolls to it", async ({ page }) => {
    await open(page, `/admin/trips/${ownerTrip.id}`, "en", "light", true);
    const search = page.getByRole("combobox", { name: message("en", "owner_jump_to") });
    await search.fill("routes");
    await page.getByRole("option", { name: /Plan › Routes/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/trips/${ownerTrip.id}/plan#routes$`));
    await expect(page.getByRole("button", { name: /^Routes/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByRole("button", { name: /^Stays/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("opens a deferred workspace tab directly from its link", async ({ page }) => {
    await open(page, `/admin/trips/${ownerTrip.id}/plan`, "en", "light", true);
    await expect(page.getByRole("button", { name: /^Agenda/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

test.describe("accessibility", () => {
  test.use({ viewport: narrow });
  for (const locale of locales) {
    for (const theme of themes) {
      for (const screen of screens(locale)) {
        test(`${screen.name} has no axe violations (${locale}, ${theme}, narrow)`, async ({
          page,
        }) => {
          await open(page, screen.path, locale, theme, screen.owner);
          await expect(screen.ready(page).first()).toBeVisible();
          await expectNoAxeViolations(page);
          // A narrow layout must not need sideways scrolling.
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow).toBeLessThanOrEqual(0);
        });
      }
    }
  }
});
