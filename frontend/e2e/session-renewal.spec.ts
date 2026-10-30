import { expect, test, type Route } from "@playwright/test";
import { choosePreferences, mockApi, ownerTrip, signInOwner } from "./mock-api";
import { locales, message } from "./messages";

for (const locale of locales) {
  test(`keeps a dirty trip dialog after refused renewal (${locale})`, async ({ page }) => {
    await mockApi(page);
    await signInOwner(page);
    await choosePreferences(page, locale, "dark");
    await page.setViewportSize({ width: 360, height: 740 });
    let renewals = 0;
    let authenticated = false;
    const identityProvider = async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/token")) {
        const headers = {
          "Access-Control-Allow-Origin": new URL(page.url()).origin,
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "content-type",
        };
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        authenticated = true;
        const payload = Buffer.from(JSON.stringify({ sub: "e2e-owner" })).toString("base64url");
        return route.fulfill({
          headers,
          contentType: "application/json",
          body: JSON.stringify({ access_token: `e30.${payload}.fresh`, expires_in: 3600 }),
        });
      }
      const silent = url.searchParams.get("prompt") === "none";
      if (silent) renewals++;
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.searchParams.set(silent ? "error" : "code", silent ? "login_required" : "code");
      callback.searchParams.set("state", url.searchParams.get("state")!);
      // An HTTP redirect, not a script navigation: Chromium's local-network
      // checks block a public-origin document from navigating a frame to localhost.
      await route.fulfill({ status: 302, headers: { Location: callback.href } });
    };
    await page.route("https://auth.tjor.im/**", identityProvider);
    await page.context().route("https://auth.tjor.im/**", identityProvider);

    await page.route(`**/api/trips/${ownerTrip.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await route.fulfill({
        status: authenticated ? 200 : 401,
        contentType: "application/json",
        body: authenticated
          ? JSON.stringify({ ...ownerTrip, title: "Unsaved synthetic draft" })
          : "{}",
      });
    });
    await page.goto(`/admin/trips/${ownerTrip.id}`);
    await page
      .getByRole("button", { name: message(locale, "owner_trip_details"), exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const title = dialog.getByRole("textbox", {
      name: message(locale, "owner_title"),
      exact: true,
    });
    await title.fill("Unsaved synthetic draft");
    await dialog
      .getByRole("button", { name: message(locale, "owner_save_trip"), exact: true })
      .click();
    await expect(
      page.getByText(message(locale, "owner_session_expired_save"), { exact: true }),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(title).toHaveValue("Unsaved synthetic draft");
    expect(renewals).toBe(1);
    const popupOpened = page.waitForEvent("popup");
    await dialog
      .getByRole("button", { name: message(locale, "owner_sign_in_again"), exact: true })
      .click();
    const popup = await popupOpened;
    await expect.poll(() => popup.isClosed()).toBe(true);
    await expect(title).toHaveValue("Unsaved synthetic draft");
    await expect(
      page.getByText(message(locale, "owner_session_expired_save"), { exact: true }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/admin/trips/${ownerTrip.id}$`));
    await dialog
      .getByRole("button", { name: message(locale, "owner_save_trip"), exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    expect(
      await page.evaluate(() => sessionStorage.getItem("travel-tracker-session")),
    ).not.toBeNull();
  });
}
