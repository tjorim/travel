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
  act(() => vi.advanceTimersByTime(3630000));
  expect(screen.getByText(new RegExp(m.live_stale()))).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(23 * 3600000 - 30000));
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});

it("shows a day-delayed observation while fresh delivery expires independently", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
  render(
    <CurrentLocations
      positions={[
        {
          latitude: 12.35,
          longitude: 45.68,
          precision: "1km",
          stale: false,
          observed_at: "2026-11-09T00:00:00Z",
          delay_seconds: 86400,
          expires_at: "2026-11-10T00:01:00Z",
        },
      ]}
    />,
  );
  expect(screen.getByRole("region")).toBeInTheDocument();
  expect(
    screen.getByText(new RegExp(m.live_delay_value({ minutes: "1.440" }).split(":")[0])),
  ).toBeInTheDocument();
  expect(screen.queryByText(new RegExp(m.live_stale()))).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(60000));
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});
