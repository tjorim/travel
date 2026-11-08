import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { message } from "./messages";

// Synthetic content only.
const audience = {
  kind: "public",
  id: null,
  label: "public",
  state: "published",
  live: true,
  shares_title: true,
  shares_summary: true,
  dates_precision: null,
  date_precision: "month",
  record_precision: {
    visits: { by_precision: { month: 12 }, limited_by_record: 0, default_applied: 0 },
    stays: { by_precision: { day: 2, month: 3 }, limited_by_record: 3, default_applied: 0 },
  },
  numbers: { days: 0, areas: 2 },
  scope_items: 0,
  delivered: { visits: 12, places: 0, stays: 5, routes: 0, updates: 0, media: 0 },
  without_map_point: { visits: 0, stays: 0, updates: 0 },
  shows_cover: false,
};

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`audience date precision, sharing check and follow-the-audience dialog (${locale}, ${theme}, phone)`, async ({
      page,
    }) => {
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      const writes: string[] = [];
      await page.route(`**/api/trips/${ownerTrip.id}/public-projection`, (route) => {
        const request = route.request();
        if (request.method() !== "GET") return route.fallback();
        return route.fulfill({
          json: {
            revision: 1,
            trip_id: ownerTrip.id,
            scope: {
              schema_version: "travel/share-scope@1",
              trip: { title: true, summary: true, dates: "day" },
              defaults: { date_precision: "month" },
              items: [],
            },
            surface_state: "published",
            slug: "exampleland-2054",
          },
        });
      });
      await page.route(`**/api/trips/${ownerTrip.id}/overview`, (route) =>
        route.fulfill({
          json: {
            trip_id: ownerTrip.id,
            counts: {},
            visibility: {},
            audiences: [audience],
            warnings: [],
          },
        }),
      );
      await page.route(`**/api/trips/${ownerTrip.id}/date-precision/follow-audience`, (route) => {
        writes.push(route.request().postData() ?? "");
        return route.fulfill({
          json: {
            applied: false,
            changed: { visits: 12, stays: 3 },
            audiences: [
              {
                audience: "public",
                label: null,
                widened: { visits: 0, stays: 3 },
                narrowed: { visits: 0, stays: 0 },
              },
            ],
          },
        });
      });
      await page.goto(`/admin/trips/${ownerTrip.id}/sharing`);

      // The Sharing check states what the audience effectively shows.
      const check = page.getByRole("list", { name: message(locale, "assets_sharing_check") });
      await expect(
        check.getByText(
          message(locale, "precision_check_audience").replace(
            "{precision}",
            message(locale, "precision_audience_month").toLowerCase(),
          ),
        ),
      ).toBeVisible();

      // The audience's own control is a labelled combobox next to the scope.
      const scope = page.getByRole("group", {
        name: message(locale, "assets_what_everyone_can_see"),
      });
      const control = scope.getByRole("combobox", {
        name: message(locale, "precision_audience_label"),
      });
      await expect(
        check.getByRole("region", { name: message(locale, "numbers_heading") }),
      ).toBeVisible();
      const days = scope.getByRole("checkbox", { name: message(locale, "numbers_days") });
      await days.check();
      await expect(days).toBeChecked();
      await days.uncheck();
      await expect(days).not.toBeChecked();
      await expect(control).toBeVisible();
      await expect(control).toHaveValue(message(locale, "precision_audience_month"));
      await expect(scope.getByText(message(locale, "precision_audience_help"))).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);

      // The bulk action asks first and says who will see more precise dates.
      await page.getByRole("button", { name: message(locale, "precision_follow_button") }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("checkbox", { name: message(locale, "precision_follow_acknowledge") }),
      ).toBeVisible();
      expect(JSON.parse(writes[0]!)).toEqual({
        kinds: ["visit", "stay"],
        confirm: false,
        confirm_widening: false,
      });
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .include('[role="alertdialog"]')
            .analyze()
        ).violations,
      ).toEqual([]);
    });
  }
}
