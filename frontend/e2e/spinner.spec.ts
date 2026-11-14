import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, signInOwner } from "./mock-api";
import { message } from "./messages";

for (const reducedMotion of ["no-preference", "reduce"] as const)
  for (const locale of ["nl", "en"] as const)
    for (const theme of ["light", "dark"] as const)
      test.describe(`spinner ${locale} ${theme} ${reducedMotion}`, () => {
        test.use({ reducedMotion });

        test("a pending submit button shows a decorative spinner", async ({ page }) => {
          await mockApi(page);
          await signInOwner(page);
          await choosePreferences(page, locale, theme);
          // The later route wins: the save never answers, so the pending state stays up.
          await page.route("**/api/trips", (route) =>
            route.request().method() === "POST" ? new Promise(() => {}) : route.fallback(),
          );
          await page.goto("/admin/trips");
          await page.getByRole("button", { name: message(locale, "trips_new_trip") }).click();
          const dialog = page.getByRole("dialog");
          await dialog.getByRole("textbox").first().fill("Exampleland 2054");
          await dialog.getByRole("button", { name: message(locale, "trips_create_trip") }).click();

          const pending = dialog.getByRole("button", {
            name: message(locale, "trips_creating_trip"),
          });
          await expect(pending).toBeDisabled();
          const spinner = pending.locator('[data-slot="spinner"]');
          await expect(spinner).toHaveAttribute("aria-hidden", "true");
          const animation = await spinner.evaluate(
            (element) => getComputedStyle(element).animationName,
          );
          expect(animation).toBe(reducedMotion === "reduce" ? "none" : "spin");

          const results = await new AxeBuilder({ page }).analyze();
          expect(results.violations).toEqual([]);
        });

        test("a loading status shows a decorative spinner beside its text", async ({ page }) => {
          await mockApi(page);
          await signInOwner(page);
          await choosePreferences(page, locale, theme);
          await page.route("**/api/trips", () => new Promise(() => {}));
          await page.goto("/admin/");
          const status = page.getByRole("status").filter({
            hasText: message(locale, "workspace_loading"),
          });
          await expect(status).toBeVisible();
          const spinner = status.locator('[data-slot="spinner"]');
          await expect(spinner).toHaveAttribute("aria-hidden", "true");
          const animation = await spinner.evaluate(
            (element) => getComputedStyle(element).animationName,
          );
          expect(animation).toBe(reducedMotion === "reduce" ? "none" : "spin");
          const results = await new AxeBuilder({ page }).analyze();
          expect(results.violations).toEqual([]);
        });
      });
