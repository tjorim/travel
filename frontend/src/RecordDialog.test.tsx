// @vitest-environment happy-dom
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

it("restores focus and scroll position after dismissal", async () => {
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
  await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(20, 400));
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

it("moves focus to a surviving record when deletion removes the trigger", async () => {
  function DeleteFixture() {
    const [rows, setRows] = useState(["a", "b"]);
    const [open, setOpen] = useState<string | null>(null);
    return (
      <section>
        <button type="button">Nieuw</button>
        <div>
          {rows.map((row) => (
            <article key={row}>
              <button type="button" onClick={() => setOpen(row)}>
                Open {row}
              </button>
            </article>
          ))}
        </div>
        <RecordDialog open={open !== null} title="Record" onDismiss={() => setOpen(null)}>
          <button
            type="button"
            onClick={() => {
              setRows((current) => current.filter((row) => row !== open));
              setOpen(null);
            }}
          >
            Verwijder
          </button>
        </RecordDialog>
      </section>
    );
  }
  render(<DeleteFixture />);
  const first = screen.getByRole("button", { name: "Open a" });
  first.focus();
  fireEvent.click(first);
  fireEvent.click(await screen.findByRole("button", { name: "Verwijder" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Record" })).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open b" })),
  );
  fireEvent.click(screen.getByRole("button", { name: "Open b" }));
  fireEvent.click(await screen.findByRole("button", { name: "Verwijder" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Nieuw" })),
  );
});
