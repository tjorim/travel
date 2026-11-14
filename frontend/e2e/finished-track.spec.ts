import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { locales, message } from "./messages";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";

for (const locale of locales)
  for (const theme of ["light", "dark"] as const) {
    test(`finished track review by keyboard ${locale} ${theme}`, async ({ page }, testInfo) => {
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
        geometry: {
          type: "LineString",
          coordinates: [
            [1, 2],
            [3, 4],
          ],
        },
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
      await dialog.getByLabel(message(locale, "routes_track_file"), { exact: true }).setInputFiles({
        name: "synthetic.gpx",
        mimeType: "application/gpx+xml",
        buffer: Buffer.from("<gpx/>"),
      });
      await page.route(`**/api/trips/${ownerTrip.id}/route-line-import?*`, async (route) => {
        expect(route.request().headers()["content-type"]).toBe("application/octet-stream");
        await route.fulfill({
          json: {
            type: "LineString",
            coordinates: [
              [4.12, 50.12],
              [5.23, 51.23],
            ],
          },
        });
      });
      const preview = dialog.getByRole("button", {
        name: message(locale, "routes_track_preview"),
        exact: true,
      });
      await preview.focus();
      await preview.press("Enter");
      const apply = dialog.getByRole("button", {
        name: message(locale, "routes_track_apply"),
        exact: true,
      });
      await expect(apply).toBeVisible();
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
      ).toEqual([]);
      await dialog
        .getByRole("button", { name: message(locale, "routes_track_cancel"), exact: true })
        .click();
      await expect(apply).toHaveCount(0);
      await dialog
        .getByText(message(locale, "routes_advanced_paste_coordinates_as_json"), { exact: true })
        .click();
      const existing = dialog.getByRole("textbox", {
        name: message(locale, "routes_line_coordinates_json"),
      });
      expect(JSON.parse(await existing.inputValue())).toEqual([
        [1, 2],
        [3, 4],
      ]);
      await dialog.getByLabel(message(locale, "routes_track_file"), { exact: true }).setInputFiles({
        name: "synthetic.gpx",
        mimeType: "application/gpx+xml",
        buffer: Buffer.from("<gpx/>"),
      });
      await preview.click();
      await expect(apply).toBeVisible();
      await apply.focus();
      await apply.press("Enter");
      await expect(preview).toBeFocused();
      const input = dialog.getByRole("textbox", {
        name: message(locale, "routes_line_coordinates_json"),
      });
      expect(JSON.parse(await input.inputValue())).toEqual([
        [4.12, 50.12],
        [5.23, 51.23],
      ]);
      await dialog
        .getByRole("button", { name: message(locale, "routes_track_cancel"), exact: true })
        .click();
      expect(JSON.parse(await input.inputValue())).toEqual([
        [4.12, 50.12],
        [5.23, 51.23],
      ]);
      await page.screenshot({ path: testInfo.outputPath("finished-track.png") });
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
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
