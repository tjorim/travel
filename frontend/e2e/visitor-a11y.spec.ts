import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { choosePreferences, mockApi } from "./mock-api";

// Synthetic content only. The authored bodies hold `##` headings, which the server renders as h5.
const area = (label: string, latitude: number, longitude: number) => ({
  label,
  country_code: "TW",
  region: null,
  latitude,
  longitude,
});
const body = (name: string) =>
  `<h5>Morning at ${name}</h5><p>Synthetic note.</p><h6>Afternoon</h6><p>More.</p>`;
const photo = (index: number, update: string) => ({
  id: `media-${index}`,
  image: { id: `media-${index}` },
  alt_text: `Synthetic photo ${index}`,
  caption: `Caption ${index}`,
  width: 1200,
  height: 800,
  update,
});
const trip = (schema: string) => ({
  schema_version: schema,
  title: "Exampleland 2054",
  summary: "Three weeks.",
  summary_html: "<h5>Overview heading</h5><p>Three weeks.</p>",
  summary_text: "Three weeks.",
  dates: { starts_on: "2054-11-01", ends_on: "2054-11-21", date_precision: "day" },
  cover: null,
  visits: [{ id: "visit-1", title: "Harbour", place: area("Keelung", 25.13, 121.74) }],
  places: [],
  updates: [
    {
      id: "update-a",
      title: "Arrival",
      body: "x",
      body_html: body("the quay"),
      story_date: "2054-11-01",
      date_precision: "day",
      place: area("Keelung", 25.13, 121.74),
    },
    { id: "update-b", title: "Market day", body: "x", body_html: body("the market") },
    // Repeated and missing titles must still give each photo group its own name.
    { id: "update-c", title: "Arrival", body: "x", body_html: body("the pier") },
    { id: "update-d", body: "x", body_html: body("the station") },
    { id: "update-e", body: "x", body_html: body("the hill") },
  ],
  stays: [],
  media: [
    photo(1, "update-a"),
    photo(2, "update-a"),
    photo(3, "update-b"),
    photo(5, "update-c"),
    photo(6, "update-c"),
    photo(7, "update-d"),
    photo(8, "update-d"),
    photo(9, "update-e"),
    photo(10, "update-e"),
    { ...photo(4, ""), update: undefined },
  ],
  routes: [],
  navigation: [],
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#6a8f7d"/></svg>`;

const surfaces = {
  public: { path: "/trips/exampleland-2054", api: "/api/public/trips/exampleland-2054" },
  share: { path: "/share/synthetic-a11y", api: "/api/shared/synthetic-a11y" },
} as const;

async function open(
  page: Page,
  audience: keyof typeof surfaces,
  locale: "nl" | "en",
  theme: "light" | "dark",
  mapStyle: "loads" | "fails" = "loads",
) {
  const { path, api } = surfaces[audience];
  await mockApi(page);
  await page.route(`**${api}`, (route) =>
    route.fulfill({
      json: trip(audience === "public" ? "travel/public-trip@1" : "travel/unlisted-trip@1"),
    }),
  );
  await page.route(`**${api}/files/*`, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: svg }),
  );
  await page.route("https://tiles.openfreemap.org/styles/*", (route) =>
    mapStyle === "fails"
      ? route.abort()
      : route.fulfill({
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
  await choosePreferences(page, locale, theme);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]);

for (const audience of ["public", "share"] as const) {
  for (const locale of ["nl", "en"] as const) {
    for (const theme of ["light", "dark"] as const) {
      for (const width of [390, 1280]) {
        test(`axe clean ${audience} ${locale} ${theme} ${width}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await open(page, audience, locale, theme);
          await expect(page.locator("[data-story-map]")).toBeAttached();
          if (width < 1100) {
            await page.getByRole("radio", { name: locale === "en" ? "Map" : "Kaart" }).click();
            await expect(page.locator("[data-story-map]")).toBeVisible();
          }
          // Let the map settle, then check both the story and the opened disclosure.
          await page.waitForTimeout(500);
          const results = await axe(page).analyze();
          expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target)}`)).toEqual(
            [],
          );
        });
      }
    }
  }
}

for (const audience of ["public", "share"] as const) {
  for (const locale of ["nl", "en"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`keyboard path ${audience} ${locale} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await open(page, audience, locale, theme);
        await expect(page.locator("[data-story-map]")).toBeVisible();
        const skip = page.getByRole("link", {
          name: locale === "en" ? "Skip to the story" : "Naar het verhaal",
        });
        // The first stop is the skip link; it is hidden until focused and jumps over the header controls.
        await page.keyboard.press("Tab");
        await expect(skip).toBeFocused();
        await expect(skip).toBeInViewport();
        await page.keyboard.press("Enter");
        const story = page.locator("#story");
        await expect(story).toBeFocused();
        await expect(page).toHaveURL(/#story$/);
        // The next stops are in the story, not the map.
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => !!document.activeElement?.closest("#story"))).toBe(true);

        // Tab leaves the map in both directions instead of trapping focus in it.
        const inMap = () =>
          page.evaluate(() => !!document.activeElement?.closest("[data-story-map]"));
        const walked: boolean[] = [];
        for (let i = 0; i < 60; i++) {
          await page.keyboard.press("Tab");
          walked.push(await inMap());
        }
        expect(walked.some(Boolean)).toBe(true);
        const firstOut = walked.indexOf(true) + walked.slice(walked.indexOf(true)).indexOf(false);
        expect(firstOut).toBeGreaterThan(walked.indexOf(true));
        // The point buttons under the map remain reachable and ringed.
        const point = page.locator("[data-story-map]").getByRole("button", { name: "Keelung" });
        await point.focus();
        const outline = await point.evaluate((element) => {
          const style = getComputedStyle(element);
          return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
        });
        expect(outline.width).toBeGreaterThanOrEqual(3);
        expect(outline.style).not.toBe("none");
      });
    }
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`map controls and canvas have a 3 px focus ring ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, "public", "en", theme);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    for (const selector of [
      ".maplibregl-canvas",
      ".maplibregl-ctrl button",
      "[data-story-map] a[href^='https://openfreemap']",
    ]) {
      const target = page.locator(selector).first();
      await target.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      const width = await target.evaluate((element) =>
        parseFloat(getComputedStyle(element).outlineWidth),
      );
      expect(width, selector).toBeGreaterThanOrEqual(3);
    }
  });
}

for (const [label, width, scale] of [
  ["200% text", 1280, 2],
  ["150% browser zoom", 853, 1],
] as const) {
  test(`no clipping or sideways scroll at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, "public", "en", "light");
    await page.addStyleTag({ content: `html { font-size: ${scale * 100}% !important; }` });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("h1,h2,h3,a,button,p,time")]
        .filter(
          (element) =>
            element.offsetParent !== null &&
            !element.closest(".sr-only, .maplibregl-map, ul.snap-x"),
        )
        .filter(
          (element) =>
            element.scrollWidth > element.clientWidth + 1 &&
            getComputedStyle(element).overflowX !== "visible",
        )
        .map((element) => element.outerHTML.slice(0, 80)),
    );
    expect(clipped).toEqual([]);
  });
}

for (const locale of ["nl", "en"] as const) {
  test(`map failure keeps the route in words and point buttons ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, "public", locale, "light", "fails");
    const map = page.locator("[data-story-map]");
    await expect(map.getByText(/route in words|route in woorden/i).first()).toBeVisible();
    await expect(map.getByRole("button", { name: "Keelung" })).toBeVisible();
    expect((await axe(page).analyze()).violations).toEqual([]);
  });
}
