import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, signInOwner } from "./mock-api";
import { message } from "./messages";

for (const width of [320, 360, 390, 430])
  for (const locale of ["nl", "en"] as const)
    for (const theme of ["light", "dark"] as const)
      test(`compact owner header ${width} ${locale} ${theme}`, async ({ page }) => {
        await mockApi(page);
        await signInOwner(page);
        await choosePreferences(page, locale, theme);
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/admin/trips/trip-1/prepare");
        const sections = page.getByRole("button", {
          name: message(locale, "owner_trip_sections"),
          exact: true,
        });
        await expect(sections).toContainText("Exampleland 2054");
        await expect(sections).toContainText(message(locale, "owner_prepare"));
        const box = (await sections.boundingBox())!;
        expect(box.height).toBeLessThanOrEqual(56);
        expect(box.y + box.height).toBeLessThanOrEqual(60);
        const capture = page.getByRole("button", {
          name: message(locale, "owner_capture_in_trip"),
          exact: true,
        });
        const nav = await page
          .getByRole("navigation", { name: message(locale, "navigation"), exact: true })
          .boundingBox();
        const fab = (await capture.boundingBox())!;
        expect(fab.y + fab.height).toBeLessThan(nav!.y);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        const account = page.getByRole("button", { name: message(locale, "account"), exact: true });
        await account.click();
        const details = page.getByRole("button", {
          name: message(locale, "owner_trip_details"),
          exact: true,
        });
        await expect(details).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(account).toBeFocused();
        await account.click();
        await details.click();
        const title = page.getByRole("textbox", {
          name: message(locale, "owner_title"),
          exact: true,
        });
        await title.fill("Synthetic long railway journey through Exampleland 2054");
        await expect(capture).toBeHidden();
        await expect(title).toHaveValue("Synthetic long railway journey through Exampleland 2054");
        await page.setViewportSize({ width: 1100, height: 800 });
        await expect(title).toHaveValue("Synthetic long railway journey through Exampleland 2054");
      });
