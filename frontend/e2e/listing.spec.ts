import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi } from "./mock-api";

// Synthetic authored content only; evidence contains no owner trip data.
const trips = [
  {
    slug: "long",
    title: "A slow journey through mountains, forests and small towns along the coast",
  },
  { slug: "sparse", title: null },
  { slug: "word", title: "AnUnbrokenAuthoredTitle".repeat(8) },
  { slug: "short", title: "A weekend away" },
].map((trip) => ({ ...trip, summary: null, dates: null }));

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [360, 820, 1920]) {
      test(`listing ${locale} ${theme} ${width}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await mockApi(page);
        await page.route("**/api/public/trips", (route) => route.fulfill({ json: trips }));
        await choosePreferences(page, locale, theme);
        await page.goto(locale === "en" ? "/" : "/trips/");
        const links = page.locator(".travel-trip-card");
        await expect(links).toHaveCount(4);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        const columns = await page
          .locator(".travel-trip-grid")
          .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
        expect(columns).toBe(width === 360 ? 1 : width === 820 ? 2 : 4);
        await links.first().focus();
        await expect(links.first()).toBeFocused();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath("listing.png"), fullPage: true });
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/trips\/long$/);
      });
    }
  }
}

test("listing loading, empty and retry states", async ({ page }) => {
  await mockApi(page);
  await choosePreferences(page, "en", "light");
  let state = "loading";
  await page.route("**/api/public/trips", async (route) => {
    if (state === "loading") return; // Keep the first request pending until navigation.
    if (state === "error") return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ json: [] });
  });
  await page.goto("/trips/");
  await expect(page.getByRole("status")).toBeVisible();
  state = "error";
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  state = "empty";
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".travel-listing-state")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".travel-trip-card")).toHaveCount(0);
});

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`saved trips ${locale} ${theme} on a narrow shared device`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await mockApi(page);
      await choosePreferences(page, locale, theme);
      await page.addInitScript(() => {
        localStorage.setItem(
          "travel-saved-shared-trips@1",
          JSON.stringify([
            {
              token: "synthetic-active-capability",
              title: "Stale title",
              summary: "Stale summary",
              lastVisitedAt: "2054-01-01",
            },
            {
              token: "synthetic-revoked-capability",
              title: "Revoked title",
              summary: "Revoked summary",
              lastVisitedAt: "2054-01-01",
            },
          ]),
        );
      });
      await page.route("**/api/shared/synthetic-revoked-capability", (route) =>
        route.fulfill({ status: 404 }),
      );
      await page.route("**/api/shared/synthetic-active-capability", (route) =>
        route.fulfill({
          json: {
            schema_version: "travel/unlisted-trip@1",
            title: "Current shared title",
            summary: "Current selected summary",
            dates: null,
            navigation: [],
            visits: [],
            places: [],
            updates: [],
            stays: [],
            routes: [],
            media: [],
          },
        }),
      );
      await page.goto("/trips/");
      await expect(page.getByRole("link", { name: /Current shared title/ })).toBeVisible();
      await expect(
        page.getByText(/Revoked title|Revoked summary|Stale title|Stale summary/),
      ).toHaveCount(0);
      const forgetAll = page.getByRole("button", {
        name: locale === "en" ? "Forget all" : "Alles vergeten",
        exact: true,
      });
      await expect(forgetAll).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("saved-trips.png"), fullPage: true });
      await forgetAll.click();
      await expect(page.getByRole("link", { name: /Current shared title/ })).toHaveCount(0);
      expect(
        await page.evaluate(() => localStorage.getItem("travel-saved-shared-trips@1")),
      ).toBeNull();
    });
  }
}
