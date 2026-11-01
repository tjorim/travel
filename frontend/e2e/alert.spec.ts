import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, signInOwner } from "./mock-api";

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`owner error notice ${locale} ${theme}`, async ({ page }) => {
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.route("**/api/trips", (route) => route.fulfill({ status: 500, json: {} }));
      await page.goto("/admin/");
      const notice = page.locator('[data-slot="alert"][role="alert"]');
      await expect(notice).toBeVisible();
      await expect(notice.getByRole("button")).toBeEnabled();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await expect(page.locator("[data-slot=alert]")).toBeVisible();
      await page.screenshot({ path: test.info().outputPath("alert.png"), fullPage: true });
    });
    test(`visitor empty notice ${locale} ${theme}`, async ({ page }) => {
      await mockApi(page);
      await choosePreferences(page, locale, theme);
      await page.route("**/api/public/trips/exampleland-2054", (route) =>
        route.fulfill({
          json: {
            schema_version: "travel/public-trip@1",
            title: "Exampleland",
            summary: null,
            dates: null,
            cover: null,
            visits: [],
            places: [],
            updates: [],
            stays: [],
            media: [],
            routes: [],
            navigation: [],
          },
        }),
      );
      await page.goto("/trips/exampleland-2054");
      await expect(page.locator('[data-slot="alert"][role="status"]')).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await expect(page.locator("[data-slot=alert]")).toBeVisible();
      await page.screenshot({ path: test.info().outputPath("alert.png"), fullPage: true });
    });
  }
}
