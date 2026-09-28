// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { RecordDialog } from "./RecordDialog";

function Fixture() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Record openen
      </button>
      <RecordDialog open={open} title="Record" onDismiss={() => setOpen(false)}>
        <p>Inhoud</p>
      </RecordDialog>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("restores focus and scroll position after dismissal", () => {
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  Object.defineProperty(window, "scrollX", { configurable: true, value: 20 });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 400 });
  render(<Fixture />);
  const opener = screen.getByRole("button", { name: "Record openen" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole("button", { name: "Record sluiten" }));
  expect(document.activeElement).toBe(opener);
  expect(scrollTo).toHaveBeenCalledWith(20, 400);
});
