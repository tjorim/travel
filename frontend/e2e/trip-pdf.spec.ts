import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { message } from "./messages";

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`PDF selection and dirty editor ${locale} ${theme}`, async ({ page }) => {
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.setViewportSize({ width: 360, height: 800 });
      await page.route(`**/api/trips/${ownerTrip.id}/collections`, (route) =>
        route.fulfill({ json: [{ member_id: "synthetic-member", label: "Synthetic family" }] }),
      );
      let payload: unknown;
      await page.route(`**/api/trips/${ownerTrip.id}/export/pdf`, async (route) => {
        payload = route.request().postDataJSON();
        expect(route.request().headers().authorization).toMatch(/^Bearer /);
        expect(route.request().url()).not.toContain("token");
        await route.fulfill({
          status: 200,
          contentType: "application/pdf",
          body: "%PDF-1.4\nsynthetic",
        });
      });
      await page.goto(`/admin/trips/${ownerTrip.id}/prepare`);
      await page.getByRole("button", { name: message(locale, "account"), exact: true }).click();
      const details = page.getByRole("button", {
        name: message(locale, "trips_trip_details"),
        exact: true,
      });
      await details.click();
      const title = page.getByRole("textbox", {
        name: message(locale, "common_title"),
        exact: true,
      });
      await title.fill("Synthetic unsaved draft");
      await page.getByRole("button", { name: message(locale, "pdf_export"), exact: true }).click();
      const download = page.getByRole("button", {
        name: message(locale, "pdf_download"),
        exact: true,
      });
      await expect(download).toBeDisabled();
      await page.getByRole("radio", { name: message(locale, "pdf_both"), exact: true }).click();
      await page.getByRole("radio", { name: message(locale, "pdf_audience"), exact: true }).click();
      await page.getByRole("radio", { name: message(locale, "pdf_public"), exact: true }).click();
      await expect(download).toBeEnabled();
      await page
        .getByRole("radio", {
          name: message(locale, "pdf_collection_audience").replace("{name}", "Synthetic family"),
          exact: true,
        })
        .click();
      await expect(download).toBeEnabled();
      await page.getByRole("radio", { name: message(locale, "pdf_private"), exact: true }).click();
      await expect(download).toBeDisabled();
      await page
        .getByRole("checkbox", { name: message(locale, "pdf_confirm_private"), exact: true })
        .check();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await expect(title).toHaveValue("Synthetic unsaved draft");
      await page.screenshot({ path: test.info().outputPath("pdf-options.png"), fullPage: true });
      const downloaded = page.waitForEvent("download");
      await download.click();
      expect((await downloaded).suggestedFilename()).toBe(`trip-${ownerTrip.id}.pdf`);
      expect(payload).toEqual({
        content: "both",
        view: "private",
        locale,
        audience: null,
        confirm_private: true,
      });
      await expect(title).toHaveValue("Synthetic unsaved draft");
      await expect(download).toBeFocused();
      await page.getByRole("button", { name: message(locale, "pdf_export"), exact: true }).click();
      await title.focus();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.getByRole("button", { name: message(locale, "records_continue_editing") }).click();
      await expect(title).toHaveValue("Synthetic unsaved draft");
      await expect(title).toBeFocused();
    });
  }
}
