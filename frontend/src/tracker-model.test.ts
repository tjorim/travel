// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import { captureInputValue, formatCapture, openBlobInNewTab } from "./tracker-model";

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
