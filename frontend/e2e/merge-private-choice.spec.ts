import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { message, locales } from "./messages";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";

const area = (id: string, label: string) => ({
  id,
  label,
  visibility: "private",
  country_code: "TW",
  region: null,
  latitude: null,
  longitude: null,
  timezone: null,
});
const airport = (id: string, areaId: string) => ({
  id,
  area_id: areaId,
  label: null,
  visibility: "private",
  share_address: false,
  display_name: "Taoyuan Airport",
  locality: "Taoyuan",
  country_code: "TW",
});
const record = (kind: string, index: number, extra: object = {}) => ({
  kind,
  id: `${kind}-${index}`,
  label: kind === "stay" ? `Synthetic Inn ${index + 1}` : null,
  starts_on: `2054-11-${String((index % 20) + 1).padStart(2, "0")}`,
  visibility: index % 5 === 0 ? "custom" : "everyone",
  widened_for: [{ audience: "public", label: null }],
  hides_from: index % 3 === 0 ? [{ audience: "link:a", label: "Family" }] : [],
  custom_picks: index % 5 === 0 ? 2 : 0,
  make_private: false,
  ...extra,
});
const dense = [
  ...Array.from({ length: 24 }, (_, index) => record("stay", index)),
  ...Array.from({ length: 8 }, (_, index) =>
    record("visit", index, { label: `Synthetic walk ${index + 1}` }),
  ),
  ...Array.from({ length: 4 }, (_, index) =>
    record("route", index, { label: `Synthetic train ${index + 1}` }),
  ),
  record("travel_update", 0, { label: "Synthetic update" }),
];
const preview = {
  keep_id: "air-1",
  applied: false,
  duplicates: [
    {
      id: "air-2",
      label: null,
      display_name: "Taoyuan Airport",
      area_id: "taipei",
      visits: 8,
      stays: 24,
      routes: 4,
      travel_updates: 1,
      narrowed_audiences: [],
      widened: [
        { audience: "public", label: null, stays: 24, visits: 8, routes: 4, travel_updates: 1 },
      ],
      widened_records: dense,
    },
  ],
  warnings: [],
};

for (const locale of locales) {
  for (const [name, size] of [
    ["desktop", { width: 1280, height: 900 }],
    ["narrow", { width: 360, height: 740 }],
  ] as const) {
    test(`a dense merge preview lets the owner choose per record (${locale}, ${name})`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, "light");
      const tripApi = `**/api/trips/${ownerTrip.id}`;
      await page.route(`${tripApi}/areas`, (route) =>
        route.fulfill({
          json: [area("taoyuan", "Taoyuan"), area("taipei", "Taipei")],
        }),
      );
      await page.route(`${tripApi}/locations`, (route) =>
        route.fulfill({ json: [airport("air-1", "taoyuan"), airport("air-2", "taipei")] }),
      );
      const bodies: { confirm: boolean; make_private?: unknown[] }[] = [];
      await page.route(`${tripApi}/locations/merge`, (route) => {
        bodies.push(route.request().postDataJSON());
        return route.fulfill({ json: { ...preview, applied: bodies.at(-1)?.confirm ?? false } });
      });

      await page.goto(`/admin/trips/${ownerTrip.id}/plan`);
      await page
        .getByRole("button", {
          name: new RegExp(`^${message(locale, "owner_areas_and_locations")}`),
        })
        .click();
      await page
        .getByRole("button", {
          name: message(locale, "owner_review_merge_of").replace("{p0}", "Taoyuan Airport"),
        })
        .click();
      const dialog = page.getByRole("dialog", { name: message(locale, "owner_merge_locations") });
      await dialog.getByRole("button", { name: message(locale, "owner_preview_merge") }).click();
      const region = dialog.getByRole("region", {
        name: message(locale, "owner_merge_widening_title"),
      });
      await expect(region).toBeVisible();
      await expect(region.getByRole("group")).toHaveCount(4);
      await expect(region.getByRole("checkbox")).toHaveCount(24 + 8 + 4 + 1 + 1);

      // The keyboard reaches a row far down a long list, and the list scrolls to it.
      const lastStay = region.getByRole("checkbox", { name: /Synthetic Inn 24/ });
      await lastStay.focus();
      await expect(lastStay).toBeFocused();
      await page.keyboard.press("Space");
      await expect(lastStay).toHaveAttribute("aria-checked", "true");
      await expect(lastStay).toBeInViewport();

      // Nothing overflows sideways at a narrow width.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);

      await region.getByRole("group").first().scrollIntoViewIfNeeded();
      if (locale === "en" && process.env.MERGE_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.MERGE_SCREENSHOT_DIR}/merge-dialog-${name}.png`,
        });
    });
  }
}
