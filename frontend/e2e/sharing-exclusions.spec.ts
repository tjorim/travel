import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { message } from "./messages";

// Synthetic content only.
const visit = {
  id: "visit-1",
  title: "Night market",
  area: { label: "Taipei" },
  location: null,
  visibility: "everyone",
};
const link = (state: "draft" | "active", exclude: { kind: string; id: string }[]) => ({
  revision: 1,
  id: "link-1",
  series_id: "link-1",
  label: "Family",
  state,
  token: null,
  expires_at: null,
  created_at: "2054-01-01T00:00:00Z",
  activated_at: null,
  revoked_at: null,
  scope: {
    schema_version: "travel/share-scope@1",
    trip: { title: true, summary: true, dates: null },
    defaults: { date_precision: "month" },
    items: [],
    exclude,
  },
});
const review = (excluded: boolean) => ({
  baseline: [{ kind: "visit", id: visit.id }],
  excluded: excluded
    ? [
        {
          kind: "visit",
          id: visit.id,
          received: true,
          hides: { stay: 1 },
          also_hides: [{ kind: "stay", id: "stay-1" }],
        },
      ]
    : [],
  also_hidden: excluded ? { stay: 1 } : {},
  stale: 0,
});

async function openLinkEditor(
  page: Page,
  state: "draft" | "active",
  exclude: { kind: string; id: string }[],
) {
  const saves: { body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  await page.route(`**/api/trips/${ownerTrip.id}/visits`, (route) =>
    route.fulfill({ json: [visit] }),
  );
  await page.route(`**/api/trips/${ownerTrip.id}/share-links`, (route) =>
    route.fulfill({ json: [link(state, exclude)] }),
  );
  await page.route(`**/api/trips/${ownerTrip.id}/audit-events`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/trips/${ownerTrip.id}/share-scope/exclusion-review`, (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { exclude: unknown[] };
    return route.fulfill({ json: review(body.exclude.length > 0) });
  });
  await page.route(`**/api/trips/${ownerTrip.id}/share-links/link-1`, (route) => {
    const request = route.request();
    saves.push({ body: JSON.parse(request.postData() ?? "{}"), headers: request.headers() });
    if (saves.length === 1 && state === "active")
      return route.fulfill({
        status: 409,
        json: {
          detail: {
            code: "exclusion_widening_needs_acknowledgement",
            revealed: [{ kind: "visit", id: visit.id }],
            counts: { visit: 1, stay: 1 },
          },
        },
      });
    return route.fulfill({ json: link(state, []) });
  });
  await page.goto(`/admin/trips/${ownerTrip.id}/sharing`);
  await page.getByRole("button", { name: /Family/ }).click();
  return saves;
}

const accessible = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze())
    .violations;

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`a hidden link lists the public records it receives and shows what unticking one also hides (${locale}, ${theme}, phone)`, async ({
      page,
    }) => {
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await openLinkEditor(page, "draft", []);

      const section = page.getByRole("region", { name: message(locale, "exclusions_heading") });
      await expect(section).toBeVisible();
      await section
        .getByRole("button", { name: /Taipei|Night market|^\S/ })
        .first()
        .click();
      const checkbox = section.getByRole("checkbox", {
        name: message(locale, "exclusions_show_named").replace("{name}", "Night market"),
      });
      await expect(checkbox).toHaveAttribute("aria-checked", "true");
      await checkbox.click();
      await expect(checkbox).toHaveAttribute("aria-checked", "false");
      // The note comes from the server's review of the unticked record.
      await expect(section.getByText(/1 (verblijf|stay)/).first()).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(await accessible(page)).toEqual([]);
    });
  }

  test(`an active hidden link asks before it shows more because an exclusion was removed (${locale})`, async ({
    page,
  }) => {
    await mockApi(page);
    await signInOwner(page);
    await choosePreferences(page, locale, "light");
    const saves = await openLinkEditor(page, "active", [{ kind: "visit", id: visit.id }]);
    const section = page.getByRole("region", { name: message(locale, "exclusions_heading") });
    await section
      .getByRole("checkbox", {
        name: message(locale, "exclusions_show_named").replace("{name}", "Night market"),
      })
      .click();
    await page.getByRole("button", { name: message(locale, "sharing_save_link") }).click();

    const dialog = page.getByRole("alertdialog", {
      name: message(locale, "exclusions_widen_title"),
    });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", {
      name: message(locale, "exclusions_widen_confirm"),
    });
    await expect(confirm).toBeDisabled();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .include('[role="alertdialog"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(saves).toHaveLength(1);
    expect(saves[0]!.body).not.toHaveProperty("confirm_widening");

    await dialog
      .getByRole("checkbox", { name: message(locale, "exclusions_widen_acknowledge") })
      .click();
    await confirm.click();
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1]!.body).toMatchObject({ confirm_widening: true, scope: { exclude: [] } });
  });
}
