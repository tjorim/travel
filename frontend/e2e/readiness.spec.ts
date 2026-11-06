import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
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
          route.fulfill({ json: [overdueTask] }),
        );
        await page.goto(`/admin/trips/${ownerTrip.id}/overview`);
        const overdue = page.getByRole("link", {
          name: locale === "nl" ? "1 achterstallige taken" : "1 overdue tasks",
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
        for (const hash of ["routes", "stays"]) {
          await page.locator(`a[href$="/plan#${hash}"]`).first().click();
          await expect(page.locator(`#${hash}`)).toBeVisible();
          await page.goto(`/admin/trips/${ownerTrip.id}/overview`);
        }
      });
    }
  }
}
