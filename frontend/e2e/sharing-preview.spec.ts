import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { message } from "./messages";

for (const locale of ["nl", "en"] as const) {
  test(`previewing an unsaved public selection saves nothing and guards navigation (${locale})`, async ({
    page,
  }) => {
    await mockApi(page);
    await signInOwner(page);
    await choosePreferences(page, locale, "light");
    const writes: string[] = [];
    await page.route(`**/api/trips/${ownerTrip.id}/public-projection**`, (route) => {
      const request = route.request();
      if (request.method() === "GET") return route.fallback();
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      if (new URL(request.url()).pathname.endsWith("/preview"))
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            schema_version: "travel/public-trip@1",
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
      return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });
    await page.goto(`/admin/trips/${ownerTrip.id}/sharing`);
    const scope = page.getByRole("group", {
      name: message(locale, "assets_what_everyone_can_see"),
    });
    const summary = scope.getByRole("checkbox", { name: message(locale, "owner_summary") });
    await expect(summary).toHaveAttribute("aria-checked", "true");
    await summary.click();
    await expect(summary).toHaveAttribute("aria-checked", "false");

    await page.getByRole("button", { name: message(locale, "assets_view_as_visitor") }).click();
    const dialog = page.getByRole("dialog", { name: message(locale, "assets_public_preview") });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", {
        name: message(locale, "owner_close").replace(
          "{p0}",
          message(locale, "assets_public_preview"),
        ),
      })
      .click();
    expect(writes).toEqual([`POST /api/trips/${ownerTrip.id}/public-projection/preview`]);
    await expect(summary).toHaveAttribute("aria-checked", "false");

    await page.getByRole("link", { name: message(locale, "owner_prepare"), exact: true }).click();
    const prompt = page.getByRole("alertdialog");
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: message(locale, "owner_continue_editing") }).click();
    await expect(summary).toHaveAttribute("aria-checked", "false");
    await expect(page).toHaveURL(/\/sharing$/);
  });
}
