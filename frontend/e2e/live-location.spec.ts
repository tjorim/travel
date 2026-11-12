import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { locales, message, plural } from "./messages";
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
      await page
        .getByRole("radio", { name: message(locale, "live_exact"), exact: true })
        .first()
        .click();
      await page
        .getByRole("radio", {
          name: plural(locale, "live_delay_value", 30).replace("{minutes}", "30"),
          exact: true,
        })
        .first()
        .click();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.getByRole("button", { name: message(locale, "owner_continue_editing") }).click();
      await expect(
        page
          .getByRole("radio", {
            name: plural(locale, "live_delay_value", 30).replace("{minutes}", "30"),
            exact: true,
          })
          .first(),
      ).toBeChecked();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(result.violations).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }

for (const locale of locales)
  for (const theme of ["light", "dark"] as const) {
    test(`delayed visitor ${locale} ${theme} narrow polling`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await mockApi(page);
      await choosePreferences(page, locale, theme);
      let reads = 0;
      await page.route("**/api/public/trips/exampleland-2054", (route) => {
        reads += 1;
        return route.fulfill({
          json: {
            schema_version: "travel/public-trip@1",
            title: "Synthetic delayed trip",
            summary: null,
            dates: null,
            visits: [],
            places: [],
            updates: [],
            stays: [],
            media: [],
            routes: [],
            navigation: [],
            ...(reads > 1
              ? {
                  current_locations: [
                    {
                      latitude: 12.35,
                      longitude: 45.68,
                      observed_at: new Date(Date.now() - 86400000).toISOString(),
                      stale: false,
                      precision: "1km",
                      delay_seconds: 86400,
                      expires_at: new Date(Date.now() + 3600000).toISOString(),
                    },
                  ],
                }
              : {}),
          },
        });
      });
      await page.clock.install();
      await page.goto("/trips/exampleland-2054");
      await expect(page.getByRole("heading", { name: "Synthetic delayed trip" })).toBeVisible();
      await expect(page.getByRole("region", { name: message(locale, "live_current") })).toHaveCount(
        0,
      );
      await page.clock.runFor(31000);
      await expect(
        page.getByRole("region", { name: message(locale, "live_current") }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: message(locale, "live_current") }),
      ).toContainText(plural(locale, "live_delay_value", 30).split("{minutes}")[0]);
      // The observation was a day ago: shown relative, zone-free, with the absolute instant as a machine-readable value.
      const observed = page
        .getByRole("region", { name: message(locale, "live_current") })
        .locator("time");
      await expect(observed).toHaveText(
        new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day"),
      );
      await expect(observed).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
