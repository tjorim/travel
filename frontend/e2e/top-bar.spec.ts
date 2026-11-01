import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, sharedToken } from "./mock-api";
import { message } from "./messages";

for (const width of [1280, 390])
  for (const locale of ["nl", "en"] as const)
    for (const theme of ["light", "dark"] as const)
      test(`shared visitor bar ${width} ${locale} ${theme}`, async ({ page }) => {
        test.setTimeout(120_000);
        await mockApi(page);
        await page.route("**/api/public/trips/error", (route) =>
          route.fulfill({ status: 503, body: "{}" }),
        );
        await choosePreferences(page, locale, theme);
        await page.setViewportSize({ width, height: 844 });
        for (const path of [
          "/",
          "/trips",
          "/trips/exampleland-2054",
          `/share/${sharedToken}`,
          "/trips/missing",
          "/trips/error",
          "/share/missing",
          "/trips/missing/extra",
          "/admin/",
          "/admin/auth/callback",
        ]) {
          await page.goto(path);
          const bar = page.getByRole("navigation", {
            name: message(locale, "visitor_navigation"),
            exact: true,
          });
          await expect(bar).toBeVisible();
          await expect(bar.getByRole("link", { name: "Travel", exact: true })).toHaveAttribute(
            "href",
            "/",
          );
          expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(60);
          const trigger = bar.getByRole("button", {
            name: message(locale, "visitor_preferences"),
            exact: true,
          });
          await bar.getByRole("link", { name: "Travel", exact: true }).focus();
          if (
            !path.endsWith("/extra") &&
            (path.startsWith("/trips/") || path.startsWith("/share/"))
          ) {
            await page.keyboard.press("Tab");
            await expect(
              bar.getByRole("link", { name: message(locale, "all_public_trips") }),
            ).toBeFocused();
          }
          await page.keyboard.press("Tab");
          await expect(trigger).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(
            page.getByRole("dialog", { name: message(locale, "visitor_preferences"), exact: true }),
          ).toBeVisible();
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
          await page.keyboard.press("Escape");
          await expect(trigger).toBeFocused();
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        }
      });

for (const width of [1280, 390])
  test(`owner shares preferences panel at ${width}`, async ({ page }) => {
    const { signInOwner } = await import("./mock-api");
    await mockApi(page);
    await signInOwner(page);
    await choosePreferences(page, "en", "light");
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/admin/");
    const account = page.getByRole("button", { name: "Account", exact: true });
    await account.click();
    const panel = page.getByRole("dialog", { name: "Account", exact: true });
    await panel.getByRole("radio", { name: "Nederlands", exact: true }).click();
    await panel.getByRole("radio", { name: "Donker", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(account).toBeFocused();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await page.getByRole("button", { name: message("nl", "account"), exact: true }).click();
    await expect(page.getByRole("radio", { name: "Donker", exact: true })).toBeChecked();
  });
