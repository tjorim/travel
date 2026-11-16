import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { locales, message } from "./messages";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";

const city = {
  osm_element_type: "relation",
  osm_element_id: "1",
  display_name: "Taipei, Taiwan",
  latitude: 25.033,
  longitude: 121.565,
  locality: "Taipei",
  admin_area: "Taipei City",
  country_code: "TW",
  local_name: "臺北市",
  name_nl: "Taipeh",
  name_en: "Taipei City",
};

for (const locale of locales) {
  for (const theme of ["light", "dark"] as const) {
    test(`an area takes the local name of a place found on the map ${locale} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await mockApi(page);
      let saved: Record<string, unknown> | null = null;
      await page.route("**/api/trips/*/places/search", (route) =>
        route.fulfill({
          json: {
            provider: "synthetic",
            attribution: "© OpenStreetMap contributors",
            attribution_url: "https://www.openstreetmap.org/copyright",
            results: [city],
          },
        }),
      );
      await page.route(`**/api/trips/${ownerTrip.id}/areas`, async (route) => {
        if (route.request().method() !== "POST") return route.fulfill({ json: [] });
        saved = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({
          status: 201,
          json: { id: "area-new", visibility: "private", label: "Taipeh", ...saved },
        });
      });
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.goto(`/admin/trips/${ownerTrip.id}/plan#areas`);
      await page.getByRole("button", { name: message(locale, "common_add_area") }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("textbox", { name: message(locale, "areas_search_for_a_city_or_region") })
        .fill("Taipei");
      await dialog.getByRole("button", { name: message(locale, "packing_search") }).click();
      // The local name stands beside the English name of the result.
      const result = dialog.getByRole("button", { name: /^Taipei, Taiwan/ });
      await expect(result).toContainText("臺北市");
      await result.click();

      const local = dialog.getByRole("textbox", {
        name: message(locale, "areas_local_name"),
        exact: false,
      });
      await expect(local).toHaveValue("臺北市");
      // The field marks its language unknown (`lang=""`): the app cannot read the name.
      await expect(local).toHaveAttribute("lang", "");
      await expect(local).toHaveAttribute("dir", "auto");
      await expect(dialog.getByText(message(locale, "localized_suggested_names"))).toBeVisible();
      const violations = (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations;
      expect(violations).toEqual([]);

      await dialog
        .getByRole("button", { name: message(locale, "localized_use_suggested_names") })
        .click();
      await expect(dialog.getByText(message(locale, "localized_suggested_names"))).toBeHidden();
      await dialog.getByRole("button", { name: message(locale, "areas_save_area") }).click();
      await expect
        .poll(() => saved)
        .toMatchObject({ local_name: "臺北市", label_en: "Taipei City" });
    });
  }
}
