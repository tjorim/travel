// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { clearSession, completeSignIn, readSession, shouldRestoreSession } from "./auth";

const transactionKey = "travel-tracker-pkce-transaction";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function transaction(silent: boolean) {
  sessionStorage.setItem(
    transactionKey,
    JSON.stringify({ codeVerifier: "verifier", returnPath: "/trips", state: "state", silent }),
  );
}

describe("owner browser session recovery", () => {
  it("keeps only a non-secret restoration marker after a successful sign-in", async () => {
    transaction(false);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ access_token: "access", expires_in: 60 }), { status: 200 })),
    );

    await expect(completeSignIn("?code=code&state=state")).resolves.toMatchObject({ returnPath: "/trips" });

    expect(readSession()).toMatchObject({ accessToken: "access" });
    expect(shouldRestoreSession()).toBe(true);
    expect(localStorage.getItem("travel-tracker-may-restore-session")).toBe("1");
    expect(localStorage.getItem("travel-tracker-session")).toBeNull();
  });

  it("requests silent recovery when browser session storage is unavailable", async () => {
    transaction(false);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ access_token: "access", expires_in: 60 }), { status: 200 })),
    );
    await completeSignIn("?code=code&state=state");

    sessionStorage.clear();

    expect(readSession()).toBeNull();
    expect(shouldRestoreSession()).toBe(true);
  });

  it("does not retry a failed silent recovery and removes its marker", async () => {
    localStorage.setItem("travel-tracker-may-restore-session", "1");
    transaction(true);

    await expect(completeSignIn("?error=login_required&state=state")).rejects.toThrow("sessie is verlopen");

    expect(shouldRestoreSession()).toBe(false);
    expect(localStorage.getItem("travel-tracker-may-restore-session")).toBeNull();
  });

  it("removes both the credential and restoration marker on explicit sign-out", async () => {
    transaction(false);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ access_token: "access", expires_in: 60 }), { status: 200 })),
    );
    await completeSignIn("?code=code&state=state");

    clearSession();

    expect(readSession()).toBeNull();
    expect(shouldRestoreSession()).toBe(false);
  });
});
