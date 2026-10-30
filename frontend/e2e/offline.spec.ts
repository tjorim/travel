import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choosePreferences, mockApi, signInOwner } from "./mock-api";

for (const locale of ["nl", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`offline content age ${locale} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await mockApi(page);
      await signInOwner(page);
      await choosePreferences(page, locale, theme);
      await page.goto("/admin/library");
      await page.evaluate(async () => {
        const path = "/admin/src/offline/offline-store.ts";
        const { pinOfflineCopy, offlineContentValidator } = await import(/* @vite-ignore */ path);
        const session = JSON.parse(sessionStorage.getItem("travel-tracker-session")!);
        const subject = JSON.parse(atob(session.accessToken.split(".")[1])).sub;
        await pinOfflineCopy({
          subject,
          resourceKind: "emergency_info",
          resourceId: "synthetic-contact",
          metadataUrl: "/api/library/emergency-info/synthetic-contact",
          title: "Synthetic emergency contact",
          contentType: "application/json",
          bytes: new TextEncoder().encode(
            JSON.stringify({ label: "Synthetic contact", value: "contact@example.test" }),
          ).buffer,
          contentValidator: await offlineContentValidator({ value: "old" }),
        });
      });
      await page.reload();
      const row = page.getByRole("article").filter({ hasText: "Synthetic emergency contact" });
      await expect(row.getByText(locale === "nl" ? /^Opgeslagen / : /^Saved /)).toBeVisible();
      await expect(row.getByRole("status")).toContainText(
        locale === "nl" ? "Nieuwere versie beschikbaar" : "Newer version available",
      );
      await expect(
        row.getByRole("button", { name: locale === "nl" ? "Bekijken" : "View", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("offline.png"), fullPage: true });
      expect(
        (
          await new AxeBuilder({ page })
            .include('section[aria-labelledby="offline-title"]')
            .analyze()
        ).violations,
      ).toEqual([]);
    });
  }
}
