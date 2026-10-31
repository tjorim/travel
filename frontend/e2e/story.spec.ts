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

async function open(
  page: Page,
  data: unknown,
  locale: "nl" | "en",
  theme: "light" | "dark",
  // Runs after the mocks, which abort every request that leaves localhost, so its routes take precedence.
  setup?: () => Promise<void>,
) {
  await mockApi(page);
  await setup?.();
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
          if (!data.updates.length) {
            await expect(
              page.getByRole("button", {
                name: locale === "en" ? "Choose an update" : "Kies een update",
              }),
            ).toHaveCount(0);
          }
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
  // The story shares the overview's column, so the map stays beside it as the reader goes down.
  const story = await page.getByRole("region", { name: "Updates" }).boundingBox();
  expect(Math.abs(story!.x - wideOverview!.x)).toBeLessThan(2);
  expect(story!.x + story!.width).toBeLessThanOrEqual(wideMap!.x);

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
  // With the map beside the story the index is folded away at every width, as on a narrow screen.
  await page.getByRole("button", { name: "Choose an update" }).click();
  await page
    .getByRole("navigation", { name: "Updates in this story" })
    .getByRole("link", { name: "Market day" })
    .click();
  await expect(page).toHaveURL(/#update-b$/);
  await expect(page.locator("#update-b")).toBeInViewport();
});

for (const audience of ["public", "share"] as const) {
  for (const locale of ["en", "nl"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`responsive update chooser ${audience} ${locale} ${theme}`, async ({ page }) => {
        const path = audience === "public" ? "/trips/exampleland-2054" : "/share/synthetic";
        const api =
          audience === "public" ? "/api/public/trips/exampleland-2054" : "/api/shared/synthetic";
        const updates = Array.from({ length: 24 }, (_, i) => ({
          id: `update-${i}`,
          title: `Synthetic authored update ${i + 1}`,
          body: "Synthetic story.",
        }));
        await mockApi(page);
        await page.route(`**${api}`, (route) =>
          route.fulfill({
            json: trip({
              schema_version:
                audience === "public" ? "travel/public-trip@1" : "travel/unlisted-trip@1",
              updates,
              cover: null,
              media: [],
            }),
          }),
        );
        await choosePreferences(page, locale, theme);
        await page.setViewportSize({ width: 1099, height: 800 });
        await page.goto(`${path}#update-23`);
        const target = page.locator("#update-23");
        await expect(target).toBeFocused();
        await expect(target).toBeInViewport();
        const chooser = page.getByRole("button", {
          name: locale === "en" ? "Choose an update" : "Kies een update",
        });
        await expect(chooser).toHaveAttribute("aria-expanded", "false");
        await expect(chooser).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await page.goto(path);
        const history = await page.evaluate(() => window.history.length);
        await chooser.focus();
        await page.keyboard.press("Enter");
        expect(await page.evaluate(() => window.history.length)).toBe(history);
        const nav = page.getByRole("navigation", {
          name: locale === "en" ? "Updates in this story" : "Updates in dit verhaal",
        });
        await expect(nav.getByRole("link")).toHaveCount(24);
        for (let i = 0; i < 24; i++) await page.keyboard.press("Tab");
        await expect(
          nav.getByRole("link", { name: "Synthetic authored update 24", exact: true }),
        ).toBeFocused();
        await expect(page.locator("a:focus")).toHaveAttribute("href", "#update-23");
        await page.keyboard.press("Enter");
        await expect(target).toBeFocused();
        await expect(target).toBeInViewport();
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await page.setViewportSize({ width: 1100, height: 800 });
        await expect(chooser).toBeHidden();
        await expect(nav.getByRole("link")).toHaveCount(24);
        await page.setViewportSize({ width: 390, height: 844 });
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      });
    }
  }
}

for (const locale of ["en", "nl"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const variant of ["cover", "failed cover", "empty"] as const) {
      test(`shared disclosure ${variant} ${locale} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await mockApi(page);
        await page.route("**/api/shared/synthetic", (route) =>
          route.fulfill({
            json: trip({
              schema_version: "travel/unlisted-trip@1",
              ...(variant === "empty" ? { updates: [], media: [], cover: null } : {}),
            }),
          }),
        );
        await page.route("**/api/shared/synthetic/files/*", (route) =>
          variant === "failed cover"
            ? route.abort()
            : route.fulfill({ contentType: "image/svg+xml", body: coverSvg(0) }),
        );
        await choosePreferences(page, locale, theme);
        await page.goto("/share/synthetic");
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const chooser = page.getByRole("button", {
          name: locale === "en" ? "Choose an update" : "Kies een update",
        });
        if (variant === "empty") await expect(chooser).toHaveCount(0);
        else {
          await expect(chooser).toHaveAttribute("aria-expanded", "false");
          await chooser.click();
          await expect(page.getByRole("link", { name: "Market day", exact: true })).toBeVisible();
        }
        if (variant === "cover") await expect(page.locator("header img")).toBeVisible();
        else await expect(page.locator("header img")).toHaveCount(0);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      });
    }
  }
}

test("a row of photos has arrows that page it, hidden at each end", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, trip(), "en", "light");
  const strip = page.locator("ul.snap-x").first();
  const next = page.getByRole("button", { name: "Next photo" });
  const previous = page.getByRole("button", { name: "Previous photo" });
  await expect(next).toBeVisible();
  await expect(previous).toBeHidden();
  await next.click();
  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(previous).toBeVisible();
});

test("the map sits beside the story, follows the update in view and pins its photo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await open(page, trip(), "en", "light", async () => {
    // A one-layer style keeps the map off the network; it only has to load.
    await page.route("https://tiles.openfreemap.org/styles/*", (route) =>
      route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: {
          version: 8,
          sources: {},
          glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#dfe8e1" } },
          ],
        },
      }),
    );
    await page.route("https://tiles.openfreemap.org/fonts/**", (route) =>
      route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" }),
    );
  });
  const map = page.locator("[data-story-map]");
  await expect(map).toBeVisible();
  await expect(map).toHaveCSS("position", "sticky");
  const story = page.getByRole("region", { name: "Updates" });
  const [mapBox, storyBox] = [await map.boundingBox(), await story.boundingBox()];
  expect(mapBox!.x).toBeGreaterThan(storyBox!.x + storyBox!.width - 1);
  // The update that has a place gets one photo marker, hidden from assistive technology (the point buttons serve it).
  const marker = page.locator(".travel-map-photo");
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute("aria-hidden", "true");
  await expect(marker).toHaveAttribute("title", "Arrival");
  await expect(marker.locator("img")).toHaveAttribute("src", /\/files\/media-/);
  // Scrolling to the update marks its point as followed; the second update has no place and leaves it.
  await page.locator("#update-a").scrollIntoViewIfNeeded();
  await expect(marker).toHaveAttribute("data-active", "");
  // On a narrow screen the map sits above the story instead of beside it.
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(map).toHaveCSS("position", "static");
});
