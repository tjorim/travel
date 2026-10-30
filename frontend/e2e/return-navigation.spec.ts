import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { locales, message } from "./messages";
import { choosePreferences, mockApi, ownerTrip, sharedToken } from "./mock-api";

for (const locale of locales) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [360, 1280, 1920]) {
      for (const audience of ["public", "share"] as const) {
        for (const state of ["ready", "loading", "unavailable", "error"] as const) {
          test(`${audience} return navigation ${locale} ${theme} ${width} ${state}`, async ({
            page,
          }) => {
            await page.setViewportSize({ width, height: 900 });
            await mockApi(page);
            const apiPath =
              audience === "public"
                ? "/api/public/trips/exampleland-2054"
                : `/api/shared/${sharedToken}`;
            if (state !== "ready") {
              await page.route(`**${apiPath}`, (route) =>
                state === "loading"
                  ? new Promise<void>((resolve) => page.once("close", () => resolve()))
                  : route.fulfill({ status: state === "unavailable" ? 404 : 503, body: "{}" }),
              );
            }
            await choosePreferences(page, locale, theme);
            await page.goto(
              audience === "public" ? "/trips/exampleland-2054" : `/share/${sharedToken}`,
            );
            await expect(
              page.getByRole("heading", {
                name:
                  state === "ready"
                    ? audience === "public"
                      ? ownerTrip.title
                      : "Shared Exampleland"
                    : message(
                        locale,
                        state === "loading"
                          ? "loading_trip"
                          : state === "error"
                            ? "trip_error"
                            : "unavailable_trip",
                      ),
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
            expect(
              await link.evaluate((element) => getComputedStyle(element).outlineStyle),
            ).not.toBe("none");
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
            const indexRequest = page.waitForRequest(
              (request) => new URL(request.url()).pathname === "/api/public/trips",
            );
            await page.keyboard.press("Enter");
            expect((await indexRequest).headers()["referer"]).toBeUndefined();
            await expect(page).toHaveURL(/\/trips$/);
            await expect(
              page.getByRole("heading", { name: ownerTrip.title, level: 2 }),
            ).toBeVisible();
          });
        }
      }
    }
  }
}
