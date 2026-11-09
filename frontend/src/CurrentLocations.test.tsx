// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CurrentLocations } from "./CurrentLocations";
import { m } from "./paraglide/messages.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("marks an open position stale and removes it after 24 hours", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T00:00:00Z"));
  render(
    <CurrentLocations
      positions={[
        {
          latitude: 12.35,
          longitude: 45.68,
          observed_at: new Date().toISOString(),
          stale: false,
          precision: "1km",
        },
      ]}
    />,
  );
  expect(screen.getByRole("region", { name: m.live_current() })).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(3600000));
  expect(screen.getByText(new RegExp(m.live_stale()))).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(23 * 3600000));
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});
