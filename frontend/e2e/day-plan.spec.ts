import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { choosePreferences, mockApi } from "./mock-api";

// Synthetic content only. The canaries are injected, never sent by the real server: a field outside the visitor
// allowlist reaching the page would be caught.
const PRIVATE = ["CANARY-PROPERTY-NAME", "CANARY-BOOKING-REF", "CANARY-PRIVATE-NOTE"];
const area = (label: string, latitude: number, longitude: number) => ({
  label,
  country_code: "TW",
  region: null,
  latitude,
  longitude,
});
const keelung = area("Keelung", 25.13, 121.74);
const tainan = area("Tainan", 22.99, 120.21);

const stay = (
  id: string,
  place: typeof keelung,
  starts_on: string,
  ends_on: string,
  extra = {},
) => ({
  id,
  title: place.label,
  place,
  date_precision: "day",
  starts_on,
  ends_on,
  property_name: PRIVATE[0],
  booking_reference: PRIVATE[1],
  ...extra,
});

/** A trip long enough to need the compact list: a stay across a month boundary, 23 days, repeat visits, mixed precision. */
const dayTrip = {
  schema_version: "travel/public-trip@1",
  title: "Exampleland 2054",
  summary: null,
  summary_html: null,
  summary_text: null,
  dates: { starts_on: "2054-10-30", ends_on: "2054-11-21", date_precision: "day" },
  cover: null,
  visits: [
    {
      id: "visit-harbour",
      title: "Harbour walk",
      place: keelung,
      date_precision: "day",
      starts_on: "2054-10-31",
      ends_on: null,
      private_notes: PRIVATE[2],
    },
    // Two visits on one day stay two visits.
    {
      id: "visit-market",
      title: "Night market",
      place: tainan,
      date_precision: "day",
      starts_on: "2054-11-12",
      ends_on: null,
      start_time: "18:30",
      end_time: "21:00",
      timezone: "Asia/Taipei",
    },
    {
      id: "visit-temple",
      title: "Temple morning",
      place: tainan,
      date_precision: "day",
      starts_on: "2054-11-12",
      ends_on: null,
    },
    {
      id: "visit-month",
      title: "Hot springs sometime",
      place: tainan,
      date_precision: "month",
      starts_on: "2054-11",
      ends_on: null,
    },
    { id: "visit-undated", title: "Tea tasting", place: tainan, date_precision: "day" },
  ],
  places: [],
  updates: [],
  stays: [
    stay("stay-keelung", keelung, "2054-10-30", "2054-11-12"),
    stay("stay-tainan", tainan, "2054-11-12", "2054-11-21"),
    stay("stay-coarse", tainan, "2054-11", "2054-11", { date_precision: "month" }),
  ],
  media: [],
  routes: [
    {
      id: "route-night",
      mode: "train",
      status: "planned",
      departure: keelung,
      arrival: tainan,
      departs_on: "2054-11-12",
      departs_at: "2054-11-12T14:00:00Z",
      arrives_at: "2054-11-12T17:30:00Z",
      departure_timezone: "UTC",
      arrival_timezone: "UTC",
      booking_reference: PRIVATE[1],
    },
    {
      id: "route-sleeper",
      mode: "train",
      status: "planned",
      label: "Sleeper south",
      departure: tainan,
      arrival: keelung,
      departs_on: "2054-11-20",
      departs_at: "2054-11-20T22:30:00Z",
      arrives_at: "2054-11-21T05:30:00Z",
      departure_timezone: "UTC",
      arrival_timezone: "UTC",
    },
    {
      id: "route-dayless",
      mode: "bus",
      status: "planned",
      label: "Bus to be planned",
      departure: keelung,
      arrival: tainan,
    },
  ],
  navigation: [],
};

/** The same trip as an audience sees it when only months are shared. */
const monthTrip = {
  ...dayTrip,
  schema_version: "travel/unlisted-trip@1",
  dates: { starts_on: "2054-10", ends_on: "2054-11", date_precision: "month" },
  visits: dayTrip.visits.map((visit) =>
    visit.starts_on
      ? { ...visit, date_precision: "month", starts_on: visit.starts_on.slice(0, 7), ends_on: null }
      : visit,
  ),
  stays: dayTrip.stays.map((item) => ({
    ...item,
    date_precision: "month",
    starts_on: item.starts_on.slice(0, 7),
    ends_on: item.ends_on.slice(0, 7),
  })),
  // Routes follow the audience's month setting too: the month only, and no departure times.
  routes: dayTrip.routes.map(
    ({
      departs_at: _at,
      arrives_at: _arrives,
      departure_timezone: _dz,
      arrival_timezone: _az,
      ...item
    }) =>
      item.departs_on
        ? { ...item, departs_on: item.departs_on.slice(0, 7), date_precision: "month" }
        : item,
  ),
};

async function open(
  page: Page,
  locale: "nl" | "en",
  theme: "light" | "dark",
  width: number,
  document: unknown,
  path: string,
) {
  await mockApi(page);
  await page.route(`**/api${path}`, (route) => route.fulfill({ json: document }));
  await choosePreferences(page, locale, theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path.replace("/public/trips", "/trips").replace("/shared", "/share"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Phones show one view at a time; the plan is its own tab.
  if (width < 1100) await page.getByRole("tab", { name: /Plan/ }).click();
}

const names = {
  en: {
    byDay: "By day",
    other: "Other plans",
    sleeping: "Sleeping in Keelung",
    out: "Check-out: Keelung",
  },
  nl: {
    byDay: "Per dag",
    other: "Overige plannen",
    sleeping: "Slapen in Keelung",
    out: "Uitchecken: Keelung",
  },
};

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1280, 390, 360]) {
      test(`day timeline shows days, nights and other plans ${locale} ${theme} ${width}`, async ({
        page,
      }, testInfo) => {
        await open(page, locale, theme, width, dayTrip, "/public/trips/exampleland-2054");
        const copy = names[locale];
        const plan = page.locator("[data-day-plan]");
        await expect(plan).toBeVisible();
        await expect(plan).toHaveAccessibleName(copy.byDay);
        await expect(plan.getByRole("heading", { level: 2, name: copy.byDay })).toBeVisible();

        // One section per day with something shared: the stay's own span plus the other dated records, no gaps filled.
        const days = await plan
          .locator("[data-day]")
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-day")));
        expect(days[0]).toBe("2054-10-30");
        expect(days).toContain("2054-10-31");
        expect(days).toContain("2054-11-01");
        expect(days.at(-1)).toBe("2054-11-21");
        expect(days).toHaveLength(23);
        expect([...days].sort()).toEqual(days);
        // Each day heading is a level 3 with the ISO date in markup.
        await expect(plan.locator("[data-day] > h3")).toHaveCount(23);
        await expect(plan.locator('[data-day="2054-10-30"] time')).toHaveAttribute(
          "datetime",
          "2054-10-30",
        );

        // The Keelung stay: check-in, each later night, check-out on the day it ends.
        await expect(
          plan.locator('[data-day="2054-10-30"] [data-day-entry="stay-check-in"]'),
        ).toHaveCount(1);
        for (const day of ["2054-10-31", "2054-11-01", "2054-11-11"])
          await expect(
            plan.locator(`[data-day="${day}"] [data-day-entry="stay-night"]`),
          ).toHaveText(copy.sleeping);
        await expect(
          plan.locator('[data-day="2054-11-12"] [data-day-entry="stay-check-out"]'),
        ).toHaveText(copy.out);

        // Repeat visits on one day, a route once on its departure day, never on its arrival day.
        await expect(plan.locator('[data-day="2054-11-12"] [data-day-entry="visit"]')).toHaveCount(
          2,
        );
        await expect(plan.locator("#route-route-night")).toHaveCount(1);
        await expect(plan.locator('[data-day="2054-11-12"] #route-route-night')).toHaveCount(1);
        await expect(plan.locator('[data-day="2054-11-21"] #route-route-sleeper')).toHaveCount(0);
        await expect(plan.locator('[data-day="2054-11-20"] #route-route-sleeper')).toHaveCount(1);
        await expect(plan.locator('[data-day="2054-11-21"]')).not.toContainText("Sleeper south");

        // Records without a day wait after the timeline, with their own precision, never inside a day.
        const other = page.locator("[data-other-plans]");
        await expect(other).toHaveAccessibleName(copy.other);
        await expect(other.locator("#visit-visit-month")).toHaveCount(1);
        await expect(other.locator("#visit-visit-undated")).toHaveCount(1);
        await expect(other.locator("#stay-stay-coarse")).toHaveCount(1);
        await expect(other.locator("#route-route-dayless")).toHaveCount(1);
        await expect(
          plan.locator("#visit-visit-month, #visit-visit-undated, #stay-stay-coarse"),
        ).toHaveCount(0);
        await expect(page.locator("[data-days-not-shown]")).toHaveCount(0);

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
        await plan.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("day-plan.png"), fullPage: true });
      });

      test(`month precision keeps the lists and says why ${locale} ${theme} ${width}`, async ({
        page,
      }, testInfo) => {
        await open(page, locale, theme, width, monthTrip, "/shared/exampleland-2054");
        await expect(page.locator("[data-day-plan], [data-other-plans], [data-day]")).toHaveCount(
          0,
        );
        const note = page.locator("[data-days-not-shown]");
        await expect(note).toBeVisible();
        await expect(note).toHaveText(
          locale === "en"
            ? "Exact days are not shown for this trip's visits and stays."
            : "Voor de bezoeken en verblijven van deze reis worden geen exacte dagen getoond.",
        );
        for (const heading of locale === "en"
          ? ["Visits", "Stays", "Routes"]
          : ["Bezoeken", "Verblijven", "Routes"])
          await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
        // Nothing is placed, ordered or counted into a day.
        await expect(page.locator("#visit-visit-harbour")).toContainText(
          locale === "en" ? "October 2054" : "oktober 2054",
        );
        // A route shows the month it leaves, never a day, and no departure time.
        await expect(page.locator("#route-route-sleeper")).toContainText(
          locale === "en" ? "November 2054" : "november 2054",
        );
        await expect(page.locator("#route-route-sleeper")).not.toContainText(/\b20\b|22:30/);
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
        await page.screenshot({ path: testInfo.outputPath("month-plan.png"), fullPage: true });
      });
    }
  }
}
