import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { locales, message } from "./messages";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";

for (const locale of locales) {
  for (const theme of ["light", "dark"] as const) {
    test(`route map fallback accessibility ${locale} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      // Exercise the deterministic unavailable state without external map services.
      await page.addInitScript(() => {
        Object.defineProperty(window, "WebGLRenderingContext", { value: undefined });
      });
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.goto(`/admin/trips/${ownerTrip.id}/plan`);
      const opener = page.getByRole("button", {
        name: message(locale, "owner_new_route"),
        exact: true,
      });
      await page
        .getByRole("button", { name: `${message(locale, "owner_routes")} 0`, exact: true })
        .click();
      await opener.click();
      const dialog = page.getByRole("dialog");
      const map = dialog.getByRole("region", {
        name: message(locale, "owner_map_editor_for_route"),
      });
      await expect(map).toContainText(
        message(
          locale,
          "owner_the_map_editor_could_not_be_loaded_you_can_still_paste_coordinates_as_js",
        ),
      );
      await expect(map).not.toHaveAttribute("tabindex");
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
      ).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    });
  }
}
