import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { message } from "./messages";

for (const locale of ["nl", "en"] as const) {
  test(`record Back/Forward and reload recovery (${locale})`, async ({ page }) => {
    await mockApi(page);
    await signInOwner(page);
    await choosePreferences(page, locale, "dark");
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/admin/trips/${ownerTrip.id}/story`);
    await page
      .getByRole("button", { name: message(locale, "owner_trip_sections"), exact: true })
      .click();
    await page.getByRole("link", { name: message(locale, "owner_prepare"), exact: true }).click();
    await page
      .getByRole("button", { name: message(locale, "owner_trip_details"), exact: true })
      .click();
    const input = page.getByRole("textbox", { name: message(locale, "owner_title"), exact: true });
    await input.fill("Synthetic exact authored draft");
    await page.goBack();
    const prompt = page.getByRole("alertdialog");
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: message(locale, "owner_continue_editing") }).click();
    await expect(input).toHaveValue("Synthetic exact authored draft");
    await expect(input).toBeFocused();
    await page.goBack();
    await prompt
      .getByRole("button", { name: message(locale, "owner_discard_changes_2"), exact: true })
      .click();
    await expect(page).toHaveURL(/\/story$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/prepare$/);
    await page
      .getByRole("button", { name: message(locale, "owner_trip_details"), exact: true })
      .click();
    await expect(input).toHaveValue(ownerTrip.title);
    await input.fill("Synthetic recovered after reload");
    page.once("dialog", (dialog) => dialog.accept());
    await page.reload();
    await page
      .getByRole("button", { name: message(locale, "owner_trip_details"), exact: true })
      .click();
    await expect(input).toHaveValue("Synthetic recovered after reload");
  });
}

for (const fail of [false, true]) {
  test(`Back during deferred ${fail ? "failed" : "successful"} record save`, async ({ page }) => {
    await mockApi(page);
    await signInOwner(page);
    await choosePreferences(page, "en", "light");
    let finish!: () => void;
    const deferred = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let submitted: unknown;
    await page.route(`**/api/trips/${ownerTrip.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      submitted = route.request().postDataJSON();
      await deferred;
      await route.fulfill({
        status: fail ? 500 : 200,
        contentType: "application/json",
        body: JSON.stringify(fail ? {} : { ...ownerTrip, title: "Synthetic submitted A" }),
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/trips/${ownerTrip.id}/story`);
    await page.getByRole("button", { name: "Trip sections", exact: true }).click();
    await page.getByRole("link", { name: "Prepare", exact: true }).click();
    await page.getByRole("button", { name: "Trip details", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Title", exact: true });
    await input.fill("Synthetic submitted A");
    await input.press("Enter");
    await expect(input).toBeDisabled();
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(input).toHaveValue("Synthetic submitted A");
      await expect(input).toBeDisabled();
    }
    await expect.poll(() => submitted).toMatchObject({ title: "Synthetic submitted A" });
    await page.goBack();
    const prompt = page.getByRole("alertdialog");
    await expect(prompt).toContainText(message("en", "owner_wait_for_save"));
    await expect(
      prompt.getByRole("button", { name: "Discard changes", exact: true }),
    ).toBeDisabled();
    finish();
    if (fail) {
      await expect(
        prompt.getByRole("button", { name: "Discard changes", exact: true }),
      ).toBeEnabled();
      await prompt.getByRole("button", { name: "Continue editing" }).click();
      await expect(input).toHaveValue("Synthetic submitted A");
      await expect(input).toBeEnabled();
      await expect(input).toBeFocused();
      await page.goBack();
      await prompt.getByRole("button", { name: "Discard changes", exact: true }).click();
      await expect(page).toHaveURL(/\/story$/);
    } else {
      await expect(prompt).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/prepare$/);
      await expect(
        page.getByRole("status").filter({ hasText: message("en", "owner_trip_saved") }),
      ).toBeVisible();
    }
  });
}
