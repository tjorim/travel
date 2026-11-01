import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi } from "./mock-api";

const area = (label: string, latitude: number, longitude: number) => ({
  label,
  country_code: "TW",
  region: null,
  latitude,
  longitude,
});
const trip = {
  schema_version: "travel/public-trip@1",
  title: "Exampleland 2054",
  summary: "S",
  summary_html: "<p>S</p>",
  summary_text: "S",
  dates: { starts_on: "2054-11-01", ends_on: "2054-11-21", date_precision: "day" },
  cover: null,
  visits: [{ id: "visit-1", title: "Harbour", place: area("Keelung", 25.13, 121.74) }],
  places: [],
  updates: [
    {
      id: "u",
      title: "Arrival",
      body: "Hi",
      body_html: "<p>Hi</p>",
      story_date: "2054-11-01",
      date_precision: "day",
      place: area("Keelung", 25.13, 121.74),
    },
  ],
  stays: [],
  media: [],
  routes: [],
  navigation: [],
};
for (const locale of ["nl", "en"] as const)
  for (const theme of ["light", "dark"] as const)
    test(`map view toggles ${locale} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1400, height: 900 });
      await mockApi(page);
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
      await page.route("**/api/public/trips/exampleland-2054", (route) =>
        route.fulfill({ json: trip }),
      );
      await choosePreferences(page, locale, theme);
      await page.goto("/trips/exampleland-2054");
      const group = page.locator('[data-slot="toggle-group"]').first();
      await expect(group).toBeVisible({ timeout: 15000 });
      const items = group.locator("button");
      await expect(items.first()).toBeEnabled({ timeout: 15000 });
      await expect(group).toHaveAttribute("role", "group");
      await expect(group).toHaveAttribute(
        "aria-label",
        locale === "en" ? "Map view" : "Kaartweergave",
      );
      await items.nth(1).focus();
      await page.keyboard.press("Space");
      await expect(items.nth(1)).toHaveAttribute("aria-pressed", "true");
      await expect(items.nth(0)).toHaveAttribute("aria-pressed", "false");
      await expect(items.nth(2)).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("Space");
      await expect(items.nth(1)).toHaveAttribute("aria-pressed", "false");
      await items.nth(1).click();
      expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
      await page
        .locator("[data-story-map]")
        .screenshot({ path: test.info().outputPath("toggle-group.png") });
    });
