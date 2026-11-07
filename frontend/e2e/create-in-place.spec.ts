import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { locales, message } from "./messages";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";

// Synthetic content only. A stateful owner API: records created in the dialogs join the lists the agenda and the map read.
const area = {
  id: "area-tainan",
  visibility: "private",
  label: "Tainan",
  region: null,
  country_code: "TW",
  latitude: 22.99,
  longitude: 120.21,
  timezone: null,
};
const stay = {
  id: "stay-seed",
  check_in_date: "2054-11-12",
  check_out_date: "2054-11-14",
  check_in_time: null,
  check_out_time: null,
  status: "planned",
  property_name: "Hotel Aurora",
  website_url: null,
  booking_reference: null,
  contact_details: null,
  notes: null,
  location: null,
  area,
  visibility: "private",
  share_date_precision: null,
};

async function openOwner(page: Page, locale: (typeof locales)[number], theme: "light" | "dark") {
  await mockApi(page);
  await signInOwner(page);
  await choosePreferences(page, locale, theme);
  const created: Record<string, unknown>[] = [];
  const base = `**/api/trips/${ownerTrip.id}`;
  await page.route(`${base}/areas`, (route) => route.fulfill({ json: [area] }));
  await page.route(`${base}/stays`, (route) => route.fulfill({ json: [stay] }));
  await page.route(`${base}/routes`, (route) => route.fulfill({ json: [] }));
  await page.route(`${base}/visits`, (route) => {
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      const visit = {
        id: `visit-${created.length + 1}`,
        title: null,
        kind: null,
        status: "planned",
        starts_on: null,
        ends_on: null,
        start_time: null,
        end_time: null,
        notes: null,
        summary: null,
        share_time: false,
        share_date_precision: null,
        position: created.length,
        visibility: "private",
        location: null,
        area,
        ...body,
      };
      created.push(visit);
      return route.fulfill({ json: visit, status: 201 });
    }
    return route.fulfill({ json: created });
  });
  return created;
}

for (const locale of locales) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1440]) {
      const setup = `${locale} ${theme} ${width}`;

      test(`create from a day in the agenda: prefilled, guarded, focus returns ${setup}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const created = await openOwner(page, locale, theme);
        await page.goto(`/admin/trips/${ownerTrip.id}/plan`);

        const agenda = page.locator("#agenda");
        // The date fields draw the day in the interface language ("12 Nov 2054", "12 nov 2054").
        const day12 = /^12\b/;
        const trigger = agenda.getByRole("button", {
          name: new RegExp(`^${message(locale, "owner_agenda_add_to_day").split("{day}")[0]}`),
        });
        // The first listed day is the stay's check-in day, 12 November.
        const first = trigger.first();
        await expect(first).toBeVisible();
        expect((await new AxeBuilder({ page }).include("#agenda").analyze()).violations).toEqual(
          [],
        );

        // Escape closes the menu and the record dialog guards nothing yet: focus goes back to the day's Add control.
        await first.click();
        await page
          .getByRole("menuitem", { name: message(locale, "owner_agenda_add_stay_from_day") })
          .click();
        const stayDialog = page.getByRole("dialog", { name: message(locale, "owner_add_stay") });
        await expect(stayDialog).toBeVisible();
        await expect(stayDialog.getByRole("textbox").first()).toBeVisible();
        await expect(
          stayDialog.getByRole("textbox", { name: message(locale, "owner_first_night_check_in") }),
        ).toHaveValue(day12);
        await page.keyboard.press("Escape");
        await expect(stayDialog).toHaveCount(0);
        await expect(first).toBeFocused();

        // A visit on that day opens with the day and the area where the stay is.
        await first.click();
        await page
          .getByRole("menuitem", { name: message(locale, "owner_agenda_add_visit_on_day") })
          .click();
        const dialog = page.getByRole("dialog", { name: message(locale, "owner_add_visit") });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("textbox", { name: message(locale, "owner_first_day") }),
        ).toHaveValue(day12);
        await expect(
          dialog.getByRole("combobox", { name: message(locale, "owner_where") }),
        ).toHaveValue(/Tainan/);
        expect(
          (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
        ).toEqual([]);

        // Editing guards dismissal like any other record dialog.
        await dialog
          .getByRole("textbox", { name: message(locale, "owner_title"), exact: false })
          .first()
          .fill("Harbour walk");
        await page.keyboard.press("Escape");
        const guard = page.getByRole("alertdialog");
        await expect(guard).toBeVisible();
        await guard
          .getByRole("button", { name: message(locale, "owner_continue_editing") })
          .click();
        await dialog
          .getByRole("button", { name: message(locale, "owner_add_visit"), exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({ starts_on: "2054-11-12", title: "Harbour walk" });
        // The new visit's agenda row takes the focus.
        await expect(
          agenda.getByRole("button", { name: new RegExp("Harbour walk") }),
        ).toBeFocused();
      });

      test(`create from a map point: prefilled, focus returns ${setup}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const created = await openOwner(page, locale, theme);
        await page.goto(`/admin/trips/${ownerTrip.id}`);

        const points = page.getByRole("button", {
          name: message(locale, "map_points_count").replace("{count}", "1"),
        });
        await points.click();
        await page.getByRole("button", { name: "Tainan", exact: true }).click();
        expect(
          (await new AxeBuilder({ page }).include("[data-trip-map]").analyze()).violations,
        ).toEqual([]);
        await page
          .getByRole("button", { name: message(locale, "owner_map_add_visit_here") })
          .click();

        // The plan opens the existing visit dialog with the area filled in.
        await expect(page).toHaveURL(new RegExp(`/trips/${ownerTrip.id}/plan$`));
        const dialog = page.getByRole("dialog", { name: message(locale, "owner_add_visit") });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("combobox", { name: message(locale, "owner_where") }),
        ).toHaveValue(/Tainan/);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        // The map point is gone from the page: focus lands at the start of the plan, the agenda toggle.
        await expect(
          page.getByRole("button", { name: new RegExp(`^${message(locale, "owner_agenda")}`) }),
        ).toBeFocused();
        expect(created).toHaveLength(0);
      });
    }
  }
}
