import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { choosePreferences, mockApi } from "./mock-api";

// Synthetic authored content only; evidence contains no owner trip data.
const lorem =
  "A slow morning on the quay, then the market, then a long walk back along the water. ".repeat(12);
const area = (label: string, latitude: number, longitude: number) => ({
  label,
  country_code: "TW",
  region: null,
  latitude,
  longitude,
});
const photos = Array.from({ length: 9 }, (_, index) => ({
  id: `media-${index}`,
  image: { id: `media-${index}` },
  alt_text: `Synthetic photo ${index}`,
  caption: `Caption ${index}`,
  width: 1200,
  height: index % 2 ? 1600 : 800,
  focal_x: 50,
  focal_y: 50,
}));
const trip = (overrides: Record<string, unknown> = {}) => ({
  schema_version: "travel/public-trip@1",
  title: "Exampleland 2054",
  summary: "Three weeks around the island.",
  summary_html: "<p>Three weeks around the island.</p>",
  summary_text: "Three weeks around the island.",
  dates: { starts_on: "2054-11-01", ends_on: "2054-11-21", date_precision: "day" },
  cover: "media-0",
  visits: [
    { id: "visit-1", title: "Harbour", place: area("Keelung", 25.13, 121.74) },
    { id: "visit-2", title: "Old street", place: area("Tainan", 22.99, 120.21) },
  ],
  places: [],
  updates: [
    {
      id: "update-a",
      title: "Arrival",
      body: lorem,
      body_html: `<p>${lorem}</p>`,
      story_date: "2054-11-01",
      date_precision: "day",
      place: area("Keelung", 25.13, 121.74),
    },
    {
      id: "update-b",
      title: "Market day",
      body: "Short note.",
      body_html: "<p>Short note.</p>",
      story_date: "2054-11-04",
      date_precision: "day",
    },
  ],
  stays: [],
  media: photos.map((photo, index) => (index < 3 ? { ...photo, update: "update-a" } : photo)),
  routes: [],
  navigation: [],
  ...overrides,
});

const coverSvg = (index: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="${index % 2 ? "#6a8f7d" : "#c9a95a"}"/><circle cx="800" cy="450" r="220" fill="#f6f1e7"/></svg>`;

async function open(page: Page, data: unknown, locale: "nl" | "en", theme: "light" | "dark") {
  await mockApi(page);
  await page.route("**/api/public/trips/exampleland-2054", (route) =>
    route.fulfill({ json: data }),
  );
  await page.route("**/api/public/trips/exampleland-2054/files/*", (route) => {
    const id = Number(route.request().url().split("media-")[1]);
    return route.fulfill({ contentType: "image/svg+xml", body: coverSvg(id) });
  });
  await choosePreferences(page, locale, theme);
  await page.goto("/trips/exampleland-2054");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const cases = {
  cover: trip(),
  "text only": trip({ cover: null }),
  "long title": trip({
    title: "A slow journey through mountains, forests and small towns along the coast",
  }),
  sparse: trip({
    title: null,
    summary: null,
    summary_html: null,
    summary_text: null,
    dates: null,
    cover: null,
    visits: [],
    updates: [],
    media: [],
  }),
};

for (const [name, data] of Object.entries(cases)) {
  for (const locale of ["nl", "en"] as const) {
    for (const theme of ["light", "dark"] as const) {
      for (const width of [360, 820, 1920]) {
        test(`story ${name} ${locale} ${theme} ${width}`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height: 1000 });
          await open(page, data, locale, theme);
          if (data.cover) {
            const image = page.locator("header img");
            await expect(image).toBeVisible();
            await expect
              .poll(() => image.evaluate((img: HTMLImageElement) => img.complete))
              .toBe(true);
          } else {
            await expect(page.locator("header img")).toHaveCount(0);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
          expect(
            (
              await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
                .analyze()
            ).violations.map((violation) => violation.id),
          ).toEqual([]);
          await page.screenshot({ path: testInfo.outputPath("story.png"), fullPage: true });
        });
      }
    }
  }
}

test("wide screens put trip context beside the map and stack it on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await open(page, trip(), "en", "light");
  const overview = page.getByRole("region", { name: "Trip overview" });
  const map = page.getByRole("region", { name: "Trip map" });
  const [wideOverview, wideMap] = await Promise.all([overview.boundingBox(), map.boundingBox()]);
  expect(wideOverview!.x + wideOverview!.width).toBeLessThanOrEqual(wideMap!.x);
  expect(Math.abs(wideOverview!.y - wideMap!.y)).toBeLessThan(2);
  expect(wideMap!.width).toBeGreaterThan(wideOverview!.width);

  await page.setViewportSize({ width: 360, height: 800 });
  const [narrowOverview, narrowMap] = await Promise.all([
    overview.boundingBox(),
    map.boundingBox(),
  ]);
  expect(narrowOverview!.y + narrowOverview!.height).toBeLessThanOrEqual(narrowMap!.y);
});

test("a cover that cannot load falls back to the text-only header", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1000 });
  await mockApi(page);
  await page.route("**/api/public/trips/exampleland-2054", (route) =>
    route.fulfill({ json: trip() }),
  );
  await page.route("**/api/public/trips/exampleland-2054/files/media-0", (route) => route.abort());
  await choosePreferences(page, "en", "light");
  await page.goto("/trips/exampleland-2054");
  await expect(page.getByRole("heading", { level: 1, name: "Exampleland 2054" })).toBeVisible();
  await expect(page.locator("header img")).toHaveCount(0);
});

test("story navigation keeps its anchors and opens the chosen update", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await open(page, trip(), "en", "light");
  await page
    .getByRole("navigation", { name: "Updates in this story" })
    .getByRole("link", { name: "Market day" })
    .click();
  await expect(page).toHaveURL(/#update-b$/);
  await expect(page.locator("#update-b")).toBeInViewport();
});
