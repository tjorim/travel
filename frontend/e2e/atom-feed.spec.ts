import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { message } from "./messages";

for (const locale of ["en", "nl"] as const)
  for (const theme of ["light", "dark"] as const) {
    test(`feed consent, lifecycle and accessibility (${locale}, ${theme}, phone)`, async ({
      page,
    }) => {
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      let link = {
        revision: 1,
        id: "feed-link",
        series_id: "feed-link",
        label: "Family",
        state: "active",
        token: "page-token",
        feed_token: null as string | null,
        feed_expires_at: null as string | null,
        expires_at: null,
        created_at: "2054-01-01T00:00:00Z",
        scope: {
          schema_version: "travel/share-scope@1",
          trip: { title: true, summary: true, dates: null },
          items: [],
        },
      };
      await page.route(`**/api/trips/${ownerTrip.id}/share-links`, (route) =>
        route.fulfill({ json: [link] }),
      );
      await page.route(
        `**/api/trips/${ownerTrip.id}/share-links/feed-link/feed/*`,
        async (route) => {
          const action = route.request().url().split("/").pop();
          expect(route.request().postDataJSON().acknowledge_copies).toBe(true);
          link = {
            ...link,
            feed_token:
              action === "revoke" ? null : action === "rotate" ? "rotated-feed" : "separate-feed",
            feed_expires_at: "2054-02-01T00:00:00Z",
          };
          await route.fulfill({ json: link });
        },
      );
      await page.goto(`/admin/trips/${ownerTrip.id}/sharing`);
      const region = page.getByRole("region", { name: message(locale, "feed_heading") });
      const enable = region.getByRole("button", { name: message(locale, "feed_enable") });
      await expect(enable).toBeDisabled();
      await expect(region.getByText(message(locale, "feed_warning"))).toBeVisible();
      await region.getByRole("checkbox").click();
      await enable.click();
      await expect(region.getByRole("textbox")).toHaveValue(/separate-feed\/feed.atom$/);
      await region.getByRole("button", { name: message(locale, "feed_rotate") }).click();
      await expect(region.getByRole("textbox")).toHaveValue(/rotated-feed\/feed.atom$/);
      await expect(region.getByRole("textbox")).not.toHaveValue(/page-token/);
      expect(
        await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze(),
      ).toHaveProperty("violations", []);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await region.getByRole("button", { name: message(locale, "feed_revoke") }).click();
      await expect(enable).toBeVisible();
      await expect(region.getByRole("textbox")).toHaveCount(0);
    });
  }
