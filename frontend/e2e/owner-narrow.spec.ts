import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner, summaryOf } from "./mock-api";
import { message } from "./messages";

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 360, 390, 430]) {
      test(`owner sharing and capture ${locale} ${theme} ${width}`, async ({ page }) => {
        await mockApi(page);
        await signInOwner(page);
        await choosePreferences(page, locale, theme);
        await page.setViewportSize({ width, height: 844 });
        const updates = [
          {
            id: "update-1",
            title: "Synthetic moment",
            occurred_at: "2054-11-01T18:30:00Z",
            private_notes: "Private synthetic note",
            visibility: "private",
            media_asset_ids: [],
            location: null,
          },
        ];
        await page.route("**/api/trips", (route) =>
          route.fulfill({ json: [summaryOf({ ...ownerTrip, travel_updates: updates })] }),
        );
        let submitted: Record<string, unknown> | null = null;
        await page.route(`**/api/trips/${ownerTrip.id}/travel-updates`, (route) => {
          if (route.request().method() === "GET") return route.fulfill({ json: updates });
          submitted = route.request().postDataJSON();
          return route.fulfill({ status: 500, json: {} });
        });
        await page.goto(`/admin/trips/${ownerTrip.id}/sharing`);
        const group = page.locator("[data-disclosure]").first();
        const heading = group.locator("button strong").first();
        await expect(heading).toBeVisible();
        const box = await heading.boundingBox();
        expect(box!.width).toBeGreaterThan(120);
        expect(box!.height).toBeLessThan(55);
        await group.locator("button").first().click();
        await expect(group).toContainText("Synthetic moment");
        const tripsLink = page
          .getByRole("navigation", { name: message(locale, "navigation") })
          .getByRole("link", { name: message(locale, "trips"), exact: true });
        const target = await tripsLink.boundingBox();
        expect(target!.width).toBeGreaterThanOrEqual(44);
        expect(target!.height).toBeGreaterThanOrEqual(44);
        await page
          .getByRole("button", { name: message(locale, "owner_capture_in_trip"), exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        const save = dialog.getByRole("button", {
          name: message(locale, "owner_save_travel_update"),
          exact: true,
        });
        await expect(save).toBeInViewport();
        const smallActions = await dialog.locator("button:visible").evaluateAll((buttons) =>
          buttons
            .filter((button) => {
              const box = button.getBoundingClientRect();
              return box.width < 44 || box.height < 44;
            })
            .map((button) => button.textContent),
        );
        expect(smallActions).toEqual([]);
        const title = dialog.getByRole("textbox", {
          name: message(locale, "owner_title"),
          exact: true,
        });
        await title.fill("Synthetic local draft");
        // The note, date and time sit under "More" so the line and Save come first.
        await dialog
          .getByRole("button", { name: new RegExp(`^${message(locale, "capture_more")}`) })
          .click();
        const notes = dialog.getByRole("textbox", {
          name: message(locale, "owner_private_note"),
          exact: false,
        });
        await notes.fill("Private synthetic memory");
        const date = dialog.getByRole("textbox", {
          name: message(locale, "owner_label_date").replace(
            "{label}",
            message(locale, "owner_date_and_time"),
          ),
          exact: true,
        });
        await date.scrollIntoViewIfNeeded();
        expect(await date.evaluate((input) => input.scrollWidth <= input.clientWidth)).toBe(true);
        await dialog.evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        await expect(save).toBeInViewport();
        await title.focus();
        await page.keyboard.press("Escape");
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: message(locale, "owner_continue_editing") })
          .click();
        await expect(title).toHaveValue("Synthetic local draft");
        await expect(title).toBeFocused();
        await expect(notes).toHaveValue("Private synthetic memory");
        expect(submitted).toBeNull();
        await save.click();
        await expect
          .poll(() => submitted)
          .toMatchObject({
            title: "Synthetic local draft",
            private_notes: "Private synthetic memory",
            media_asset_ids: [],
          });
        await expect(save).toBeEnabled();
        await expect(notes).toHaveValue("Private synthetic memory");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      });
    }
  }
}
