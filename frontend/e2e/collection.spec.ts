import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi } from "./mock-api";

// Synthetic content only.
const token = "synthetic-collection-capability-0001";

const index = {
  schema_version: "travel/collection@1",
  title: "Shared with family",
  trips: [
    {
      id: "member-1",
      title: "Exampleland 2054",
      summary_text: "Three weeks around the island.",
      dates: { starts_on: "2054-11-01", ends_on: "2054-11-21", date_precision: "day" },
      cover: null,
    },
    { id: "member-2", title: null, summary_text: null, dates: null, cover: null },
  ],
};
const trip = {
  schema_version: "travel/unlisted-trip@1",
  title: "Exampleland 2054",
  summary: "Three weeks around the island.",
  summary_html: "<p>Three weeks around the island.</p>",
  summary_text: "Three weeks around the island.",
  dates: null,
  cover: null,
  visits: [],
  places: [],
  updates: [],
  stays: [],
  media: [],
  routes: [],
  navigation: [],
};

const viewports = {
  laptop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
} as const;

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const [device, viewport] of Object.entries(viewports)) {
      test(`collection index and trip page (${locale}, ${theme}, ${device})`, async ({ page }) => {
        const external: string[] = [];
        page.on("request", (request) => {
          if (new URL(request.url()).hostname !== "localhost") external.push(request.url());
        });
        await page.setViewportSize(viewport);
        await mockApi(page);
        await choosePreferences(page, locale, theme);
        await page.route(`**/api/shared/${token}`, (route) => route.fulfill({ json: index }));
        await page.route(`**/api/shared/${token}/trips/member-1`, (route) =>
          route.fulfill({ json: trip }),
        );

        await page.goto(`/share/${token}`);
        await expect(
          page.getByRole("heading", { level: 1, name: "Shared with family" }),
        ).toBeVisible();
        await expect(page.getByRole("link", { name: /Exampleland 2054/ })).toBeVisible();
        await expect(
          page.getByRole("heading", {
            name:
              locale === "en"
                ? "This link is saved on this browser"
                : "Deze link is bewaard in deze browser",
          }),
        ).toBeVisible();
        const noHorizontalScroll = await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        );
        expect(noHorizontalScroll).toBe(true);
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations).toEqual([]);

        await page.getByRole("link", { name: /Exampleland 2054/ }).click();
        await expect(page).toHaveURL(new RegExp(`/share/${token}/trips/member-1$`));
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Exampleland 2054");
        const back = page.getByRole("link", {
          name: locale === "en" ? "All trips in this link" : "Alle reizen in deze link",
        });
        await expect(back).toHaveAttribute("href", `/share/${token}`);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        expect(external.filter((url) => url.includes(token))).toEqual([]);
      });
    }
  }
}
