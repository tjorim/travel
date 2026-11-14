import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { locales, message } from "./messages";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";

for (const locale of locales) {
  for (const theme of ["light", "dark"] as const) {
    test(`saved-place search recovery ${locale} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.goto(`/admin/trips/${ownerTrip.id}/plan`);
      await page
        .getByRole("button", { name: `${message(locale, "common_routes")} 0`, exact: true })
        .click();
      await page
        .getByRole("button", { name: message(locale, "routes_new_route"), exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      const name = dialog.getByRole("textbox", {
        name: message(locale, "common_name"),
        exact: false,
      });
      await name.fill("Unsaved route");
      let failed = true;
      await page.route("**/api/trips/*/areas?*", (route) =>
        route.fulfill({ status: failed ? 503 : 200, json: [] }),
      );
      const search = dialog.getByRole("combobox", {
        name: message(locale, "routes_departure"),
        exact: true,
      });
      await search.fill("Example Bay");
      await expect(dialog.getByRole("status")).toContainText(
        message(locale, "common_search_failed"),
        { timeout: 15000 },
      );
      await expect(
        dialog.getByText(message(locale, "common_no_results"), { exact: true }),
      ).toHaveCount(0);
      await expect(search).toBeFocused();
      const violations = (
        await new AxeBuilder({ page })
          .include('[role="dialog"] fieldset:has([role="combobox"])')
          .analyze()
      ).violations;
      expect(violations).toEqual([]);
      failed = false;
      await search.press("Tab");
      const retry = dialog.getByRole("button", { name: message(locale, "common_search_retry") });
      await expect(retry).toBeFocused();
      await retry.press("Enter");
      await expect(
        dialog.getByRole("status").filter({ hasText: message(locale, "common_search_complete") }),
      ).toBeVisible();
      await expect(search).toHaveValue("Example Bay");
      await expect(search).toBeFocused();
      await expect(name).toHaveValue("Unsaved route");
    });
  }
}
