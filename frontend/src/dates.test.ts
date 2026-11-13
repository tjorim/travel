// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import {
  captureInputValue,
  formatCapture,
  formatUpdateInstant,
  updateDateLabel,
  updateWallClock,
} from "./dates";

afterEach(() => {
  vi.unstubAllEnvs();
});

it.each(["Europe/Brussels", "America/Los_Angeles", "Pacific/Auckland", "Asia/Taipei"])(
  "shows a camera wall-clock capture time as written for a viewer in %s",
  (zone) => {
    vi.stubEnv("TZ", zone);
    expect(formatCapture("2054-11-20T10:15:00Z", true)).toBe("20 nov 2054, 10:15");
    expect(formatCapture("2054-11-20T10:15:00Z", true, "HH:mm")).toBe("10:15");
    expect(captureInputValue("2054-11-20T10:15:00Z", true)).toBe("2054-11-20T10:15");
  },
);

it("keeps showing other capture times as instants in the viewer's zone", () => {
  vi.stubEnv("TZ", "Asia/Taipei");
  expect(formatCapture("2054-11-20T10:15:00Z", false)).toBe("20 nov 2054, 18:15");
  expect(captureInputValue("2054-11-20T10:15:00Z", false)).toBe("2054-11-20T18:15");
});

it.each([
  // Shortly after local midnight in UTC+8, and shortly before it in UTC-8: the day the visitor is given.
  ["Asia/Taipei", "2054-11-19T23:00:00Z", "20 nov 2054, 07:00"],
  ["America/Los_Angeles", "2054-11-20T07:30:00Z", "19 nov 2054, 23:30"],
  // Daylight saving time: PDT in July is UTC-7.
  ["America/Los_Angeles", "2054-07-01T06:30:00Z", "30 jun 2054, 23:30"],
])(
  "reads an update in %s on the day of its zone (%s), from a browser in a third zone",
  (timezone, occurred_at, expected) => {
    vi.stubEnv("TZ", "Europe/Brussels");
    expect(formatUpdateInstant({ occurred_at, timezone })).toBe(expected);
    expect(updateDateLabel({ occurred_at, timezone, share_date_precision: "day" })).toBe(expected);
  },
);

it.each([
  // Just either side of local midnight in UTC+8 and in UTC-8, read in a browser set to neither.
  ["Asia/Taipei", "2054-11-19T15:59:00Z", "2054-11-19T23:59"],
  ["Asia/Taipei", "2054-11-19T16:00:00Z", "2054-11-20T00:00"],
  ["America/Los_Angeles", "2054-11-20T07:59:00Z", "2054-11-19T23:59"],
  ["America/Los_Angeles", "2054-11-20T08:00:00Z", "2054-11-20T00:00"],
])(
  "shows an update in %s (%s) as the wall clock at the place, whatever the browser's zone",
  (timezone, occurred_at, expected) => {
    for (const browser of ["Europe/Brussels", "Pacific/Auckland", "UTC"]) {
      vi.stubEnv("TZ", browser);
      expect(updateWallClock({ occurred_at, timezone })).toBe(expected);
    }
  },
);

it("labels an update by month and year in its zone, and survives an unknown zone", () => {
  const timezone = "Asia/Taipei";
  const occurred_at = "2054-11-30T20:00:00Z";
  expect(updateDateLabel({ occurred_at, timezone, share_date_precision: "month" })).toBe(
    "december 2054",
  );
  expect(updateDateLabel({ occurred_at, timezone, share_date_precision: "year" })).toBe("2054");
  expect(() => formatUpdateInstant({ occurred_at, timezone: "Not/AZone" })).not.toThrow();
  expect(formatUpdateInstant({ occurred_at, timezone: "Not/AZone" })).toBe("30 nov 2054, 20:00");
});
