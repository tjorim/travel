import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, signInOwner } from "./mock-api";
import { message } from "./messages";

test.setTimeout(90_000);

for (const locale of ["nl", "en"] as const) {
  test(`capture drafts fence stale tabs and isolate accounts (${locale})`, async ({
    page,
    context,
  }) => {
    await mockApi(page);
    await signInOwner(page);
    await choosePreferences(page, locale, locale === "nl" ? "dark" : "light");
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/admin/capture", { waitUntil: "domcontentloaded" });
    const title = page.getByRole("textbox", { name: message(locale, "common_title"), exact: true });
    await title.fill("Synthetic original draft");
    await expect(
      page.getByText(message(locale, "capture_draft_saved_locally_not_sent_to_your_trip_yet"), {
        exact: true,
      }),
    ).toBeVisible();

    const other = await context.newPage();
    await mockApi(other);
    await signInOwner(other);
    await other.goto("/admin/capture", { waitUntil: "domcontentloaded" });
    const otherTitle = other.getByRole("textbox", {
      name: message(locale, "common_title"),
      exact: true,
    });
    await expect(otherTitle).toHaveValue("Synthetic original draft");
    await title.fill("Synthetic newer draft");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("travel-capture-draft-v3:e2e-owner:trip-1")!).draft
              .title,
        ),
      )
      .toBe("Synthetic newer draft");
    await otherTitle.fill("Synthetic stale draft");
    await expect(
      other.getByText(message(locale, "capture_draft_changed_in_another_tab"), { exact: true }),
    ).toBeVisible();
    await expect(otherTitle).toHaveValue("Synthetic stale draft");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("travel-capture-draft-v3:e2e-owner:trip-1")!).draft
              .title,
        ),
      )
      .toBe("Synthetic newer draft");
    await other.close();

    // A fresh B session uses the same browser storage and deliberately receives the old trip ID.
    const accountB = await context.newPage();
    await mockApi(accountB);
    await accountB.addInitScript(() => {
      sessionStorage.setItem(
        "travel-tracker-session",
        JSON.stringify({
          accessToken: `e30.${btoa(JSON.stringify({ sub: "synthetic-owner-B" }))}.`,
          expiresAt: Date.now() + 3600000,
        }),
      );
    });
    await accountB.goto("/admin/capture", { waitUntil: "domcontentloaded" });
    await expect(
      accountB.getByRole("textbox", { name: message(locale, "common_title"), exact: true }),
    ).toHaveValue("");
    await accountB.close();
  });
}
