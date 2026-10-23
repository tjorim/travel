// @vitest-environment happy-dom

import { http, HttpResponse } from "msw/http";
import { afterEach, describe, expect, it } from "vitest";

import { server } from "./mocks/server";
import { clearSession, completeSignIn, readSession, shouldRestoreSession } from "./auth";

const transactionKey = "travel-tracker-pkce-transaction";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

/** Answers the identity provider's token endpoint with a short-lived access token. */
function serveToken() {
  server.use(
    http.post("*/protocol/openid-connect/token", () =>
      HttpResponse.json({ access_token: "access", expires_in: 60 }),
    ),
  );
}

function transaction(silent: boolean) {
  sessionStorage.setItem(
    transactionKey,
    JSON.stringify({ codeVerifier: "verifier", returnPath: "/trips", state: "state", silent }),
  );
}

describe("owner browser session recovery", () => {
  it("keeps only a non-secret restoration marker after a successful sign-in", async () => {
    transaction(false);
    serveToken();

    await expect(completeSignIn("?code=code&state=state")).resolves.toMatchObject({
      returnPath: "/trips",
    });

    expect(readSession()).toMatchObject({ accessToken: "access" });
    expect(shouldRestoreSession()).toBe(true);
    expect(localStorage.getItem("travel-tracker-may-restore-session")).toBe("1");
    expect(localStorage.getItem("travel-tracker-session")).toBeNull();
  });

  it("requests silent recovery when browser session storage is unavailable", async () => {
    transaction(false);
    serveToken();
    await completeSignIn("?code=code&state=state");

    sessionStorage.clear();

    expect(readSession()).toBeNull();
    expect(shouldRestoreSession()).toBe(true);
  });

  it("does not retry a failed silent recovery and removes its marker", async () => {
    localStorage.setItem("travel-tracker-may-restore-session", "1");
    transaction(true);

    await expect(completeSignIn("?error=login_required&state=state")).rejects.toThrow(
      "sessie is verlopen",
    );

    expect(shouldRestoreSession()).toBe(false);
    expect(localStorage.getItem("travel-tracker-may-restore-session")).toBeNull();
  });

  it("removes both the credential and restoration marker on explicit sign-out", async () => {
    transaction(false);
    serveToken();
    await completeSignIn("?code=code&state=state");

    clearSession();

    expect(readSession()).toBeNull();
    expect(shouldRestoreSession()).toBe(false);
  });
});
