import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { locales, message } from "./messages";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";

for (const locale of locales)
  for (const theme of ["light", "dark"] as const) {
    test(`live location ${locale} ${theme} narrow controls`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.route("**/api/trips/*/live-location", (route) =>
        route.fulfill({
          json: [
            {
              id: "synthetic-source",
              source: "person.synthetic",
              enabled: false,
              audiences: {},
              current: null,
              stale: false,
            },
          ],
        }),
      );
      await page.goto(`/admin/trips/${ownerTrip.id}/sharing`);
      await page.getByRole("button", { name: message(locale, "live_title") }).click();
      await expect(page.getByRole("heading", { name: "person.synthetic" })).toBeVisible();
      await page.getByRole("button", { name: message(locale, "live_configure") }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByRole("radio", { name: message(locale, "live_exact") }).first(),
      ).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(result.violations).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
