import type * as Api from "../src/api-schema";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { message, type Locale } from "./messages";
import { choosePreferences, mockApi, signInOwner, ownerTrip, summaryOf } from "./mock-api";

// Synthetic content only. A Dutch trip with an English title written already and an English summary still to write.
const trip = {
  ...ownerTrip,
  id: "trip-1",
  content_language: "nl" as const,
  title: "Rondreis Eilandland",
  title_nl: "Rondreis Eilandland",
  title_en: "Island tour",
  translation_freshness: {
    title: {
      nl_updated_at: "2054-10-10T00:00:00Z",
      en_updated_at: "2054-10-09T00:00:00Z",
      possibly_out_of_date: "en" as const,
    },
  },
  summary: "Drie weken over het eiland.",
  summary_nl: "Drie weken over het eiland.",
  summary_en: null,
  summary_html: "<p>Drie weken over het eiland.</p>",
  starts_on: "2054-11-01",
  ends_on: "2054-11-21",
  cover_url: null,
  travel_updates: [],
};

async function openOwner(page: Page, locale: Locale, theme: "light" | "dark") {
  await mockApi(page);
  await signInOwner(page);
  const patches: Record<string, unknown>[] = [];
  let current: Api.TripResponse = trip;
  await page.route("**/api/trips", (route) =>
    route.fulfill({
      json: [summaryOf({ ...ownerTrip, ...current })] satisfies Api.TripSummaryResponse[],
    }),
  );
  await page.route("**/api/trips/trip-1", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    patches.push(body);
    current = { ...current, ...body };
    return route.fulfill({ json: current satisfies Api.TripResponse });
  });
  await page.route("**/api/translation/drafts", (route) =>
    route.fulfill({
      json: {
        text: "Three weeks around the island.",
        source: "nl",
        target: "en",
        machine_translated: true,
      } satisfies Api.TranslationDraftResponse,
    }),
  );
  await choosePreferences(page, locale, theme);
  await page.goto("/admin/trips/trip-1");
  // On a phone the trip's details are in the account menu.
  if ((page.viewportSize()?.width ?? 1280) < 680)
    await page.getByRole("button", { name: "Account", exact: true }).click();
  await page
    .getByRole("button", { name: message(locale, "trips_trip_details"), exact: true })
    .click();
  return patches;
}

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [360, 1280]) {
      test(`owner edits both languages of a trip ${locale} ${theme} ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const patches = await openOwner(page, locale, theme);
        const dialog = page.getByRole("dialog");
        const titleLanguages = dialog.getByRole("radiogroup", {
          name: message(locale, "localized_language_of").replace(
            "{label}",
            message(locale, "common_title"),
          ),
        });
        // The trip's language is shown first, and the switch says what is still empty.
        await expect(titleLanguages.getByRole("radio").first()).toHaveAttribute(
          "aria-label",
          message(locale, "localized_choice_main").replace(
            "{language}",
            message(locale, "localized_dutch"),
          ),
        );
        const title = dialog.getByLabel(message(locale, "common_title"), { exact: true });
        await expect(title).toHaveValue("Rondreis Eilandland");
        await expect(title).toHaveAttribute("lang", "nl");

        await titleLanguages
          .getByRole("radio", {
            name: message(locale, "localized_choice_out_of_date").replace(
              "{language}",
              message(locale, "localized_english"),
            ),
          })
          .click();
        await expect(title).toHaveValue("Island tour");
        await expect(
          dialog.getByText(message(locale, "localized_possibly_out_of_date")),
        ).toBeVisible();
        await dialog
          .getByRole("button", { name: message(locale, "localized_still_correct") })
          .click();
        await expect(dialog.getByText(message(locale, "localized_review_pending"))).toBeVisible();
        expect(patches).toEqual([]);

        const summaryLanguages = dialog.getByRole("radiogroup", {
          name: message(locale, "localized_language_of").replace(
            "{label}",
            message(locale, "common_summary"),
          ),
        });
        await summaryLanguages
          .getByRole("radio", {
            name: new RegExp(`^${message(locale, "localized_english")}`),
          })
          .click();
        // Dutch text exists, English is empty: the one action is a draft from Dutch.
        await dialog
          .getByRole("button", { name: message(locale, "translations_draft_from_dutch") })
          .click();
        const summary = dialog.getByRole("textbox", {
          name: new RegExp(`^${message(locale, "common_summary")}`),
        });
        await expect(summary).toHaveValue("Three weeks around the island.");
        await expect(summary).toHaveAttribute("lang", "en");
        await expect(
          dialog.getByText(message(locale, "translations_unreviewed_draft_title")),
        ).toBeVisible();

        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(results.violations.map((violation) => violation.id)).toEqual([]);

        await dialog.getByRole("button", { name: message(locale, "trips_save_trip") }).click();
        await expect.poll(() => patches.length).toBe(1);
        expect(patches[0]).toMatchObject({
          title_nl: "Rondreis Eilandland",
          title_en: "Island tour",
          title_reviewed: "en",
          summary_nl: "Drie weken over het eiland.",
          summary_en: "Three weeks around the island.",
        });
        expect(patches[0]).not.toHaveProperty("content_language");
      });
    }
  }
}

test("the trip language change warns before moving every text", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const patches = await openOwner(page, "en", "light");
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("radiogroup", { name: message("en", "trips_content_language_label") })
    .getByRole("radio", { name: "English" })
    .click();
  await dialog.getByRole("checkbox").click();
  await dialog
    .getByRole("button", { name: message("en", "trips_content_language_action") })
    .click();
  const warning = page.getByRole("alertdialog");
  await expect(warning).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(patches).toEqual([]);
  await warning.getByRole("button", { name: "Move to English" }).click();
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({ content_language: "en", move_texts: true });
});

// --- The visitor page ---

const place = (label: string, extra: object = {}) => ({
  label,
  country_code: "TW",
  region: null,
  latitude: 25.13,
  longitude: 121.74,
  ...extra,
});
function delivered(language: "nl" | "en") {
  const dutch = language === "nl";
  return {
    schema_version: "travel/public-trip@1",
    title: dutch ? "Rondreis Eilandland" : "Island tour",
    summary: dutch ? "Drie weken over het eiland." : "Three weeks around the island.",
    summary_html: dutch
      ? "<p>Drie weken over het eiland.</p>"
      : "<p>Three weeks around the island.</p>",
    summary_text: dutch ? "Drie weken over het eiland." : "Three weeks around the island.",
    dates: { starts_on: "2054-11-01", ends_on: "2054-11-21", date_precision: "day" },
    numbers: { days: 1, areas: 1, countries: 1, nights: 0 },
    cover: null,
    // Only English exists for this visit's title: the Dutch page gets it as delivered, marked as English.
    visits: [
      {
        summary: null,
        summary_html: null,
        date_precision: "day",
        id: "visit-1",
        title: "Harbour walk",
        ...(dutch ? { title_lang: "en" } : {}),
        place: place(dutch ? "Keelung" : "Keelung City"),
      },
    ],
    places: [],
    updates: [
      {
        id: "update-a",
        title: dutch ? "Aankomst" : "Arrival",
        body: "x",
        body_html: dutch ? "<p>Het regende een beetje.</p>" : "<p>It rained a little.</p>",
        story_date: "2054-11-01",
        date_precision: "day",
        place: place(dutch ? "Keelung" : "Keelung City"),
      },
    ],
    stays: [],
    media: [],
    routes: [],
    navigation: [],
  } satisfies Api.ProjectionDocument;
}

async function openVisitor(
  page: Page,
  locale: Locale | null,
  theme: "light" | "dark",
): Promise<string[]> {
  const requests: string[] = [];
  await mockApi(page);
  await page.route("**/api/public/trips/exampleland-2054*", (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    const asked = url.searchParams.get("lang");
    // With none asked it is the trip's own language, Dutch, and the response says so.
    const language = asked === "en" ? "en" : "nl";
    return route.fulfill({
      json: delivered(language) satisfies Api.ProjectionDocument,
      headers: { "Content-Language": language },
    });
  });
  if (locale) {
    await choosePreferences(page, locale, theme);
    // The language control of a visitor who has used it before.
    await page.addInitScript(
      (chosen) => localStorage.setItem("travel-locale-choice", chosen),
      locale,
    );
  } else
    await page.addInitScript((storedTheme) => {
      localStorage.setItem("travel-appearance", storedTheme);
    }, theme);
  await page.goto("/trips/exampleland-2054");
  return requests;
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 1280]) {
    test(`visitor with no saved language reads the trip's own language ${theme} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const requests = await openVisitor(page, null, theme);
      await expect(
        page.getByRole("heading", { name: "Rondreis Eilandland", level: 1 }),
      ).toBeVisible();
      expect(requests[0]).toBe("/api/public/trips/exampleland-2054");
      await expect(page.locator("html")).toHaveAttribute("lang", "nl");
      // The authored texts carry the language they are written in; the English-only title says so.
      await expect(page.getByRole("heading", { name: "Rondreis Eilandland" })).toHaveAttribute(
        "lang",
        "nl",
      );
      await expect(page.getByRole("heading", { name: "Aankomst" })).toHaveAttribute("lang", "nl");
      await expect(page.getByText("Harbour walk").first()).toHaveAttribute("lang", "en");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`visitor changes language and the page asks for it again ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const requests = await openVisitor(page, "nl", theme);
    await expect(
      page.getByRole("heading", { name: "Rondreis Eilandland", level: 1 }),
    ).toBeVisible();
    // A language of their own: the first request already names it.
    expect(requests[0]).toBe("/api/public/trips/exampleland-2054?lang=nl");

    await page
      .getByRole("navigation", { name: message("nl", "visitor_navigation") })
      .getByRole("button", { name: message("nl", "visitor_preferences") })
      .click();
    await page
      .getByRole("dialog", { name: message("nl", "visitor_preferences") })
      .getByRole("radio", { name: "English", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Island tour", level: 1 })).toBeVisible();
    expect(requests.at(-1)).toBe("/api/public/trips/exampleland-2054?lang=en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Island tour" })).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Arrival" })).toHaveAttribute("lang", "en");
    // The page translated nothing: the Dutch text is gone with the Dutch document.
    await expect(page.getByText("Rondreis Eilandland")).toHaveCount(0);
  });
}
