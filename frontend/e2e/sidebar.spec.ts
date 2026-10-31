import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { message } from "./messages";

for (const locale of ["en", "nl"] as const)
  for (const theme of ["light", "dark"] as const) {
    test(`sidebar boundary scroll focus and drafts ${locale} ${theme}`, async ({ page }) => {
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.route("**/api/trips", (r) =>
        r.fulfill({
          json: [{ ...ownerTrip, title: "Synthetic coastal railway journey ".repeat(8) }],
        }),
      );
      await page.route("**/api/trips/trip-1/trip-tasks", (r) =>
        r.fulfill({
          json: Array.from({ length: 32 }, (_, i) => ({
            id: "task-" + i,
            title: "Synthetic task " + i,
            notes: null,
            due_date: null,
            remind_at: null,
            reminded_at: null,
            completed_at: null,
            links: [],
            created_at: "2054-10-01T12:00:00Z",
          })),
        }),
      );
      await page.setViewportSize({ width: 1100, height: 600 });
      await page.goto("/admin/trips/trip-1/prepare");
      const side = page.locator("[data-trip-sidebar]");
      const nav = page.getByRole("navigation", {
        includeHidden: true,
        name: message(locale, "owner_trip_sections"),
      });
      await expect(nav).toHaveCount(1);
      const links = nav.getByRole("link");
      await expect(links).toHaveCount(6);
      await expect(side).toHaveCSS("position", "sticky");
      expect((await side.boundingBox())!.width).toBe(224);
      await expect(page.locator("#tasks")).toBeVisible();
      expect(await side.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
      await links.first().focus();
      for (let i = 1; i < 6; i++) {
        await page.keyboard.press("Tab");
        await expect(links.nth(i)).toBeFocused();
      }
      expect(await side.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
      expect(await links.last().evaluate((e) => getComputedStyle(e).outlineStyle)).toBe("solid");
      await page.evaluate(() => scrollTo(0, 500));
      expect(Math.round((await side.boundingBox())!.y)).toBe(16);
      const details = page.getByRole("button", {
        name: message(locale, "owner_trip_details"),
        exact: true,
      });
      await details.click();
      const title = page.getByRole("textbox", {
        name: message(locale, "owner_title"),
        exact: true,
      });
      await title.fill("Synthetic resize draft");
      await title.evaluate((e) => {
        e.dataset.lifetime = "original";
      });
      for (const width of [1099, 1100, 390, 1920]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(title).toHaveValue("Synthetic resize draft");
        await expect(title).toHaveAttribute("data-lifetime", "original");
        await expect(title).toBeFocused();
        await expect(nav).toHaveCount(width >= 1100 ? 1 : 0);
      }
      await title.press("Escape");
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: message(locale, "owner_discard_changes_2"), exact: true })
        .click();
      await expect(details).toBeFocused();
      await page.setViewportSize({ width: 1099, height: 800 });
      await expect(side).toHaveCSS("position", "static");
      await expect(nav).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: message(locale, "owner_trip_sections"), exact: true }),
      ).toBeVisible();
      await page.setViewportSize({ width: 1100, height: 800 });
      await expect(nav).toHaveCSS("flex-direction", "column");
      await page.evaluate(() => document.fonts.ready);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
    test(`sidebar Story Prepare document and record search ${locale} ${theme}`, async ({
      page,
    }) => {
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.route("**/api/trips/trip-1/trip-tasks", (r) =>
        r.fulfill({
          json: [
            {
              id: "task-1",
              title: "Synthetic preparation 24",
              notes: null,
              due_date: null,
              remind_at: null,
              reminded_at: null,
              completed_at: null,
              links: [],
              created_at: "2054-10-01T12:00:00Z",
            },
          ],
        }),
      );
      await page.goto("/admin/trips/trip-1/story");
      await page
        .getByRole("navigation", {
          includeHidden: true,
          name: message(locale, "owner_trip_sections"),
        })
        .getByRole("link", { name: message(locale, "owner_prepare"), exact: true })
        .click();
      await expect(page).toHaveURL(/\/prepare$/);
      await page
        .getByRole("button", { name: new RegExp("^" + message(locale, "assets_documents") + " ") })
        .click();
      await page
        .getByRole("button", { name: message(locale, "assets_new_document"), exact: true })
        .click();
      const input = page
        .getByRole("dialog")
        .getByRole("textbox", { name: message(locale, "owner_title"), exact: true });
      await input.fill("Synthetic document draft");
      await input.evaluate((e) => {
        e.dataset.lifetime = "document";
      });
      await page.setViewportSize({ width: 1099, height: 800 });
      await expect(input).toHaveValue("Synthetic document draft");
      await expect(input).toHaveAttribute("data-lifetime", "document");
      await input.press("Escape");
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: message(locale, "owner_discard_changes_2"), exact: true })
        .click();
      const search = page.getByRole("combobox", { name: message(locale, "owner_jump_to") });
      await search.fill("Synthetic preparation 24");
      await search.evaluate((e) => {
        e.dataset.lifetime = "search";
      });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await expect(search).toHaveValue("Synthetic preparation 24");
      await expect(search).toHaveAttribute("data-lifetime", "search");
      await page.getByRole("option", { name: /Synthetic preparation 24/ }).click();
      await expect(
        page
          .getByRole("dialog")
          .getByRole("heading", { name: "Synthetic preparation 24", exact: true }),
      ).toBeVisible();
    });
  }
