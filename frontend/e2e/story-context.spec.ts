import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { choosePreferences, mockApi } from "./mock-api";

// Synthetic authored content only. The private strings below are never sent by the real server; they are injected so
// that any field outside the visitor allowlist reaching the page would be caught.
const PRIVATE = [
  "CANARY-PRIVATE-VISIT",
  "CANARY-PROPERTY-NAME",
  "CANARY-BOOKING-REF",
  "CANARY-PRIVATE-NOTE",
];
const area = (label: string, latitude: number, longitude: number) => ({
  label,
  country_code: "TW",
  region: null,
  latitude,
  longitude,
});
const keelung = area("Keelung", 25.13, 121.74);
const tainan = area("Tainan", 22.99, 120.21);
const data = {
  schema_version: "travel/public-trip@1",
  title: "Exampleland 2054",
  summary: null,
  summary_html: null,
  summary_text: null,
  dates: { starts_on: "2054-11-01", ends_on: "2054-11-21", date_precision: "day" },
  cover: null,
  visits: [
    {
      id: "visit-a",
      title: "Harbour walk",
      place: keelung,
      date_precision: "day",
      starts_on: "2054-11-01",
      ends_on: null,
      private_title: PRIVATE[0],
      private_notes: PRIVATE[3],
    },
    {
      id: "visit-undated",
      title: "Night market",
      place: tainan,
      date_precision: "month",
      starts_on: "2054-11",
      ends_on: null,
    },
    // Two updates in Tainan on this day make the visit ambiguous, so it keeps its compact separate block.
    {
      id: "visit-repeat",
      title: "Old street again",
      place: tainan,
      date_precision: "day",
      starts_on: "2054-11-05",
      ends_on: null,
    },
  ],
  places: [],
  updates: [
    {
      id: "update-a",
      title: "Arrival",
      body: "Landed.",
      body_html: "<p>Landed.</p>",
      story_date: "2054-11-01",
      date_precision: "day",
      place: keelung,
    },
    {
      id: "update-b",
      title: "Morning in Tainan",
      body: "Slow.",
      body_html: "<p>Slow.</p>",
      story_date: "2054-11-05",
      date_precision: "day",
      place: tainan,
    },
    {
      id: "update-c",
      title: "Evening in Tainan",
      body: "Lights.",
      body_html: "<p>Lights.</p>",
      story_date: "2054-11-05",
      date_precision: "day",
      place: tainan,
    },
  ],
  stays: [
    {
      id: "stay-a",
      title: "Keelung",
      place: keelung,
      date_precision: "day",
      starts_on: "2054-11-01",
      ends_on: "2054-11-03",
      property_name: PRIVATE[1],
      booking_reference: PRIVATE[2],
    },
  ],
  media: [],
  routes: [
    {
      id: "route-a",
      mode: "train",
      status: "planned",
      departure: keelung,
      arrival: tainan,
      departs_on: "2054-11-01",
      booking_reference: PRIVATE[2],
    },
  ],
  navigation: [],
};

async function open(page: Page, locale: "nl" | "en", theme: "light" | "dark") {
  await mockApi(page);
  await page.route("**/api/public/trips/exampleland-2054", (route) =>
    route.fulfill({ json: data }),
  );
  await choosePreferences(page, locale, theme);
  await page.goto("/trips/exampleland-2054");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1280, 390]) {
      test(`area and day context sits with its update ${locale} ${theme} ${width}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await open(page, locale, theme);
        const grouped = page.locator("article [data-update-context]");
        await expect(grouped).toHaveCount(1);
        const label = locale === "en" ? "Same area and day" : "Zelfde plek en dag";
        await expect(grouped).toHaveAccessibleName(label);
        const arrival = page.locator("#update-a");
        await expect(arrival.locator("[data-update-context]")).toContainText("Harbour walk");
        await expect(arrival.locator("[data-update-context]")).toContainText("Keelung");
        await expect(arrival.locator("[data-update-context] #route-route-a")).toHaveCount(1);
        await expect(arrival.locator("[data-update-context] #stay-stay-a")).toHaveCount(1);
        // The ambiguous repeat visit and the month-precision visit keep their own blocks.
        await expect(page.locator("#visit-visit-repeat [data-update-context]")).toHaveCount(0);
        await expect(page.locator("#visit-visit-repeat")).toHaveCount(1);
        await expect(page.locator("#visit-visit-undated")).toHaveCount(1);
        await expect(page.locator("#visit-visit-a")).toHaveCount(1);
        const html = await page.content();
        for (const value of PRIVATE) expect(html).not.toContain(value);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
              .analyze()
          ).violations.map((violation) => violation.id),
        ).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath("context.png"), fullPage: true });
      });
    }
  }
}
