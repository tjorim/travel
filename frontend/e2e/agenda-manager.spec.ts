import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { routeAgendaRecords } from "./agenda-records";
import { locales, message, type Locale } from "./messages";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";

// The agenda as the place where visits, stays and routes are managed: status and audience on the row, a row menu,
// filters, and creating, editing, deleting and sharing without leaving it. Synthetic content only.

async function openPlan(page: Page, locale: Locale, theme: "light" | "dark", width: number) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  await mockApi(page);
  await signInOwner(page);
  await choosePreferences(page, locale, theme);
  const records = await routeAgendaRecords(page);
  await page.goto(`/admin/trips/${ownerTrip.id}/plan`);
  const agenda = page.locator("#agenda");
  await expect(title(agenda, /Harbour walk/)).toBeVisible();
  return { records, agenda };
}

/** A record's own row title (its menu button repeats the name, and a stay's later nights are rows too). */
const title = (agenda: Locator, name: RegExp) =>
  agenda.locator("[data-agenda-record]").filter({ hasText: name });
const rowOf = (agenda: Locator, name: RegExp) =>
  agenda.getByRole("listitem").filter({
    has: agenda.page().locator("[data-agenda-record]", { hasText: name }),
  });

for (const locale of locales) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [360, 1440]) {
      const setup = `${locale} ${theme} ${width}`;

      test(`rows say what sets them apart and open a menu without axe violations ${setup}`, async ({
        page,
      }) => {
        const { agenda } = await openPlan(page, locale, theme, width);
        // An idea and a shared record say so; a private plan adds nothing to its row.
        await expect(rowOf(agenda, /Night market/)).toContainText(message(locale, "trips_idea"));
        await expect(rowOf(agenda, /Train to Tainan/)).toContainText(
          message(locale, "publication_everyone"),
        );
        await expect(rowOf(agenda, /Harbour walk/)).not.toContainText(
          message(locale, "publication_everyone"),
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        expect((await new AxeBuilder({ page }).include("#agenda").analyze()).violations).toEqual(
          [],
        );

        // With the menu open the whole page is checked, since the menu is drawn above it.
        await agenda
          .getByRole("button", {
            name: message(locale, "agenda_row_actions").replace("{title}", "Harbour walk"),
          })
          .click();
        await expect(page.getByRole("menuitem")).toHaveText([
          message(locale, "common_edit"),
          message(locale, "visits_show_on_map_action"),
          message(locale, "common_save_offline"),
          message(locale, "common_delete"),
        ]);
        // The menu is drawn in a portal, outside the page's landmarks: the best-practice "region" rule does not apply.
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
      });

      test(`edit and delete from a row, with focus kept on the list ${setup}`, async ({ page }) => {
        const { records, agenda } = await openPlan(page, locale, theme, width);
        const actions = (title: string) =>
          agenda.getByRole("button", {
            name: message(locale, "agenda_row_actions").replace("{title}", title),
          });

        // Keyboard only: open the menu on the row, choose Edit, leave with Escape: focus is back on the menu button.
        await actions("Harbour walk").focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("menu")).toBeVisible();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: message(locale, "visits_edit_visit") });
        await expect(dialog).toBeVisible();
        expect(
          (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
        ).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(actions("Harbour walk")).toBeFocused();

        // Edit: the new title shows on the row, and the status line says it was saved.
        await actions("Harbour walk").click();
        await page.getByRole("menuitem", { name: message(locale, "common_edit") }).click();
        await dialog
          .getByRole("textbox", { name: message(locale, "common_title"), exact: false })
          .first()
          .fill("Old harbour walk");
        await dialog.getByRole("button", { name: message(locale, "visits_save_visit") }).click();
        await expect(dialog).toHaveCount(0);
        await expect(title(agenda, /Old harbour walk/)).toBeVisible();
        await expect(agenda.getByRole("status").first()).toHaveText(
          message(locale, "visits_visit_saved"),
        );
        expect(records.writes.at(-1)).toMatchObject({
          method: "PATCH",
          path: "/api/trips/trip-1/visits/visit-1",
          body: { title: "Old harbour walk" },
        });

        // Delete: a question first, and cancelling it changes nothing.
        await actions("Old harbour walk").click();
        await page.getByRole("menuitem", { name: message(locale, "common_delete") }).click();
        const question = page.getByRole("alertdialog");
        await expect(question).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await question.getByRole("button", { name: message(locale, "cancel") }).click();
        await expect(question).toHaveCount(0);
        await expect(actions("Old harbour walk")).toBeFocused();

        await page.keyboard.press("Enter");
        await page.getByRole("menuitem", { name: message(locale, "common_delete") }).click();
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: message(locale, "common_delete") })
          .click();
        await expect(title(agenda, /Old harbour walk/)).toHaveCount(0);
        expect(records.writes.at(-1)).toMatchObject({
          method: "DELETE",
          path: "/api/trips/trip-1/visits/visit-1",
        });
        await expect(agenda.getByRole("status").first()).toHaveText(
          message(locale, "visits_visit_deleted"),
        );
        // The row is gone: focus is on the row before it (the stay on the same day), not lost to the page or a filter.
        await expect(title(agenda, /Hotel Aurora/)).toBeFocused();
      });

      test(`create, and change who sees a record, from the agenda ${setup}`, async ({ page }) => {
        const { records, agenda } = await openPlan(page, locale, theme, width);

        // New: no day needed. The visit lands under "No day yet" and its row takes focus.
        await agenda
          .getByRole("button", { name: message(locale, "agenda_new"), exact: true })
          .click();
        await page.getByRole("menuitem", { name: message(locale, "visits_new_visit") }).click();
        const dialog = page.getByRole("dialog", { name: message(locale, "visits_add_visit") });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("combobox", { name: message(locale, "visits_where") }),
        ).toBeVisible();
        await dialog.getByRole("combobox", { name: message(locale, "visits_where") }).click();
        await page
          .getByRole("option", { name: /Tainan/ })
          .first()
          .click();
        await dialog
          .getByRole("textbox", { name: message(locale, "common_title"), exact: false })
          .first()
          .fill("Tea house");
        await dialog
          .getByRole("button", { name: message(locale, "visits_add_visit"), exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        const created = title(agenda, /Tea house/);
        await expect(created).toBeVisible();
        await expect(created).toBeFocused();
        expect(records.writes.at(-1)).toMatchObject({
          method: "POST",
          path: "/api/trips/trip-1/visits",
          body: { title: "Tea house", starts_on: null },
        });

        // Audience: set where the owner sees what sharing means, in the record's dialog; the row then says it.
        await created.click();
        const details = page.getByRole("dialog", { name: message(locale, "common_visit") });
        await details
          .getByRole("combobox", {
            name: message(locale, "publication_visibility_for").replace("{name}", "Tea house"),
          })
          .click();
        await page
          .getByRole("option", { name: message(locale, "publication_everyone_all_visitors") })
          .click();
        await expect
          .poll(() => records.writes.at(-1)?.path)
          .toBe("/api/trips/trip-1/visibility/visit/visit-12");
        expect(records.writes.at(-1)?.body).toEqual({ visibility: "everyone" });
        await page.keyboard.press("Escape");
        await expect(details).toHaveCount(0);
        await expect(rowOf(agenda, /Tea house/)).toContainText(
          message(locale, "publication_everyone"),
        );
      });

      test(`filters by kind and status, and remembers the choice for the trip ${setup}`, async ({
        page,
      }) => {
        const { agenda } = await openPlan(page, locale, theme, width);
        const kinds = agenda.getByRole("group", { name: message(locale, "agenda_filter_kind") });
        const statuses = agenda.getByRole("group", {
          name: message(locale, "agenda_filter_status"),
        });
        await kinds
          .getByRole("button", { name: message(locale, "common_stays"), exact: true })
          .click();
        await expect(title(agenda, /Harbour walk/)).toHaveCount(0);
        await expect(title(agenda, /Hotel Aurora/)).toBeVisible();
        expect((await new AxeBuilder({ page }).include("#agenda").analyze()).violations).toEqual(
          [],
        );

        await page.reload();
        await expect(title(agenda, /Hotel Aurora/)).toBeVisible();
        await expect(title(agenda, /Harbour walk/)).toHaveCount(0);
        await expect(
          kinds.getByRole("button", { name: message(locale, "common_stays"), exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        // The address is untouched: the filter is a convenience of this browser.
        expect(new URL(page.url()).search).toBe("");

        await kinds
          .getByRole("button", { name: message(locale, "common_stays"), exact: true })
          .click();
        await statuses.getByRole("button", { name: message(locale, "agenda_status_idea") }).click();
        await expect(title(agenda, /Night market/)).toBeVisible();
        await expect(title(agenda, /Harbour walk/)).toHaveCount(0);
        await agenda.getByRole("button", { name: message(locale, "agenda_filter_clear") }).click();
        await expect(title(agenda, /Harbour walk/)).toBeVisible();
      });

      test(`the old #visits, #stays and #routes links and the jump search land on the agenda with that kind ${setup}`, async ({
        page,
      }) => {
        const { agenda } = await openPlan(page, locale, theme, width);
        const kinds = agenda.getByRole("group", { name: message(locale, "agenda_filter_kind") });
        const seen = {
          visits: [/Harbour walk/, [/Hotel Aurora/, /Train to Tainan/], "common_visits"],
          stays: [/Hotel Aurora/, [/Harbour walk/, /Train to Tainan/], "common_stays"],
          routes: [/Train to Tainan/, [/Harbour walk/, /Hotel Aurora/], "common_routes"],
        } as const;
        for (const [hash, [shown, hidden, label]] of Object.entries(seen)) {
          await page.goto(`/admin/trips/${ownerTrip.id}/overview`);
          await page.goto(`/admin/trips/${ownerTrip.id}/plan#${hash}`);
          await expect(title(agenda, shown)).toBeVisible();
          for (const other of hidden) await expect(title(agenda, other)).toHaveCount(0);
          // Every status is shown, as the old block listed all of them.
          await expect(
            kinds.getByRole("button", { name: message(locale, label), exact: true }),
          ).toHaveAttribute("aria-pressed", "true");
          expect(new URL(page.url()).hash).toBe(`#${hash}`);
          // No block of its own is left behind.
          await expect(page.locator(`#${hash}`)).toHaveCount(0);
        }
        expect((await new AxeBuilder({ page }).include("#agenda").analyze()).violations).toEqual(
          [],
        );

        // The jump search keeps its entries for the three kinds, now on the same alias.
        await page.goto(`/admin/trips/${ownerTrip.id}/overview`);
        const search = page.getByRole("combobox", { name: message(locale, "workspace_jump_to") });
        await search.fill(message(locale, "common_stays"));
        await page
          .getByRole("option", {
            name: `${message(locale, "workspace_plan")} › ${message(locale, "common_stays")}`,
          })
          .click();
        await expect(title(agenda, /Hotel Aurora/)).toBeVisible();
        await expect(title(agenda, /Harbour walk/)).toHaveCount(0);
      });
    }
  }
}
