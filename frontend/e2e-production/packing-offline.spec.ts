import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, signInOwner } from "../e2e/mock-api";

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const explicitOffline of [true, false]) {
      test(`saved packing cold reload ${locale} ${theme} offline=${explicitOffline}`, async ({
        page,
        context,
      }, testInfo) => {
        await page.setViewportSize({ width: theme === "dark" ? 360 : 1280, height: 800 });
        await mockApi(page);
        const base = "/api/trips/trip-1/packing-lists";
        const list = { id: "list-1", name: "Synthetic weekend" };
        const item = {
          id: "item-1",
          label: "Synthetic raincoat",
          quantity: 1,
          category: null,
          bag_id: null,
          position: 0,
          packed: false,
          notes: null,
          last_minute: false,
        };
        await page.route("**/api/trips/trip-1/packing-lists**", (route) => {
          const path = new URL(route.request().url()).pathname;
          return route.fulfill({
            json:
              path === base
                ? [list]
                : path.endsWith("/items")
                  ? [item]
                  : path.endsWith("/bags")
                    ? []
                    : list,
          });
        });
        await signInOwner(page);
        await choosePreferences(page, locale, theme);
        await page.goto("/admin/trips/trip-1/packing");
        await expect(page.getByText("Synthetic raincoat", { exact: true })).toBeVisible();
        await page.evaluate(async () => {
          await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller)
            await new Promise<void>((resolve) =>
              navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
                once: true,
              }),
            );
        });
        // Reload under worker control so every shell dependency is cached before the outage.
        await page.reload();
        await page
          .getByRole("button", {
            name: locale === "en" ? "Save offline" : "Offline bewaren",
            exact: true,
          })
          .click();
        await expect(
          page.getByText(
            locale === "en"
              ? /Packing list saved offline on this device/
              : /Paklijst offline bewaard op dit toestel/,
          ),
        ).toBeVisible();
        if (!explicitOffline)
          await context.addInitScript(() =>
            Object.defineProperty(navigator, "onLine", { get: () => true }),
          );
        let unavailable = true;
        await page.route("**/api/**", (route) =>
          unavailable ? route.abort("connectionrefused") : route.fallback(),
        );
        await context.setOffline(true);
        await page.reload();
        await expect(page.getByText("Synthetic raincoat", { exact: true })).toBeVisible();
        await expect(
          page.getByText(
            locale === "en"
              ? /Live trip information is unavailable/
              : /Live reisinformatie is niet beschikbaar/,
          ),
        ).toBeVisible();
        await expect(page.getByRole("checkbox")).toBeDisabled();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(
          (
            await new AxeBuilder({ page })
              .include('section[aria-labelledby="packing-title"]')
              .analyze()
          ).violations,
        ).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath("packing-offline.png"), fullPage: true });
        await page.getByRole("searchbox").focus();
        await expect(page.getByRole("searchbox")).toBeFocused();
        const tab = await context.newPage();
        await signInOwner(tab);
        await tab.goto("/admin/trips/trip-1/packing");
        await expect(tab.getByText("Synthetic raincoat", { exact: true })).toBeVisible();
        await tab.close();
        unavailable = false;
        await context.setOffline(false);
        if (!explicitOffline)
          await page
            .getByRole("button", {
              name: locale === "en" ? "Try again" : "Opnieuw proberen",
              exact: true,
            })
            .click();
        await expect(
          page.getByRole("button", {
            name: locale === "en" ? "Remove offline copy" : "Offline verwijderen",
            exact: true,
          }),
        ).toBeVisible();
      });
    }
  }
}
