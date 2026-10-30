import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { message } from "./messages";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`sharing audit in ${locale}, ${theme}, narrow layout`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.route(`**/api/trips/${ownerTrip.id}/audit-events`, (route) =>
        route.fulfill({
          json: [
            {
              id: "scope",
              kind: "public_projection.scope_change",
              target_type: "public_surface",
              target_id: "hidden-target",
              occurred_at: "2026-10-30T10:00:00Z",
              details: {
                scope_version_before: "hidden-before",
                scope_version_after: "hidden-after",
              },
            },
            {
              id: "link",
              kind: "share_link.scope_change",
              target_type: "share_link",
              target_id: "hidden-link",
              occurred_at: "2026-10-30T09:00:00Z",
              details: {},
            },
            {
              id: "visibility",
              kind: "record.visibility_change",
              target_type: "record",
              target_id: "hidden-record",
              occurred_at: "2026-10-30T08:00:00Z",
              details: {
                record_kind: "travel_update",
                from: "everyone",
                to: "custom",
                newly_reached: [],
                no_longer_reached: ["public", "link:hidden-link"],
              },
            },
          ],
        }),
      );
      await page.goto(`/admin/trips/${ownerTrip.id}/sharing`);
      const audit = page.getByRole("region", { name: message(locale, "audit_heading") });
      await expect(audit.getByText(message(locale, "audit_public_scope"))).toBeVisible();
      await expect(audit.getByText(message(locale, "audit_link_scope"))).toBeVisible();
      await expect(audit.getByRole("listitem")).toHaveCount(3);
      await expect(audit).not.toContainText("hidden-");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const results = await new AxeBuilder({ page })
        .include("[aria-labelledby='sharing-audit-heading']")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
      await audit.screenshot({ path: `/tmp/travel-audit-${locale}-${theme}.png` });
    });
  }
}
