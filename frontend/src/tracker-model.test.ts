// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { setLocale } from "./paraglide/runtime.js";
import {
  areaName,
  captureInputValue,
  formatCapture,
  formatUpdateInstant,
  openBlobInNewTab,
  presetRecordName,
  updateDateLabel,
  type TravelUpdate,
} from "./tracker-model";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function openedType(blob: Blob): string {
  let opened = "";
  URL.createObjectURL = vi.fn((shown: Blob | MediaSource) => {
    opened = (shown as Blob).type;
    return "blob:test";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({} as Window);
  openBlobInNewTab(blob);
  return opened;
}

it("shows PDFs, images and plain text in the new tab", () => {
  expect(openedType(new Blob(["x"], { type: "application/pdf" }))).toBe("application/pdf");
  expect(openedType(new Blob(["x"], { type: "image/jpeg" }))).toBe("image/jpeg");
  expect(openedType(new Blob(["x"], { type: "text/plain; charset=utf-8" }))).toBe(
    "text/plain; charset=utf-8",
  );
});

it("hands anything that could run over as a download, never as HTML or SVG", () => {
  expect(openedType(new Blob(["<script>"], { type: "text/html" }))).toBe(
    "application/octet-stream",
  );
  expect(openedType(new Blob(["<svg onload=x>"], { type: "image/svg+xml" }))).toBe(
    "application/octet-stream",
  );
  expect(openedType(new Blob(["x"], { type: "" }))).toBe("application/octet-stream");
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

it("names an unnamed area in the selected locale and keeps a given name as written", () => {
  try {
    setLocale("en", { reload: false });
    expect(areaName({ label: null })).toBe("Unnamed area");
    setLocale("nl", { reload: false });
    expect(areaName({ label: null })).toBe("Naamloos gebied");
    expect(areaName({ label: "Taipei" })).toBe("Taipei");
  } finally {
    setLocale("en", { reload: false });
  }
});

it("names a preset record by its label and, for a stay, its check-in day in the selected locale", () => {
  const stay = { kind: "stay", id: "s1", label: "Alpha Town", day: "2054-04-01" } as const;
  // The day is formatted, never shown as the raw ISO string, whichever locale is selected.
  expect(presetRecordName(stay, "Untitled")).toMatch(/^Alpha Town · 1 \p{L}+ 2054$/u);
  expect(presetRecordName({ kind: "visit", id: "v1", label: "Market" }, "Untitled")).toBe("Market");
  expect(presetRecordName({ kind: "visit", id: "v2", label: null }, "Untitled")).toBe("Untitled");
});

it.each([
  // Shortly after local midnight in UTC+8, and shortly before it in UTC-8: the day the visitor is given.
  ["Asia/Taipei", "2054-11-19T23:00:00Z", "20 nov 2054, 07:00"],
  ["America/Los_Angeles", "2054-11-20T07:30:00Z", "19 nov 2054, 23:30"],
  // Daylight saving time: PDT in July is UTC-7.
  ["America/Los_Angeles", "2054-07-01T06:30:00Z", "30 jun 2054, 23:30"],
])("reads an update in %s on the day of its area (%s)", (timezone, occurred_at, expected) => {
  const area = { timezone } as TravelUpdate["area"];
  expect(formatUpdateInstant({ occurred_at, area })).toBe(expected);
  expect(updateDateLabel({ occurred_at, area, date_precision: "day" })).toBe(expected);
});

it("labels an update by month and year in the area's zone, and survives an unknown zone", () => {
  const area = { timezone: "Asia/Taipei" } as TravelUpdate["area"];
  const occurred_at = "2054-11-30T20:00:00Z";
  expect(updateDateLabel({ occurred_at, area, date_precision: "month" })).toBe("december 2054");
  expect(updateDateLabel({ occurred_at, area, date_precision: "year" })).toBe("2054");
  const unknown = { timezone: "Not/AZone" } as TravelUpdate["area"];
  expect(() => formatUpdateInstant({ occurred_at, area: unknown })).not.toThrow();
});
