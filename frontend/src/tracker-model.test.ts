// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import { openBlobInNewTab } from "./tracker-model";

afterEach(() => vi.restoreAllMocks());

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
  expect(openedType(new Blob(["x"], { type: "text/plain; charset=utf-8" }))).toBe("text/plain; charset=utf-8");
});

it("hands anything that could run over as a download, never as HTML or SVG", () => {
  expect(openedType(new Blob(["<script>"], { type: "text/html" }))).toBe("application/octet-stream");
  expect(openedType(new Blob(["<svg onload=x>"], { type: "image/svg+xml" }))).toBe("application/octet-stream");
  expect(openedType(new Blob(["x"], { type: "" }))).toBe("application/octet-stream");
});
