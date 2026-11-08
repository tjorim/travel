import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { message } from "./messages";

const area = {
  id: "area-kaohsiung",
  visibility: "private",
  label: "Kaohsiung",
  region: null,
  country_code: "TW",
  latitude: null,
  longitude: null,
  timezone: null,
};
const confirmation = {
  id: "document-confirmation",
  document_kind: "booking",
  title: "Sample Riverside confirmation",
  byte_size: 100,
  content_type: "text/plain",
  original_filename: "confirmation.txt",
  created_at: "2054-11-01T10:00:00Z",
  file_url: "/api/trips/trip-1/documents/document-confirmation/original",
};
const stay = {
  id: "stay-riverside",
  check_in_date: "2054-12-04",
  check_out_date: "2054-12-06",
  check_in_time: null,
  check_out_time: null,
  status: "confirmed",
  property_name: "Hotel Sample Riverside",
  website_url: null,
  booking_reference: null,
  contact_details: null,
  notes: null,
  document_asset_ids: [confirmation.id],
  location: null,
  area,
  visibility: "private",
  share_date_precision: null,
};

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1440]) {
      test(`a stay shows its booking confirmation and edits the link ${locale} ${theme} ${width}`, async ({
        page,
      }) => {
        await mockApi(page);
        await signInOwner(page);
        await choosePreferences(page, locale, theme);
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const base = `**/api/trips/${ownerTrip.id}`;
        await page.route(`${base}/areas`, (route) => route.fulfill({ json: [area] }));
        await page.route(`${base}/documents`, (route) => route.fulfill({ json: [confirmation] }));
        await page.route(`${base}/stays`, (route) => route.fulfill({ json: [stay] }));
        let patched: Record<string, unknown> | null = null;
        await page.route(`${base}/stays/${stay.id}`, (route) => {
          patched = route.request().postDataJSON() as Record<string, unknown>;
          return route.fulfill({ json: { ...stay, ...patched } });
        });
        await page.goto(`/admin/trips/${ownerTrip.id}/plan#stays`);

        await page.locator("button.document-select", { hasText: "Hotel Sample Riverside" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByText(message(locale, "owner_linked_documents"))).toBeVisible();
        await expect(dialog.getByText(confirmation.title)).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

        await dialog
          .getByRole("button", { name: message(locale, "owner_edit"), exact: true })
          .click();
        const link = dialog.getByRole("checkbox", { name: confirmation.title });
        await expect(link).toBeChecked();
        // Keyboard: the link is a checkbox that Space detaches.
        await link.focus();
        await page.keyboard.press("Space");
        await expect(link).not.toBeChecked();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

        await dialog.getByRole("button", { name: message(locale, "owner_save_stay") }).click();
        await expect(dialog).toBeHidden();
        expect(patched).toMatchObject({ document_asset_ids: [] });
      });
    }
  }
}
