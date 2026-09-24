// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { answerConfirmation } from "../test-confirm";
import { useConfirmation } from "./useConfirmation";

const action = vi.fn();

function Fixture() {
  const confirmation = useConfirmation();
  return <><button type="button" onClick={() => confirmation.ask({ title: "Iets verwijderen?", description: "Dit is definitief.", confirmLabel: "Ja, weg ermee", onConfirm: action })}>Verwijder</button>{confirmation.dialog}</>;
}

afterEach(() => { cleanup(); action.mockReset(); });

it("runs the action only after the owner confirms", async () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: "Verwijder" }));
  expect(screen.getByRole("alertdialog", { name: "Iets verwijderen?" })).toBeTruthy();
  expect(screen.getByText("Dit is definitief.")).toBeTruthy();
  expect(action).not.toHaveBeenCalled();
  await answerConfirmation("Ja, weg ermee");
  expect(action).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("leaves the action alone when the owner cancels or closes the dialog", async () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: "Verwijder" }));
  await answerConfirmation("Annuleren");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Verwijder" }));
  fireEvent.click(screen.getByRole("button", { name: "Bevestigen sluiten" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(action).not.toHaveBeenCalled();
});
