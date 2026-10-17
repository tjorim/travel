// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { DeleteConfirmation, RecordDialog } from "./RecordDialog";

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
  render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
  const opener = screen.getByRole("button", { name: "Record openen" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole("button", { name: "Record sluiten" }));
  expect(document.activeElement).toBe(opener);
  expect(scrollTo).toHaveBeenCalledWith(20, 400);
});

it("runs the close callback after Escape dismisses a clean dialog", async () => {
  const afterClose = vi.fn();
  function EscapeFixture() {
    const [open, setOpen] = useState(true);
    return (
      <RecordDialog
        open={open}
        title="Record"
        onDismiss={() => setOpen(false)}
        onAfterClose={afterClose}
      >
        <p>Inhoud</p>
      </RecordDialog>
    );
  }
  render(<EscapeFixture />);
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Record" })).toBeNull());
  expect(afterClose).toHaveBeenCalledTimes(1);
});

it("asks before dismissing dirty content and keeps the editor open while the prompt is active", async () => {
  const dismiss = vi.fn();
  render(
    <RecordDialog open title="Record" dirty onDismiss={dismiss}>
      <input aria-label="Recordnaam" />
    </RecordDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Record sluiten" }));
  const prompt = screen.getByRole("alertdialog", { name: "Wijzigingen verwerpen?" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(prompt).getByRole("button", { name: "Verder bewerken" }),
    ),
  );
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Record sluiten" }));
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", { name: "Wijzigingen verwerpen" }),
  );
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it("keeps a nested delete confirmation in front and focuses its safe cancel action", async () => {
  const cancel = vi.fn();
  const confirm = vi.fn();
  render(
    <RecordDialog open title="Record" onDismiss={cancel}>
      <DeleteConfirmation title="Record verwijderen?" onCancel={cancel} onConfirm={confirm} />
    </RecordDialog>,
  );
  const prompt = screen.getByRole("alertdialog", { name: "Record verwijderen?" });
  await waitFor(() =>
    expect(document.activeElement).toBe(within(prompt).getByRole("button", { name: "Annuleren" })),
  );
  fireEvent.click(within(prompt).getByRole("button", { name: "Verwijderen" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
});

it("routes an outside press through the dirty dismissal policy", async () => {
  const dismiss = vi.fn();
  render(
    <RecordDialog open title="Record" dirty onDismiss={dismiss}>
      <p>Inhoud</p>
    </RecordDialog>,
  );
  fireEvent.mouseDown(document.body, { button: 0 });
  fireEvent.mouseUp(document.body, { button: 0 });
  fireEvent.click(document.body);
  await waitFor(() =>
    expect(screen.getByRole("alertdialog", { name: "Wijzigingen verwerpen?" })).toBeTruthy(),
  );
  expect(dismiss).not.toHaveBeenCalled();
});
