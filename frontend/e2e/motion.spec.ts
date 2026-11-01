import { expect, test, type Page } from "@playwright/test";
import { choosePreferences, mockApi, signInOwner } from "./mock-api";
import { message } from "./messages";

async function openDrawer(page: Page) {
  await mockApi(page);
  await signInOwner(page);
  await choosePreferences(page, "en", "light");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/trips/trip-1/prepare");
  await page
    .getByRole("button", { name: message("en", "owner_trip_sections"), exact: true })
    .click();
  return page.getByRole("dialog", { name: message("en", "owner_trip_sections") });
}

const transitionOf = (dialog: ReturnType<Page["getByRole"]>) =>
  dialog.evaluate((element) => getComputedStyle(element).transitionDuration);

test.describe("motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the drawer slides and fades, and buttons answer the pointer", async ({ page }) => {
    const dialog = await openDrawer(page);
    await expect(dialog).toBeVisible();
    expect(await transitionOf(dialog)).toBe("0.22s");
    await expect(dialog).toHaveCSS("transform", "none");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    const button = page.getByRole("button", {
      name: message("en", "owner_trip_sections"),
      exact: true,
    });
    expect(await button.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
      "0.15s",
    );
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the drawer appears at once and buttons do not transition", async ({ page }) => {
    const dialog = await openDrawer(page);
    await expect(dialog).toBeVisible();
    expect(await transitionOf(dialog)).toBe("0s");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    const button = page.getByRole("button", {
      name: message("en", "owner_trip_sections"),
      exact: true,
    });
    expect(await button.evaluate((element) => getComputedStyle(element).transitionProperty)).toBe(
      "none",
    );
  });
});
