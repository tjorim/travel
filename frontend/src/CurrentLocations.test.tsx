// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CurrentLocations } from "./CurrentLocations";
import { changeLocale, formatInstant, formatRelativeTime } from "./locale";
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
          delay_seconds: 0,
          expires_at: "2026-11-10T00:00:00Z",
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
    screen.getByText(
      new RegExp(m.live_delay_value({ count: 1440, minutes: "1.440" }).split(":")[0]),
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(new RegExp(m.live_stale()))).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(60000));
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});

it("shows how long ago the position was observed, refreshes with the clock and labels the absolute time", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T12:12:00Z"));
  try {
    for (const locale of ["en", "nl"] as const) {
      act(() => changeLocale(locale));
      vi.setSystemTime(new Date("2026-11-09T12:12:00Z"));
      const { container, unmount } = render(
        <CurrentLocations
          positions={[
            {
              delay_seconds: 0,
              expires_at: "2054-01-01T00:00:00Z",
              latitude: 12.35,
              longitude: 45.68,
              observed_at: "2026-11-09T12:00:00Z",
              stale: false,
              precision: "1km",
            },
          ]}
        />,
      );
      const relative = (minutes: number) =>
        new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-minutes, "minute");
      const time = container.querySelector("time")!;
      expect(time).toHaveTextContent(relative(12));
      expect(time).toHaveAttribute("datetime", "2026-11-09T12:00:00Z");
      expect(time.getAttribute("title")).toBe(formatInstant(new Date("2026-11-09T12:00:00Z")));
      act(() => vi.advanceTimersByTime(30000 * 4));
      expect(container.querySelector("time")).toHaveTextContent(relative(14));
      unmount();
    }
  } finally {
    act(() => changeLocale("nl"));
  }
});

it.each([
  [5, "en", "now"],
  [90, "en", "1 minute ago"],
  [2 * 3600, "en", "2 hours ago"],
  [3 * 86400, "en", "3 days ago"],
  [5, "nl", "nu"],
  [90, "nl", "1 minuut geleden"],
  [2 * 3600, "nl", "2 uur geleden"],
] as const)("formats %i seconds ago in %s (%s)", (seconds, locale, expected) => {
  act(() => changeLocale(locale));
  try {
    const now = Date.parse("2026-11-09T12:00:00Z");
    expect(formatRelativeTime(new Date(now - seconds * 1000), now)).toBe(expected);
  } finally {
    act(() => changeLocale("nl"));
  }
});
