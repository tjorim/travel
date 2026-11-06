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
  `<svg xmlns="http://www.w3.org/2000/svg" width="${index === 2 ? 2400 : index % 2 ? 600 : 1600}" height="${index % 2 ? 1200 : index === 2 ? 400 : 900}"><rect width="${index === 2 ? 2400 : index % 2 ? 600 : 1600}" height="${index % 2 ? 1200 : index === 2 ? 400 : 900}" fill="${index % 2 ? "#6a8f7d" : "#c9a95a"}"/><circle cx="800" cy="450" r="220" fill="#f6f1e7"/></svg>`;

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

test("story comes first and the phone map is an explicit choice", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, trip(), "en", "light");
  const story = page.getByRole("region", { name: "Updates" });
  const map = page.getByRole("region", { name: "Trip map" });
  expect((await story.boundingBox())!.y).toBeLessThan(500);
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(story).toBeVisible();
  await expect(map).toBeHidden();
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await expect(map).toBeVisible();
  await expect(story).toBeHidden();
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Harbour", exact: true })).toBeVisible();
});

test("the phone view switch is a tablist with arrow keys and associated panels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page, trip(), "en", "light");
  const list = page.getByRole("tablist", { name: "View" });
  const [story, map, plan] = ["Story", "Map", "Plan"].map((name) =>
    list.getByRole("tab", { name, exact: true }),
  );
  await expect(story).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await story.focus();
  await page.keyboard.press("ArrowRight");
  await expect(map).toBeFocused();
  await expect(map).toHaveAttribute("aria-selected", "true");
  const panelId = await map.getAttribute("aria-controls");
  await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Map" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(plan).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(story).toHaveAttribute("aria-selected", "true");
  // Side by side every panel shows and the tab list is gone.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(list).toBeHidden();
  await expect(page.getByRole("tabpanel")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Updates" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Trip map" })).toBeVisible();
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
        await expect(chooser).toBeVisible();
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

test("an update with several photos leads with one and shows the rest as a mosaic with the count", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, trip(), "en", "light");
  const mosaic = page.locator("[data-mosaic]").first();
  await expect(mosaic.locator("li")).toHaveCount(3);
  await expect(page.getByText("3 photos")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next photo" })).toHaveCount(0);
  const [lead, tile] = await mosaic
    .locator("li")
    .evaluateAll((items) => items.slice(0, 2).map((item) => item.getBoundingClientRect().height));
  expect(lead).toBeGreaterThan(tile! * 2);
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
  // A trip with many points is taller than the window; the column scrolls on its own instead of hiding controls.
  await expect(map).toHaveCSS("overflow-y", "auto");
  await expect(map).toHaveCSS("max-height", "852px");
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
  // A visitor who wants to look around alone can stop the map moving with the story, and resume it.
  const follow = page.getByRole("switch", { name: "Move the map along with the story" });
  await expect(follow).toBeChecked();
  await follow.click();
  await expect(marker).not.toHaveAttribute("data-active", "");
  await follow.click();
  await expect(marker).toHaveAttribute("data-active", "");
  // On a narrow screen the map is selected explicitly.
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(map).toBeHidden();
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await expect(map).toHaveCSS("position", "static");
  // The follow control only means something while the map is beside the story.
  await expect(follow).toBeHidden();
});

/** The lightest pixel behind each text box of the hero, with its glyphs hidden, gives the worst contrast the text can get. */
async function worstContrast(page: Page, selectors: string[]) {
  const boxes = [];
  for (const selector of selectors) {
    const element = page.locator(selector).first();
    const color = await element.evaluate((node) => getComputedStyle(node).color);
    boxes.push({ selector, color, box: (await element.boundingBox())! });
  }
  await page.addStyleTag({
    content: "[data-hero-text] * { color: transparent !important; text-shadow: none !important; }",
  });
  const result: Record<string, number> = {};
  for (const { selector, color, box } of boxes) {
    const png = (await page.screenshot({ clip: box })).toString("base64");
    result[selector] = await page.evaluate(
      async ([data, text]) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const channel = (value: number) => {
          const unit = value / 255;
          return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (r: number, g: number, b: number) =>
          0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        const [tr, tg, tb] = text!.match(/\d+(\.\d+)?/g)!.map(Number);
        const foreground = luminance(tr!, tg!, tb!);
        let lightest = 0;
        const { data: pixels } = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.length; i += 4)
          lightest = Math.max(lightest, luminance(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!));
        return (foreground + 0.05) / (lightest + 0.05);
      },
      [png, color] as const,
    );
  }
  return result;
}

// The photo behind the title is the worst case a scrim can meet: pure white. Tall titles, a phone and a desktop,
// both themes and both languages must keep WCAG AA (4.5:1) for the title, the dates and the destinations.
for (const [width, title] of [
  [360, "A slow journey through mountains, forests and small towns along the coast"],
  [1440, "Exampleland 2054"],
] as const) {
  for (const [locale, theme] of [
    ["en", "light"],
    ["nl", "dark"],
  ] as const) {
    test(`text over a white cover keeps AA contrast ${width} ${locale} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApi(page);
      await page.route("**/api/public/trips/exampleland-2054", (route) =>
        route.fulfill({ json: trip({ title }) }),
      );
      await page.route("**/api/public/trips/exampleland-2054/files/*", (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#ffffff"/></svg>',
        }),
      );
      await choosePreferences(page, locale, theme);
      await page.goto("/trips/exampleland-2054");
      const image = page.locator("[data-hero-image]");
      await expect
        .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
        .toBeGreaterThan(0);
      const ratios = await worstContrast(page, [
        "[data-hero-text] h1",
        "[data-hero-text] > p:not(.sr-only):last-child",
      ]);
      for (const [selector, ratio] of Object.entries(ratios))
        expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
    });
  }
}

test("a trip without a cover keeps the text header, and a failed cover falls back to it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, trip({ cover: null }), "en", "light");
  await expect(page.locator("[data-hero]")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Exampleland 2054" })).toBeVisible();
  // The first update starts high on the first screen, below the dates and destinations.
  await expect(page.locator("#update-a h3")).toBeInViewport();
});

for (const audience of ["public", "share"] as const) {
  for (const locale of ["nl", "en"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`compact first screen ${audience} ${locale} ${theme}`, async ({ page }) => {
        // This case visits every viewport; budget for all navigations on a busy host.
        test.setTimeout(120_000);
        await mockApi(page);
        const api =
          audience === "public"
            ? "/api/public/trips/compact"
            : "/api/shared/synthetic-compact-capability";
        const path =
          audience === "public" ? "/trips/compact" : "/share/synthetic-compact-capability";
        await page.route(`**${api}`, (route) =>
          route.fulfill({
            json: trip({
              updates: [
                ...trip().updates,
                { id: "update-c", title: "Mountain path", body: "Synthetic note." },
              ],
              media: Array.from({ length: 12 }, (_, i) => ({
                ...photos[i % photos.length],
                id: `media-${i}`,
                image: { id: `media-${i}` },
                update: i < 1 ? "update-a" : i < 4 ? "update-b" : "update-c",
              })),

              schema_version:
                audience === "public" ? "travel/public-trip@1" : "travel/unlisted-trip@1",
            }),
          }),
        );
        await page.route(`**${api}/files/*`, (route) =>
          route.fulfill({ contentType: "image/svg+xml", body: coverSvg(0) }),
        );
        await choosePreferences(page, locale, theme);
        for (const [width, height] of [
          [1280, 720],
          [1440, 900],
          [1920, 1080],
          [820, 1180],
          [390, 844],
          [360, 800],
          [720, 450],
        ]) {
          await page.setViewportSize({ width, height });
          await page.goto(path);
          const title = page.getByRole("heading", { level: 1 });
          await expect(title).toBeInViewport();
          // On a short landscape phone the saved-link notice of an unlisted link takes the room the first update needs.
          if (audience === "share" && height < 500)
            await expect(
              page.getByRole("button", { name: /Forget this link|Vergeet deze link/ }),
            ).toBeInViewport();
          else await expect(page.locator("#update-a h3")).toBeInViewport();
          // The hero is a bounded band that carries the title; the first update still starts inside the first screen.
          const hero = (await page.locator("[data-hero]").boundingBox())!;
          expect(hero.height).toBeLessThanOrEqual(height * 0.5);
          expect(hero.width).toBeGreaterThan(width - 80);
          const heading = (await title.boundingBox())!;
          expect(heading.y).toBeGreaterThanOrEqual(hero.y);
          expect(heading.y + heading.height).toBeLessThanOrEqual(hero.y + hero.height + 1);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        }
        await page.setViewportSize({ width: 360, height: 800 });
        await page
          .getByRole("button", {
            name: locale === "en" ? "Preferences" : "Voorkeuren",
            exact: true,
          })
          .click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await page.keyboard.press("Escape");
      });
    }
  }
}
