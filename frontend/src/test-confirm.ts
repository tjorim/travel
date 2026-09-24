import { fireEvent, screen, within } from "@testing-library/react";

/** Presses a button of the in-app confirmation that replaced `window.confirm`. */
export async function answerConfirmation(name = "Verwijderen") {
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name }));
}
