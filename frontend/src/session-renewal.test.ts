// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw/http";
import { server } from "./mocks/server";
import { clearSession, freshSession, renewSession } from "./auth";

const tokenUrl = "https://auth.tjor.im/realms/travel/protocol/openid-connect/token";
beforeEach(() => {
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag, options) => {
    const element = create(tag, options);
    if (tag === "iframe")
      Object.defineProperty(element, "contentWindow", {
        value: { location: { replace: vi.fn() } },
      });
    return element;
  });
});
afterEach(() => {
  clearSession();
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

it("shares one renewal and validates the child source before exchanging its code", async () => {
  server.use(
    http.options(
      tokenUrl,
      () =>
        new HttpResponse(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": window.location.origin,
            "Access-Control-Allow-Methods": "POST",
            "Access-Control-Allow-Headers": "content-type",
          },
        }),
    ),
    http.post(tokenUrl, () => HttpResponse.json({ access_token: "fresh", expires_in: 120 })),
  );
  const first = renewSession();
  expect(renewSession()).toBe(first);
  const frame = document.querySelector("iframe")!;
  expect(frame).not.toBeNull();
  await vi.waitFor(() =>
    expect(sessionStorage.getItem("travel-tracker-pkce-transaction")).not.toBeNull(),
  );
  const { state } = JSON.parse(sessionStorage.getItem("travel-tracker-pkce-transaction")!);
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://attacker.invalid",
      source: frame.contentWindow!,
      data: { type: "travel-auth-callback", search: `?code=code&state=${state}` },
    }),
  );
  expect(document.querySelector("iframe")).toBe(frame);
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: window.location.origin,
      source: frame.contentWindow!,
      data: { type: "travel-auth-callback", search: `?code=code&state=${state}` },
    }),
  );
  await expect(first).resolves.toMatchObject({ accessToken: "fresh" });
  expect(document.querySelector("iframe")).toBeNull();
});

it("keeps the restore marker when silent renewal is refused", async () => {
  localStorage.setItem("travel-tracker-may-restore-session", "1");
  const pending = renewSession();
  const rejected = expect(pending).rejects.toThrow();
  const frame = document.querySelector("iframe")!;
  await vi.waitFor(() =>
    expect(sessionStorage.getItem("travel-tracker-pkce-transaction")).not.toBeNull(),
  );
  const { state } = JSON.parse(sessionStorage.getItem("travel-tracker-pkce-transaction")!);
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: window.location.origin,
      source: frame.contentWindow!,
      data: { type: "travel-auth-callback", search: `?error=login_required&state=${state}` },
    }),
  );
  await rejected;
  expect(localStorage.getItem("travel-tracker-may-restore-session")).toBe("1");
});

it("reuses a concurrently renewed token and explicit sign-out cancels renewal", async () => {
  const session = { accessToken: "fresh", expiresAt: Date.now() + 120_000 };
  sessionStorage.setItem("travel-tracker-session", JSON.stringify(session));
  await expect(freshSession({ accessToken: "old", expiresAt: 0 }, true)).resolves.toEqual(session);
  const pending = renewSession();
  const rejected = expect(pending).rejects.toThrow("Signed out");
  clearSession();
  await rejected;
  expect(sessionStorage.getItem("travel-tracker-session")).toBeNull();
  expect(document.querySelector("iframe")).toBeNull();
});
