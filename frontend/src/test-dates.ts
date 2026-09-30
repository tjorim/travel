import { fireEvent, screen } from "@testing-library/react";

/** Types a date-time such as `2054-11-16T10:40` into the date and time inputs of a labelled field (Dutch interface). */
export function setDateTime(label: string, value: string) {
  const [date = "", time = ""] = value.split("T");
  fireEvent.change(screen.getByLabelText(`${label}, datum`), { target: { value: date } });
  fireEvent.change(screen.getByLabelText(`${label}, tijd`), { target: { value: time } });
}

/** The date and time text shown in a labelled date-time field. */
export function shownDateTime(label: string) {
  const text = (name: string) => (screen.getByLabelText(name) as HTMLInputElement).value;
  return `${text(`${label}, datum`)} ${text(`${label}, tijd`)}`;
}
