import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { message } from "./messages";

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`previewing an unsaved public selection saves nothing and guards navigation (${locale}, ${theme})`, async ({
      page,
    }, testInfo) => {
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      const writes: string[] = [];
      await page.route(`**/api/trips/${ownerTrip.id}/public-projection**`, (route) => {
        const request = route.request();
        if (request.method() === "GET") return route.fallback();
        // The review of the unsaved candidate's future counts is a POST that stores nothing: answer it as a read.
        if (new URL(request.url()).pathname.endsWith("/future-disclosure"))
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ transport: 0, day_dates: 0 }),
          });
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
        if (new URL(request.url()).pathname.endsWith("/preview")) {
          expect(request.postDataJSON().numbers).toEqual(["days"]);
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              schema_version: "travel/public-trip@1",
              numbers: { days: 0 },
              title: "Exampleland",
              summary: null,
              dates: null,
              visits: [],
              places: [],
              updates: [],
              stays: [],
              media: [],
              routes: [],
              navigation: [],
            }),
          });
        }
        return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      });
      await page.goto(`/admin/trips/${ownerTrip.id}/sharing`);
      const scope = page.getByRole("group", {
        name: message(locale, "sharing_what_everyone_can_see"),
      });
      await scope.getByRole("checkbox", { name: message(locale, "numbers_days") }).check();
      const summary = scope.getByRole("checkbox", { name: message(locale, "owner_summary") });
      await expect(summary).toHaveAttribute("aria-checked", "true");
      await summary.click();
      await expect(summary).toHaveAttribute("aria-checked", "false");

      await page.getByRole("button", { name: message(locale, "sharing_view_as_visitor") }).click();
      const dialog = page.getByRole("dialog", {
        name: message(locale, "publication_public_preview"),
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("region", { name: message(locale, "numbers_heading") }),
      ).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .include('[role="dialog"]')
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await dialog.screenshot({ path: testInfo.outputPath("numbers-preview.png") });
      await dialog
        .getByRole("button", {
          name: message(locale, "owner_close").replace(
            "{p0}",
            message(locale, "publication_public_preview"),
          ),
        })
        .click();
      expect(writes).toEqual([`POST /api/trips/${ownerTrip.id}/public-projection/preview`]);
      await expect(summary).toHaveAttribute("aria-checked", "false");

      await page.getByRole("link", { name: message(locale, "trips"), exact: true }).click();
      const prompt = page.getByRole("alertdialog");
      await expect(prompt).toBeVisible();
      await prompt.getByRole("button", { name: message(locale, "owner_continue_editing") }).click();
      await expect(summary).toHaveAttribute("aria-checked", "false");
      await expect(page).toHaveURL(/\/sharing$/);
    });
  }
}
