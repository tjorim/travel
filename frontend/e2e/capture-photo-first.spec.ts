import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { locales, message, type Locale } from "./messages";
import { choosePreferences, mockApi, signInOwner } from "./mock-api";

test.setTimeout(90_000);

const photo = {
  name: "synthetic-photo.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
};

async function openCapture(page: Page, locale: Locale, theme: "light" | "dark") {
  const record = await mockApi(page);
  await signInOwner(page);
  await choosePreferences(page, locale, theme);
  await page.goto("/admin/trips");
  const opener = page.getByRole("button", { name: message(locale, "capture") });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: message(locale, "common_title"), exact: true }),
  ).toBeVisible();
  return { record, dialog, opener };
}

const moreName = (locale: Locale) => new RegExp(`^${message(locale, "capture_more")}`);
const saveName = (locale: Locale) => message(locale, "updates_save_travel_update");

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

for (const locale of locales) {
  for (const theme of ["light", "dark"] as const) {
    test(`one photo and one line save without scrolling on a 390x844 phone (${locale}, ${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const { record, dialog } = await openCapture(page, locale, theme);
      const save = dialog.getByRole("button", { name: saveName(locale), exact: true });
      const scrolled = () => dialog.evaluate((node) => node.scrollHeight > node.clientHeight + 1);

      // Photos first, then the line; everything else is folded and cannot be reached while it is.
      const top = async (locator: Locator) => (await locator.boundingBox())!.y;
      const order = {
        photos: await top(dialog.getByRole("group", { name: message(locale, "capture_photos") })),
        title: await top(
          dialog.getByRole("textbox", { name: message(locale, "common_title"), exact: true }),
        ),
        more: await top(dialog.getByRole("button", { name: moreName(locale) })),
      };
      expect(order.photos).toBeLessThan(order.title);
      expect(order.title).toBeLessThan(order.more);
      await expect(
        dialog.getByRole("textbox", {
          name: message(locale, "updates_private_note"),
          exact: false,
        }),
      ).toBeHidden();
      await expect(
        dialog.getByRole("radiogroup", { name: message(locale, "language") }),
      ).toBeHidden();
      // Privacy stays in view next to Save in its short form.
      await expect(dialog.getByText(message(locale, "capture_private_short"))).toBeInViewport();
      await expect(save).toBeInViewport();
      expect(await scrolled()).toBe(false);

      await dialog.locator("input[type=file][multiple]").setInputFiles(photo);
      const remove = dialog.getByRole("button", {
        name: message(locale, "capture_remove_photo").replace("{name}", photo.name),
      });
      await expect(remove).toBeVisible();
      await dialog
        .getByRole("textbox", { name: message(locale, "common_title"), exact: true })
        .fill("Synthetic moment");
      await expect(save).toBeInViewport();
      expect(await scrolled()).toBe(false);
      await expectNoAxeViolations(page);

      await save.click();
      await expect(
        dialog.getByText(message(locale, "updates_travel_update_saved"), { exact: true }),
      ).toBeVisible();
      expect(record.uploads).toHaveLength(1);
      expect(record.updates).toHaveLength(1);
      expect(record.updates[0]).toMatchObject({
        title: "Synthetic moment",
        private_notes: null,
        media_asset_ids: ["photo-1"],
      });
      expect(record.updates[0]).not.toHaveProperty("visibility");
      expect(await scrolled()).toBe(false);
    });
  }

  test(`Save stays reachable when the on-screen keyboard leaves 390x500 (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    const { dialog } = await openCapture(page, locale, "light");
    const save = dialog.getByRole("button", { name: saveName(locale), exact: true });
    await dialog.locator("input[type=file][multiple]").setInputFiles(photo);
    const title = dialog.getByRole("textbox", {
      name: message(locale, "common_title"),
      exact: true,
    });
    await title.focus();
    await title.fill("Synthetic moment");
    await expect(save).toBeInViewport();
    await expect(dialog.getByText(message(locale, "capture_private_short"))).toBeInViewport();
    // The line being typed is not hidden behind the Save bar either.
    const [field, bar] = await Promise.all([title.boundingBox(), save.boundingBox()]);
    expect(field!.y + field!.height).toBeLessThanOrEqual(bar!.y);

    await dialog.getByRole("button", { name: moreName(locale) }).click();
    await dialog.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(save).toBeInViewport();
    await dialog.evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect(save).toBeInViewport();
  });

  test(`More folds the language, status, full privacy text and fields, and works from the keyboard (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { dialog } = await openCapture(page, locale, "light");
    const title = dialog.getByRole("textbox", {
      name: message(locale, "common_title"),
      exact: true,
    });
    const more = dialog.getByRole("button", { name: moreName(locale) });
    const save = dialog.getByRole("button", { name: saveName(locale), exact: true });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    // Folded fields are out of the tab order: the line is followed by More, then straight by Save.
    await title.focus();
    await page.keyboard.press("Tab");
    await expect(more).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(save).toBeFocused();

    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(
      dialog.getByRole("radiogroup", { name: message(locale, "language") }),
    ).toBeVisible();
    await expect(dialog.getByText(message(locale, "capture_privacy_hint"))).toBeVisible();
    await expect(
      dialog.getByText(message(locale, "capture_connected_you_choose_when_to_save")),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("radio", { checked: true })).toBeFocused();
    await expectNoAxeViolations(page);

    await more.focus();
    await page.keyboard.press("Space");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(
      dialog.getByRole("radiogroup", { name: message(locale, "language") }),
    ).toBeHidden();
  });

  test(`a dirty capture asks before closing and a clean one gives focus back to the opener (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { dialog, opener } = await openCapture(page, locale, "light");
    await dialog.locator("input[type=file][multiple]").setInputFiles(photo);
    await expect(
      dialog.getByRole("button", {
        name: message(locale, "capture_remove_photo").replace("{name}", photo.name),
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const prompt = page.getByRole("alertdialog");
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: message(locale, "records_continue_editing") }).click();
    await expect(dialog).toBeVisible();

    await dialog
      .getByRole("button", {
        name: message(locale, "capture_remove_photo").replace("{name}", photo.name),
      })
      .click();
    await dialog
      .getByRole("button", {
        name: message(locale, "records_close_named").replace(
          "{title}",
          message(locale, "capture_new_travel_update"),
        ),
      })
      .click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
}
