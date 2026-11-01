import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";

// Synthetic content only.
const scope = {
  schema_version: "travel/share-scope@1",
  trip: { title: true, summary: false, dates: null },
  items: [],
};
const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
const collection = {
  id: "collection-1",
  label: "Relatives",
  title: null,
  state: "active",
  token: "synthetic-collection-capability-0001",
  expires_at: null,
  rotations: 0,
  created_at: "2054-01-01T00:00:00Z",
  updated_at: "2054-01-01T00:00:00Z",
  activated_at: "2054-01-02T00:00:00Z",
  revoked_at: null,
  members: [
    {
      revision: 1,
      id: "member-1",
      trip_id: ownerTrip.id,
      trip_title: ownerTrip.title,
      scope,
      delivered_records: 0,
      created_at: "2054-01-01T00:00:00Z",
      updated_at: "2054-01-01T00:00:00Z",
    },
  ],
};

const viewports = {
  laptop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
} as const;

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const [device, viewport] of Object.entries(viewports)) {
      test(`sharing overview and collection editor (${locale}, ${theme}, ${device})`, async ({
        page,
      }) => {
        await mockApi(page);
        await signInOwner(page);
        await choosePreferences(page, locale, theme);
        await page.setViewportSize(viewport);
        await page.route("**/api/collections", (route) => route.fulfill({ json: [collection] }));
        await page.route(`**/api/trips/${ownerTrip.id}/public-projection`, (route) =>
          route.fulfill({
            json: {
              revision: 1,
              trip_id: ownerTrip.id,
              scope,
              surface_state: "published",
              slug: "exampleland-2054",
            },
          }),
        );
        await page.route(`**/api/trips/${ownerTrip.id}/share-links`, (route) =>
          route.fulfill({
            json: [
              {
                revision: 1,
                id: "link-1",
                series_id: "link-1",
                label: "Family",
                state: "active",
                scope,
                token: "synthetic-link-capability-00000000001",
                expires_at: inTwoDays,
                created_at: "2054-01-01T00:00:00Z",
                activated_at: "2054-01-02T00:00:00Z",
                revoked_at: null,
              },
            ],
          }),
        );

        await page.goto("/admin/sharing");
        const heading = locale === "en" ? "Sharing overview" : "Overzicht delen";
        await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
        await expect(
          page.getByRole("heading", {
            name: locale === "en" ? "Needs attention" : "Aandacht nodig",
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("listitem", { name: "Family (Exampleland 2054)" }),
        ).toBeVisible();
        await expect(page.getByRole("listitem", { name: "Relatives" })).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
              .analyze()
          ).violations,
        ).toEqual([]);

        await page
          .getByRole("button", {
            name: locale === "en" ? "Edit Relatives" : "Relatives bewerken",
          })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText("Exampleland 2054")).toBeVisible();
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
              .include('[role="dialog"]')
              .analyze()
          ).violations,
        ).toEqual([]);
      });
    }
  }
}
