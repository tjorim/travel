// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider } from "@/app/providers/auth-context";
import { renewSession } from "@/lib/auth";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  renewSession: vi.fn().mockRejectedValue(new TypeError("Offline")),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(renewSession).mockClear();
  sessionStorage.clear();
});

it("renews thirty seconds before expiry and on refocus without clearing an offline session", async () => {
  vi.useFakeTimers();
  const stored = JSON.stringify({ accessToken: "owner", expiresAt: Date.now() + 60_000 });
  sessionStorage.setItem("travel-session", stored);
  render(
    <AuthProvider>
      <p>Open editor</p>
    </AuthProvider>,
  );
  await act(() => vi.advanceTimersByTimeAsync(29_999));
  expect(renewSession).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(renewSession).toHaveBeenCalledTimes(1);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(renewSession).toHaveBeenCalledTimes(2);
  expect(sessionStorage.getItem("travel-session")).toBe(stored);
});
