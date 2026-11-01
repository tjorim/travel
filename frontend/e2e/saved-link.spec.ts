import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi } from "./mock-api";

const sharedToken = "synthetic-saved-link-capability";

const storageKey = "travel-saved-shared-trips@1";

for (const locale of ["nl", "en"] as const) {
  test(`first open of an unlisted link says it is saved, and Forget removes it (${locale})`, async ({
    page,
  }) => {
    const external: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.hostname !== "localhost") external.push(request.url());
    });
    await mockApi(page);
    await choosePreferences(page, locale, "light");
    await page.route(`**/api/shared/${sharedToken}`, (route) =>
      route.fulfill({
        json: {
          schema_version: "travel/unlisted-trip@1",
          title: "Shared Exampleland",
          summary: "Synthetic summary",
          dates: null,
          navigation: [],
          visits: [],
          places: [],
          updates: [],
          stays: [],
          routes: [],
          media: [],
        },
      }),
    );
    await page.goto(`/share/${sharedToken}`);

    const title =
      locale === "en"
        ? "This link is saved on this browser"
        : "Deze link is bewaard in deze browser";
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
      storageKey,
    );
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]).sort()).toEqual(["lastVisitedAt", "summary", "title", "token"]);

    await page
      .getByRole("button", { name: locale === "en" ? "Forget this link" : "Vergeet deze link" })
      .click();
    await expect(page.getByRole("status").filter({ hasText: /forgotten|vergeten/ })).toBeFocused();
    await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe("[]");
    // No token ever reaches another origin.
    expect(external.filter((url) => url.includes(sharedToken))).toEqual([]);
  });
}
