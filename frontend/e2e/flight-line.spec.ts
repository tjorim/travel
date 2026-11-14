import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { locales, message } from "./messages";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";

for (const locale of locales)
  for (const theme of ["light", "dark"] as const) {
    test(`flight line review by keyboard ${locale} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.addInitScript(() =>
        Object.defineProperty(window, "WebGLRenderingContext", { value: undefined }),
      );
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      const area = (id: string, longitude: number) => ({
        id,
        label: id,
        country_code: "BE",
        latitude: 40,
        longitude,
        visibility: "private",
      });
      const from = area("West", -60),
        to = area("East", 60);
      const flight = {
        id: "flight",
        mode: "flight",
        label: "Example flight",
        status: "planned",
        departure_area: from,
        arrival_area: to,
        departure_location: null,
        arrival_location: null,
        document_asset_ids: [],
        geometry: null,
      };
      await page.route(`**/api/trips/${ownerTrip.id}/routes`, (route) =>
        route.fulfill({ json: [flight] }),
      );
      await page.route(`**/api/trips/${ownerTrip.id}/areas`, (route) =>
        route.fulfill({ json: [from, to] }),
      );
      await page.goto(`/admin/trips/${ownerTrip.id}/plan`);
      await page
        .getByRole("button", { name: `${message(locale, "common_routes")} 1`, exact: true })
        .click();
      await page.locator("button.document-select").filter({ hasText: "Example flight" }).click();
      await page.getByRole("button", { name: message(locale, "common_edit"), exact: true }).click();
      const dialog = page.getByRole("dialog");
      const suggest = dialog.getByRole("button", {
        name: message(locale, "routes_suggest_flight_line"),
      });
      await suggest.focus();
      await suggest.press("Enter");
      await expect(dialog.getByRole("status")).toContainText(
        message(locale, "routes_flight_arc_review"),
      );
      await expect(suggest).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("flight-line.png") });
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
      ).toEqual([]);
      await dialog
        .getByText(message(locale, "routes_advanced_paste_coordinates_as_json"), { exact: true })
        .click();
      const input = dialog.getByRole("textbox", {
        name: message(locale, "routes_line_coordinates_json"),
      });
      const points = JSON.parse(await input.inputValue());
      expect(points[0]).toEqual([-60, 40]);
      expect(points.at(-1)).toEqual([60, 40]);
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", {
          name: message(locale, "records_discard_changes_action"),
          exact: true,
        })
        .click();
      await expect(dialog).toHaveCount(0);
    });
  }
