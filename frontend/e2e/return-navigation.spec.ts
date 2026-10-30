import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { locales, message } from "./messages";
import { choosePreferences, mockApi, ownerTrip } from "./mock-api";

for (const locale of locales) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [360, 1280, 1920]) {
      for (const unavailable of [false, true]) {
        test(`public return navigation ${locale} ${theme} ${width} unavailable=${unavailable}`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 900 });
          await mockApi(page);
          if (unavailable) {
            await page.route("**/api/public/trips/missing", (route) =>
              route.fulfill({ status: 404, body: "{}" }),
            );
          }
          await choosePreferences(page, locale, theme);
          await page.goto(unavailable ? "/trips/missing" : "/trips/exampleland-2054");
          await expect(
            page.getByRole("heading", {
              name: unavailable ? message(locale, "unavailable_trip") : ownerTrip.title,
            }),
          ).toBeVisible();
          const link = page.getByRole("link", {
            name: message(locale, "all_public_trips"),
            exact: true,
          });
          await expect(link).toBeVisible();
          await expect(link).toHaveAttribute("href", "/trips");
          // Reach the link through the keyboard, including the preferences controls before it.
          for (
            let step = 0;
            step < 12 && !(await link.evaluate((element) => element === document.activeElement));
            step++
          ) {
            await page.keyboard.press("Tab");
          }
          await expect(link).toBeFocused();
          expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
            "none",
          );
          expect(
            (
              await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
                .analyze()
            ).violations,
          ).toEqual([]);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ),
          ).toBeLessThanOrEqual(0);
          await page.keyboard.press("Enter");
          await expect(page).toHaveURL(/\/trips$/);
          await expect(
            page.getByRole("heading", { name: ownerTrip.title, level: 2 }),
          ).toBeVisible();
        });
      }
    }
  }
}
