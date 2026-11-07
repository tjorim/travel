import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { message } from "./messages";

const area = {
  id: "area-tainan",
  visibility: "private",
  label: "Tainan",
  region: null,
  country_code: "TW",
  latitude: null,
  longitude: null,
  timezone: null,
};
const idea = (id: string, name: string, notes: string | null) => ({
  id,
  check_in_date: "2054-11-12",
  check_out_date: "2054-11-15",
  check_in_time: null,
  check_out_time: null,
  status: "idea",
  property_name: name,
  website_url: null,
  booking_reference: null,
  contact_details: null,
  notes,
  location: null,
  area,
  visibility: "private",
  share_date_precision: null,
});
const stays = [
  idea("stay-a", "Hotel Aurora", "Quiet street"),
  idea("stay-b", "Hotel Borealis", null),
];
const group = {
  id: "group-1",
  kind: "stay",
  label: null,
  chosen_id: null,
  members: stays.map((stay) => ({
    record_id: stay.id,
    chosen: false,
    stay,
    visit: null,
    route: null,
  })),
  created_at: "2054-01-01T00:00:00Z",
  updated_at: "2054-01-01T00:00:00Z",
};
const suggestion = {
  kind: "stay",
  member_ids: ["stay-c", "stay-d"],
  starts_on: "2054-11-18",
  ends_on: "2054-11-20",
  reason: "overlapping_nights",
};

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1440]) {
      test(`alternatives: suggestion, group, choose and compare ${locale} ${theme} ${width}`, async ({
        page,
      }) => {
        await mockApi(page);
        await signInOwner(page);
        await choosePreferences(page, locale, theme);
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const extra = [idea("stay-c", "Hotel Cedar", null), idea("stay-d", "Hotel Dune", null)];
        const base = `**/api/trips/${ownerTrip.id}`;
        await page.route(`${base}/areas`, (route) => route.fulfill({ json: [area] }));
        await page.route(`${base}/stays`, (route) => route.fulfill({ json: [...stays, ...extra] }));
        await page.route(`${base}/alternative-groups`, (route) => route.fulfill({ json: [group] }));
        await page.route(`${base}/alternative-groups/suggestions`, (route) =>
          route.fulfill({ json: [suggestion] }),
        );
        await page.route(`${base}/alternative-groups/group-1/choose`, (route) =>
          route.fulfill({
            json: {
              group: { ...group, chosen_id: "stay-b" },
              event_id: "event-1",
              chosen_id: "stay-b",
              cancelled_ids: ["stay-a"],
              removed_ids: [],
              undoable: true,
            },
          }),
        );
        await page.goto(`/admin/trips/${ownerTrip.id}/plan#stays`);

        await expect(page.locator("[id^=alternative-group-]")).toBeVisible({ timeout: 20_000 });
        await expect(
          page.getByText(message(locale, "owner_alternatives_reason_nights")),
        ).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

        // Compare: exact details side by side, only for the owner.
        await page
          .getByRole("button", { name: message(locale, "owner_alternatives_compare"), exact: true })
          .click();
        const compare = page.getByRole("dialog");
        await expect(compare.getByRole("table")).toBeVisible();
        await expect(compare.getByRole("columnheader", { name: "Hotel Aurora" })).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(compare).toBeHidden();

        // Choose: one confirmation, then a notice with Undo, and focus lands on the group.
        await page
          .getByRole("button", {
            name: message(locale, "owner_alternatives_choose_label").replace(
              "{name}",
              "Hotel Borealis",
            ),
          })
          .click();
        const confirm = page.getByRole("alertdialog");
        await expect(confirm).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await confirm
          .getByRole("button", { name: message(locale, "owner_alternatives_choose"), exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: message(locale, "owner_alternatives_undo") }),
        ).toBeVisible();
        await expect(page.locator("[id^=alternative-group-]")).toBeFocused();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      });
    }
  }
}
