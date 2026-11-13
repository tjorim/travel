import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner, summaryOf } from "./mock-api";
import { message } from "./messages";

const base = `/api/trips/${ownerTrip.id}`;
const update = (id: string, title: string, visibility: string) => ({
  id,
  occurred_at: "2054-11-02T10:00:00Z",
  date_precision: "day",
  title,
  body: `Text of ${title}`,
  private_notes: null,
  area_id: null,
  area: null,
  location: null,
  media_asset_ids: [],
  visibility,
});
const asset = (id: string) => ({
  id,
  media_kind: "photo",
  byte_size: 100,
  content_type: "image/png",
  captured_at: null,
  captured_local: false,
  created_at: "2054-11-02T10:00:00Z",
  original_filename: `${id}.png`,
  camera_make: null,
  camera_model: null,
  gps: null,
  file_url: `${base}/media/${id}/file`,
  thumbnail_url: `${base}/media/${id}/thumbnail`,
});
const photos = ["p1", "p2", "p3", "p4", "p5", "p6"];

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1280, 390]) {
      test(`story rows show photos and a visitor preview ${locale} ${theme} ${width}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await mockApi(page);
        await page.route("**/api/trips**", (route) => {
          const { pathname } = new URL(route.request().url());
          const json = (body: unknown) =>
            route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
          const updates = [
            update("u1", "Six photos", "everyone"),
            update("u2", "Only mine", "private"),
          ];
          if (pathname === "/api/trips")
            return json([summaryOf({ ...ownerTrip, travel_updates: updates })]);
          if (pathname === `${base}/travel-updates`) return json(updates);
          if (pathname === `${base}/media`) return json(photos.map(asset));
          const copies = /\/media\/(p\d)\/derivatives$/.exec(pathname);
          if (copies)
            return json([
              {
                id: `c-${copies[1]}`,
                media_asset_id: copies[1],
                purpose: "share",
                review_state: "approved",
                travel_update_id: "u1",
                alt_text: `Photo ${copies[1]}`,
                caption: null,
              },
            ]);
          if (pathname.endsWith("/public-projection/preview"))
            return json({
              schema_version: "travel/public-trip@1",
              title: "Exampleland",
              summary: null,
              dates: null,
              visits: [],
              places: [],
              updates: [
                {
                  id: "update-1",
                  title: "Six photos",
                  body: "Text of Six photos",
                  body_html: "<p>Text of Six photos</p>",
                  date_precision: "day",
                  story_date: "2054-11-02",
                },
              ],
              stays: [],
              media: [],
              routes: [],
              navigation: [],
            });
          if (pathname === `${base}/public-projection`)
            return json({
              revision: 1,
              trip_id: ownerTrip.id,
              scope: {
                schema_version: "travel/share-scope@1",
                trip: { title: true, summary: true, dates: "day" },
                items: [],
              },
              surface_state: "published",
              slug: "exampleland",
            });
          return route.fallback();
        });
        await signInOwner(page);
        await choosePreferences(page, locale, theme);
        await page.goto(`${base.replace("/api", "/admin")}/story`);

        const strip = page.getByRole("list", {
          name: message(locale, "owner_photos_of_update").replace("{p0}", "Six photos"),
        });
        await expect(strip.getByRole("img")).toHaveCount(4);
        await expect(strip.getByText("+2")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(
          results.violations.map(
            (violation) =>
              `${violation.id} ${violation.nodes.map((n) => n.html.slice(0, 160)).join(" | ")}`,
          ),
        ).toEqual([]);

        const label = (title: string) =>
          message(locale, "owner_preview_as_visitor_for").replace("{p0}", title);
        await expect(page.getByRole("button", { name: label("Only mine") })).toBeDisabled();
        await expect(page.getByText(message(locale, "owner_preview_private_update"))).toBeVisible();

        const open = page.getByRole("button", { name: label("Six photos") });
        await open.click();
        const dialog = page.getByRole("dialog", {
          name: message(locale, "assets_public_preview"),
        });
        await expect(dialog.getByText("Text of Six photos").first()).toBeVisible();
        await dialog
          .getByRole("button", {
            name: message(locale, "owner_close").replace(
              "{p0}",
              message(locale, "assets_public_preview"),
            ),
          })
          .click();
        await expect(open).toBeFocused();
      });
    }
  }
}
