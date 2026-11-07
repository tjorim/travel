import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { message } from "./messages";

// Synthetic content only.
const scopeWith = (overrides: Record<string, unknown>) => ({
  schema_version: "travel/share-scope@1",
  trip: { title: true, summary: true, dates: null },
  defaults: { date_precision: "month" },
  items: [],
  ...overrides,
});

async function openSharing(page: Page, scope: Record<string, unknown>) {
  await page.route(`**/api/trips/${ownerTrip.id}/public-projection`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      json: {
        revision: 1,
        trip_id: ownerTrip.id,
        scope,
        surface_state: "unpublished",
        slug: "exampleland-2054",
      },
    });
  });
  await page.goto(`/admin/trips/${ownerTrip.id}/sharing`);
}

const axe = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`audience editor keeps the trip dates and records of its own under Advanced (${locale}, ${theme}, phone)`, async ({
      page,
    }) => {
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await openSharing(page, scopeWith({}));

      const editor = page.getByRole("group", {
        name: message(locale, "assets_what_everyone_can_see"),
      });
      // The primary controls: title, summary and the one date control, without opening anything.
      await expect(
        editor.getByRole("checkbox", { name: message(locale, "assets_trip_title") }),
      ).toBeVisible();
      await expect(
        editor.getByRole("combobox", { name: message(locale, "precision_audience_label") }),
      ).toBeVisible();
      const tripDates = editor.getByRole("combobox", {
        name: message(locale, "assets_how_precise_can_the_travel_dates_be"),
      });
      // Nothing in Advanced differs from the default, so it starts closed.
      const advanced = editor.getByRole("button", {
        name: new RegExp(message(locale, "sharing_advanced_title")),
      });
      await expect(advanced).toHaveAttribute("aria-expanded", "false");
      await expect(tripDates).toBeHidden();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect((await axe(page)).violations).toEqual([]);

      // It opens from the keyboard.
      await advanced.focus();
      await page.keyboard.press("Enter");
      await expect(advanced).toHaveAttribute("aria-expanded", "true");
      await expect(tripDates).toBeVisible();
      await expect(
        editor.getByText(message(locale, "sharing_advanced_trip_dates_help")),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect((await axe(page)).violations).toEqual([]);
    });
  }
}

test("Advanced starts open when the audience already shows trip dates", async ({ page }) => {
  await mockApi(page);
  await signInOwner(page);
  await choosePreferences(page, "en", "light");
  await openSharing(page, scopeWith({ trip: { title: true, summary: true, dates: "year" } }));
  const editor = page.getByRole("group", { name: message("en", "assets_what_everyone_can_see") });
  await expect(editor.getByRole("button", { name: /Advanced/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(
    editor.getByRole("combobox", {
      name: message("en", "assets_how_precise_can_the_travel_dates_be"),
    }),
  ).toHaveValue(message("en", "owner_year_only"));
});
