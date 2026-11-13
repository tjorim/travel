import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import {
  choosePreferences,
  mockApi,
  mockSharingPresets,
  ownerTrip,
  presetArrival,
  presetVisit,
  signInOwner,
} from "./mock-api";
import { message, type Locale } from "./messages";

// Synthetic content only. `PRESET_SHOTS=<dir>` also saves screenshots for a visual check; they never go into Git.
const shots = process.env.PRESET_SHOTS;

const accessible = async (page: Page, include?: string) => {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  return (await (include ? builder.include(include) : builder).analyze()).violations;
};
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const name = (locale: Locale, key: string, values: Record<string, string> = {}) =>
  Object.entries(values).reduce(
    (text, [from, to]) => text.replace(`{${from}}`, to),
    message(locale, key),
  );
const story = (locale: Locale) => message(locale, "preset_story_and_route");

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`a draft link takes a preset after its review and lists the exceptions (${locale}, ${theme}, phone)`, async ({
      page,
    }) => {
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      const applies = await mockSharingPresets(page, "draft");
      await page.goto(`/admin/trips/${ownerTrip.id}/sharing`);
      await page.getByRole("button", { name: /Family/ }).click();

      const editor = page.getByRole("dialog");
      const reviewButton = editor.getByRole("button", {
        name: message(locale, "preset_review_button"),
      });
      await expect(reviewButton).toBeDisabled();
      await editor.getByRole("radio", { name: story(locale) }).click();
      await expect(reviewButton).toBeEnabled();
      await reviewButton.click();

      const dialog = page.getByRole("alertdialog", {
        name: name(locale, "preset_review_title", { preset: story(locale) }),
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(presetArrival.label)).toBeVisible();
      // A draft delivers nothing yet, so there is nothing to acknowledge.
      await expect(dialog.getByRole("checkbox")).toHaveCount(0);
      expect(await accessible(page, '[role="alertdialog"]')).toEqual([]);
      if (shots)
        await page.screenshot({ path: join(shots, `link-review-${locale}-${theme}-390.png`) });
      await dialog.getByRole("button", { name: message(locale, "preset_review_apply") }).click();

      await expect(dialog).toBeHidden();
      await expect.poll(() => applies.length).toBe(1);
      expect(applies[0]!.body).toEqual({
        preset: "story_and_route",
        fingerprint: "fingerprint-1",
        confirm_widening: false,
      });
      expect(applies[0]!.ifMatch).toBe('"1"');
      // Focus goes back to the control that opened the review.
      await expect(reviewButton).toBeFocused();
      await expect(editor.getByText(/(uitzondering|exception)/).first()).toBeVisible();
      const exceptions = editor.getByRole("region", {
        name: message(locale, "preset_exceptions_heading"),
      });
      await expect(exceptions.getByText(presetVisit.title)).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(await accessible(page)).toEqual([]);
      if (shots)
        await page.screenshot({ path: join(shots, `link-applied-${locale}-${theme}-390.png`) });

      // Hiding the exception uses the link's own exclusion list, in the editor, until it is saved.
      await exceptions
        .getByRole("button", {
          name: name(locale, "preset_exception_hide_named", { name: presetVisit.title }),
        })
        .click();
      await expect(exceptions.getByText(message(locale, "preset_exception_unsaved"))).toBeVisible();
    });
  }

  test(`an active link needs the widening acknowledgement before a preset applies (${locale}, laptop)`, async ({
    page,
  }) => {
    await mockApi(page);
    await signInOwner(page);
    await choosePreferences(page, locale, "light");
    await page.setViewportSize({ width: 1440, height: 900 });
    const applies = await mockSharingPresets(page, "active");
    await page.goto(`/admin/trips/${ownerTrip.id}/sharing`);
    await page.getByRole("button", { name: /Family/ }).click();
    const editor = page.getByRole("dialog");
    await editor.getByRole("radio", { name: story(locale) }).click();
    await editor.getByRole("button", { name: message(locale, "preset_review_button") }).click();

    const dialog = page.getByRole("alertdialog", {
      name: name(locale, "preset_review_title", { preset: story(locale) }),
    });
    const apply = dialog.getByRole("button", { name: message(locale, "preset_review_apply") });
    await expect(apply).toBeDisabled();
    expect(await accessible(page, '[role="alertdialog"]')).toEqual([]);
    if (shots) await page.screenshot({ path: join(shots, `link-live-${locale}-1440.png`) });
    await dialog
      .getByRole("checkbox", { name: message(locale, "preset_review_acknowledge") })
      .click();
    await apply.click();
    await expect.poll(() => applies.length).toBe(1);
    expect(applies[0]!.body).toMatchObject({ confirm_widening: true });
    // The Sharing check names the preset and its exceptions.
    await expect(dialog).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
    const check = page.getByRole("list", { name: message(locale, "sharing_check") });
    await expect(
      check.getByText(/(Voorinstelling|Preset): .*(1 uitzondering|1 exception)/),
    ).toBeVisible();
  });

  test(`the public page takes a preset and lists what it keeps showing (${locale}, laptop)`, async ({
    page,
  }) => {
    await mockApi(page);
    await signInOwner(page);
    await choosePreferences(page, locale, "light");
    await page.setViewportSize({ width: 1440, height: 900 });
    const applies = await mockSharingPresets(page, "draft");
    await page.goto(`/admin/trips/${ownerTrip.id}/sharing`);
    const audience = page.getByRole("group", {
      name: message(locale, "sharing_what_everyone_can_see"),
    });
    await audience.getByRole("radio", { name: story(locale) }).click();
    await audience.getByRole("button", { name: message(locale, "preset_review_button") }).click();
    const dialog = page.getByRole("alertdialog");
    // The public page cannot leave Everyone records out; the review says so and names the way out.
    await expect(dialog.getByText(message(locale, "preset_review_left_public"))).toBeVisible();
    await dialog
      .getByRole("checkbox", { name: message(locale, "preset_review_acknowledge") })
      .click();
    if (shots) await page.screenshot({ path: join(shots, `public-review-${locale}-1440.png`) });
    await dialog.getByRole("button", { name: message(locale, "preset_review_apply") }).click();
    await expect.poll(() => applies.length).toBe(1);
    expect(applies[0]!.url).toContain("/public-projection/preset");
    // The public view has no exclusions: the exception can only be resolved on the record itself.
    await expect(
      audience.getByText(message(locale, "preset_exception_way_out_everyone")),
    ).toBeVisible();
    if (shots) await page.screenshot({ path: join(shots, `public-applied-${locale}-1440.png`) });
    expect(await accessible(page)).toEqual([]);
  });
}
