import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { choosePreferences, mockApi, signInOwner } from "./mock-api";

// Synthetic content only; the evidence images contain no owner trip data.
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const update = (id: string, title: string, offset: number) => ({
  id,
  title,
  occurred_at: new Date(Date.now() + offset * 3_600_000).toISOString(),
  date_precision: "day",
  body: "",
  private_notes: null,
  area_id: null,
  location: null,
  media_asset_ids: [],
  visibility: "private",
});
const trip = (id: string, title: string, starts: number | null, ends: number | null) => ({
  id,
  title,
  summary: null,
  starts_on: starts === null ? null : day(starts),
  ends_on: ends === null ? null : day(ends),
  cover_url: null as string | null,
  travel_updates: [] as ReturnType<typeof update>[],
});

const coverPath = "/api/trips/trip-active/media/m1/derivatives/d1/file";
const active = {
  ...trip("trip-active", "A slow journey through mountains, forests and small towns", -2, 5),
  cover_url: coverPath,
  travel_updates: [update("u1", "Arrived in the valley", -30), update("u2", "First hike", -5)],
};
const trips = [
  trip("trip-past", "Weekend in the Ardennes", -90, -88),
  trip("trip-planned", "AnUnbrokenAuthoredTitle".repeat(6), null, null),
  trip("trip-upcoming", "Iceland", 30, 40),
  active,
];

const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#6a8f7a"/><circle cx="650" cy="170" r="70" fill="#f0c860"/><path d="M0 600V380l220-150 190 130 160-110 330 200v150z" fill="#2b4f40"/></svg>`;

async function open(page: Page, path: string, locale: "nl" | "en", theme: "light" | "dark") {
  await mockApi(page);
  await signInOwner(page);
  await page.route("**/api/trips", (route) => route.fulfill({ json: trips }));
  await page.route("**/api/trips/trip-active/task-alerts", (route) =>
    route.fulfill({
      json: [
        {
          id: "alert",
          task_id: "task",
          kind: "reminder",
          title: "Check in online",
          scheduled_for: new Date().toISOString(),
          created_at: new Date().toISOString(),
          read_at: null,
          email_sent_at: null,
          email_attempts: 0,
          email_last_error: null,
        },
      ],
    }),
  );
  await page.route("**/api/trips/trip-active/public-projection", (route) =>
    route.fulfill({
      json: {
        trip_id: "trip-active",
        scope: { schema_version: "travel/share-scope@1", trip: { title: true }, items: [] },
        surface_state: "published",
        slug: "slow-journey",
      },
    }),
  );
  await page.route(`**${coverPath}`, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: cover }),
  );
  await choosePreferences(page, locale, theme);
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

const screens = [
  { name: "home", path: "/admin/", heading: /Where would|Waar wil/, level: 1 },
  { name: "trips", path: "/admin/trips", heading: /^(Trips|Reizen)$/, level: 2 },
  {
    name: "workspace",
    path: "/admin/trips/trip-active",
    heading: /A slow journey/,
    level: 2,
  },
] as const;

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [360, 820, 1920]) {
      for (const screen of screens) {
        test(`owner ${screen.name} ${locale} ${theme} ${width}`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height: 1000 });
          await open(page, screen.path, locale, theme);
          await expect(
            page.getByRole("heading", { name: screen.heading, level: screen.level }).first(),
          ).toBeVisible();
          // The cover and every card have settled before measuring.
          if (screen.name !== "trips") await expect(page.locator("main img").first()).toBeVisible();
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
          expect(results.violations.map((violation) => violation.id)).toEqual([]);
          await page.screenshot({ path: testInfo.outputPath("owner.png"), fullPage: true });
        });
      }
    }
  }
}

test("the trip list groups by state and opens a trip as a link", async ({ page }) => {
  await open(page, "/admin/trips", "en", "light");
  const groups = page.getByRole("heading", { level: 3 });
  await expect(groups).toHaveText(["Now and soon", "Still to plan", "Past trips"]);
  await page.getByRole("link", { name: /Iceland/ }).click();
  await expect(page).toHaveURL(/\/admin\/trips\/trip-upcoming$/);
});

test("the home page continues the trip under way and shows the inbox beside it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await open(page, "/admin/", "en", "light");
  const featured = page.locator("article").first();
  await expect(featured.getByText("Travelling now")).toBeVisible();
  await expect(featured.getByRole("link", { name: "Open trip" })).toBeVisible();
  const inbox = page.getByRole("heading", { name: "Inbox" });
  const list = page.getByRole("heading", { name: "Now and soon" });
  const [inboxBox, listBox] = await Promise.all([inbox.boundingBox(), list.boundingBox()]);
  // On a wide screen the inbox sits in the column beside the trips, not under them.
  expect(inboxBox!.x).toBeGreaterThan(listBox!.x + 300);
  expect(inboxBox!.y).toBeLessThan(listBox!.y + 200);
});

test("the workspace header states publication and keeps the tabs reachable on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page, "/admin/trips/trip-active", "en", "light");
  await expect(page.getByText("Public page live")).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Trip sections" });
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // The bottom bar and the capture button are both in view and do not overlap.
  const bar = await page.getByRole("navigation", { name: "App navigation" }).boundingBox();
  const capture = await page.getByRole("button", { name: /Capture/ }).boundingBox();
  expect(capture!.y + capture!.height).toBeLessThanOrEqual(bar!.y);
});

test("the overview puts the map beside the trip context on a wide screen", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await open(page, "/admin/trips/trip-active", "en", "light");
  const updates = await page.getByRole("heading", { name: "Travel updates" }).boundingBox();
  const map = await page.getByRole("heading", { name: "Map", exact: true }).boundingBox();
  expect(map!.x).toBeGreaterThan(updates!.x + 300);
});
