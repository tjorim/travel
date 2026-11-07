import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { message } from "./messages";

const area = {
  id: "area-alishan",
  visibility: "private",
  label: "Alishan",
  region: null,
  country_code: "TW",
  latitude: null,
  longitude: null,
  timezone: null,
};
// A stay filed under its area alone: no location, no placeholder.
const undecided = {
  id: "stay-undecided",
  check_in_date: "2054-11-12",
  check_out_date: "2054-11-13",
  check_in_time: null,
  check_out_time: null,
  status: "planned",
  property_name: null,
  website_url: null,
  booking_reference: null,
  contact_details: null,
  notes: null,
  location: null,
  area,
  visibility: "private",
  share_date_precision: null,
};

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1440]) {
      test(`an undecided stay is its area, and choosing the area alone saves it ${locale} ${theme} ${width}`, async ({
        page,
      }) => {
        await mockApi(page);
        await signInOwner(page);
        await choosePreferences(page, locale, theme);
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.route(`**/api/trips/${ownerTrip.id}/areas`, (route) =>
          route.fulfill({ json: [area] }),
        );
        await page.route(`**/api/trips/${ownerTrip.id}/stays`, async (route) => {
          if (route.request().method() === "POST") {
            return route.fulfill({
              status: 201,
              json: { ...undecided, id: "stay-new", ...route.request().postDataJSON(), area },
            });
          }
          return route.fulfill({ json: [undecided] });
        });
        await page.goto(`/admin/trips/${ownerTrip.id}/plan#stays`);

        // The row names the area; no placeholder location appears anywhere.
        const stillToChoose = message(locale, "owner_still_to_choose_in").replace(
          "{p0}",
          "Alishan",
        );
        const row = page.locator("button.document-select", { hasText: stillToChoose });
        await expect(row).toBeVisible();
        await row.click();
        await expect(
          page.getByText(
            message(locale, "owner_stay_accommodation_not_chosen_yet_in").replace(
              "{p0}",
              "Alishan",
            ),
          ),
        ).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: message(locale, "owner_new_stay") }).click();
        const dialog = page.getByRole("dialog");
        const areaChoice = dialog.getByRole("combobox", { name: message(locale, "owner_area") });
        await expect(areaChoice).toBeVisible();
        await areaChoice.focus();
        await page.keyboard.press("ArrowDown");
        await page.getByRole("option", { name: "Alishan" }).click();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        const posted = page.waitForRequest(
          (request) => request.method() === "POST" && request.url().endsWith("/stays"),
        );
        await dialog
          .getByRole("button", { name: message(locale, "owner_add_stay"), exact: true })
          .click();
        expect((await posted).postDataJSON()).toMatchObject({
          area_id: "area-alishan",
          location: null,
        });
      });
    }
  }
}
