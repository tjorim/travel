import type * as Api from "../src/api-schema";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { message } from "./messages";
import { choosePreferences, mockApi, overdueTask, ownerTrip, signInOwner } from "./mock-api";

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1440]) {
      test(`readiness ${locale} ${theme} ${width}`, async ({ page }) => {
        await mockApi(page);
        await signInOwner(page);
        await choosePreferences(page, locale, theme);
        await page.setViewportSize({ width, height: 900 });
        await page.route(`**/api/trips/${ownerTrip.id}/trip-tasks`, (route) =>
          route.fulfill({ json: [overdueTask] satisfies Api.TripTaskResponse[] }),
        );
        await page.goto(`/admin/trips/${ownerTrip.id}/overview`);
        const overdue = page.getByRole("link", {
          name: locale === "nl" ? "1 achterstallige taak" : "1 overdue task",
        });
        await expect(overdue).toBeVisible();
        await overdue.focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/prepare#tasks$/);
        await expect(page.locator("[data-section-focus]")).toBeFocused();
        await expect(
          page.getByRole("button", {
            name: /(?:Overdue|Achterstallig): Arrange synthetic documents/,
          }),
        ).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await page.goto(`/admin/trips/${ownerTrip.id}/overview`);
        // A readiness badge leads to the agenda with the kind it counts as the filter.
        for (const [hash, kind] of [
          ["routes", message(locale, "common_routes")],
          ["stays", message(locale, "common_stays")],
        ] as const) {
          await page.locator(`a[href$="/plan#${hash}"]`).first().click();
          await expect(page.locator("#agenda")).toBeVisible();
          const kinds = page.getByRole("group", { name: message(locale, "agenda_filter_kind") });
          await expect(kinds.getByRole("button", { pressed: true })).toHaveText(kind);
          await page.goto(`/admin/trips/${ownerTrip.id}/overview`);
        }
      });
    }
  }
}
