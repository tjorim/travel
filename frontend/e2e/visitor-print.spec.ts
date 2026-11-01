import { expect, test } from "@playwright/test";
import { mockApi } from "./mock-api";

for (const audience of ["public", "share"] as const) {
  for (const width of [390, 1280]) {
    test(`print includes story and plan without controls ${audience} ${width}`, async ({
      page,
    }) => {
      await mockApi(page);
      const api = audience === "public" ? "/api/public/trips/print" : "/api/shared/print";
      await page.route(`**${api}`, (route) =>
        route.fulfill({
          json: {
            schema_version:
              audience === "public" ? "travel/public-trip@1" : "travel/unlisted-trip@1",
            title: "Synthetic print trip",
            summary: null,
            dates: null,
            visits: [],
            places: [{ id: "area", label: "Synthetic area", latitude: 25, longitude: 121 }],
            updates: [{ id: "update", title: "Synthetic story", body: "Readable text." }],
            stays: [],
            media: [
              {
                id: "photo",
                image: { id: "photo" },
                update: "update",
                alt_text: "Synthetic print photo",
                width: 1200,
                height: 800,
              },
            ],
            routes: [],
            navigation: [],
          },
        }),
      );
      await page.route(`**${api}/files/*`, (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#789"/></svg>',
        }),
      );
      await page.setViewportSize({ width, height: 800 });
      await page.goto(audience === "public" ? "/trips/print" : "/share/print");
      await expect(page.locator("#story")).toBeVisible();
      // Print must work even if the phone reader selected the map before printing.
      if (width < 1100) await page.getByRole("tab", { name: /Map|Kaart/ }).click();
      await page.emulateMedia({ media: "print" });
      await expect(page.locator("#story")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Synthetic story" })).toBeVisible();
      await expect(page.getByRole("img", { name: "Synthetic print photo" })).toBeVisible();
      await expect(page.locator("[data-story-map]")).toBeHidden();
      await expect(page.getByRole("tablist")).toBeHidden();
      await expect(page.locator("nav").first()).toBeHidden();
      // Inactive panels also print, including the itinerary.
      for (const panel of await page.locator('[role="tabpanel"]').all()) {
        if ((await panel.getAttribute("data-story-map")) === null) {
          await expect(panel).toBeVisible();
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });
  }
}
