import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, signInOwner } from "./mock-api";
import { message } from "./messages";

for (const locale of ["en", "nl"] as const)
  for (const theme of ["light", "dark"] as const)
    test(`drawer focus routes history resize and modal exclusion ${locale} ${theme}`, async ({
      page,
      context,
    }) => {
      test.setTimeout(90_000);
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/admin/trips/trip-1/prepare");
      await expect(page.locator("#tasks")).toBeVisible();
      const trigger = page.getByRole("button", {
        name: message(locale, "owner_trip_sections"),
        exact: true,
      });
      const dialog = page.getByRole("dialog", { name: message(locale, "owner_trip_sections") });
      const nav = page.getByRole("navigation", { name: message(locale, "owner_trip_sections") });
      await expect(nav).toHaveCount(0);
      const capture = await page
        .getByRole("button", { name: message(locale, "owner_capture_in_trip"), exact: true })
        .boundingBox();
      const bar = await page
        .getByRole("navigation", { name: message(locale, "navigation") })
        .boundingBox();
      expect(capture!.height).toBeGreaterThanOrEqual(44);
      expect(capture!.y + capture!.height).toBeLessThanOrEqual(bar!.y);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      for (const dismiss of ["Escape", "Close", "outside"]) {
        await trigger.click();
        await expect(dialog).toBeVisible();
        await expect(nav).toHaveCount(1);
        await expect(nav.getByRole("link")).toHaveCount(6);
        await expect(
          nav.getByRole("link", { name: message(locale, "owner_prepare"), exact: true }),
        ).toHaveAttribute("aria-current", "page");
        for (const link of await nav.getByRole("link").all())
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        if (dismiss === "Escape")
          await page.screenshot({ path: `/tmp/travel-slice-3/drawer-${locale}-${theme}.png` });
        // Walk every focusable control and wrap once in each direction.
        const controls = dialog.getByRole("link").or(dialog.getByRole("button"));
        const count = await controls.count();
        for (const key of ["Tab", "Shift+Tab"]) {
          await controls.first().focus();
          for (let i = 1; i <= count + 1; i++) {
            await page.keyboard.press(key);
            const index = key === "Tab" ? i % count : (count - (i % count)) % count;
            await expect(controls.nth(index)).toBeFocused();
          }
        }
        if (dismiss === "Escape") await page.keyboard.press("Escape");
        else if (dismiss === "Close")
          await dialog
            .getByRole("button", { name: message(locale, "owner_close_2"), exact: true })
            .click();
        else await page.mouse.click(385, 20);
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
      await trigger.click();
      const story = nav.getByRole("link", { name: message(locale, "owner_story"), exact: true });
      // Ordinary href remains usable in a separate tab and as a deep link.
      const href = await story.getAttribute("href");
      const other = await context.newPage();
      await mockApi(other);
      await signInOwner(other);
      await other.goto(href!);
      await expect(other).toHaveURL(/\/story$/);
      await expect(other.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(other.locator("#workspace-section-heading")).toHaveText(
        message(locale, "owner_story"),
      );
      await other.close();
      await story.click();
      await expect(page).toHaveURL(/\/story$/);
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("#workspace-section-heading")).toBeFocused();
      await page.goBack();
      await expect(page).toHaveURL(/\/prepare$/);
      await page.goForward();
      await expect(page).toHaveURL(/\/story$/);
      await trigger.click();
      await page.setViewportSize({ width: 1100, height: 800 });
      await expect(dialog).toHaveCount(0);
      await expect(nav).toHaveCount(1);
      await expect(
        nav.getByRole("link", { name: message(locale, "owner_story"), exact: true }),
      ).toBeFocused();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(nav).toHaveCount(0);
      await page
        .getByRole("button", { name: message(locale, "owner_trip_details"), exact: true })
        .click();
      const input = page.getByRole("textbox", {
        name: message(locale, "owner_title"),
        exact: true,
      });
      await input.fill("Synthetic protected draft");
      await input.evaluate((e) => {
        e.dataset.lifetime = "draft";
      });
      for (const width of [1100, 260, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(input).toHaveAttribute("data-lifetime", "draft");
        await expect(input).toHaveValue("Synthetic protected draft");
      }
      await page
        .getByRole("dialog")
        .getByRole("radio", { name: locale === "en" ? "Nederlands" : "English", exact: true })
        .click();
      const translatedInput = page.getByRole("textbox", {
        name: message(locale === "en" ? "nl" : "en", "owner_title"),
        exact: true,
      });
      await expect(translatedInput).toHaveValue("Synthetic protected draft");
      await expect(translatedInput).toHaveAttribute("data-lifetime", "draft");
      await page
        .getByRole("button", {
          name: message(locale === "en" ? "nl" : "en", "owner_trip_sections"),
          exact: true,
          includeHidden: true,
        })
        .click({ force: true });
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(translatedInput).toHaveValue("Synthetic protected draft");
    });
