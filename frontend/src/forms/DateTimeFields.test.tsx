// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { changeLocale } from "../locale";
import { DateField, DateTimeField, TimeField } from "./DateTimeFields";
import { RecordForm } from "./fields";
import { useRecordForm } from "./useRecordForm";

type Values = { day: string; time: string; moment: string };
const submit = vi.fn(async (_values: Values) => {});

function Harness({ initial = { day: "2054-11-16", time: "", moment: "" } }: { initial?: Values }) {
  const record = useRecordForm({ defaultValues: initial, submit, fallback: () => "failed" });
  return (
    <RecordForm record={record} submitLabel="Opslaan" pendingLabel="Opslaan…">
      <record.form.Field name="day">
        {(field) => <DateField field={field} label="Dag" optional />}
      </record.form.Field>
      <record.form.Field name="time">
        {(field) => <TimeField field={field} label="Tijd" optional />}
      </record.form.Field>
      <record.form.Field name="moment">
        {(field) => <DateTimeField field={field} label="Moment" optional />}
      </record.form.Field>
    </RecordForm>
  );
}

beforeEach(() => act(() => changeLocale("nl")));

afterEach(() => {
  cleanup();
  submit.mockClear();
  act(() => changeLocale("nl"));
});

const text = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));

it("shows the saved date in the interface language and saves ISO", async () => {
  render(<Harness />);
  expect(text("Dag (optioneel)")).toBe("16 nov 2054");
  act(() => changeLocale("en"));
  expect(text("Dag (optional)")).toBe("16 Nov 2054");
  type("Dag (optional)", "5-3-2055");
  fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
  await waitFor(() => expect(submit).toHaveBeenCalled());
  expect(submit.mock.calls[0][0].day).toBe("2055-03-05");
});

it("saves a time as HH:mm however it was typed", async () => {
  render(<Harness />);
  type("Tijd (optioneel)", "930");
  save();
  await waitFor(() => expect(submit).toHaveBeenCalled());
  expect(submit.mock.calls[0][0].time).toBe("09:30");
});

it("keeps unreadable text, says so and does not save", async () => {
  render(<Harness />);
  const input = screen.getByLabelText("Dag (optioneel)");
  fireEvent.change(input, { target: { value: "16 nov" } });
  save();
  expect(await screen.findByText(/Vul een datum in/)).toBeTruthy();
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect((input as HTMLInputElement).value).toBe("16 nov");
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "17 nov 2054" } });
  await waitFor(() => expect(screen.queryByText(/Vul een datum in/)).toBeNull());
  save();
  await waitFor(() => expect(submit).toHaveBeenCalled());
  expect(submit.mock.calls[0][0].day).toBe("2054-11-17");
});

it("clears the value when the text is emptied", async () => {
  render(<Harness />);
  type("Dag (optioneel)", "");
  save();
  await waitFor(() => expect(submit).toHaveBeenCalled());
  expect(submit.mock.calls[0][0].day).toBe("");
});

it("joins the date and time of a date-time, and refuses half of one", async () => {
  render(<Harness />);
  type("Moment, datum", "2054-12-06");
  save();
  expect(
    await screen.findByText("Vul zowel een datum als een tijd in, of laat beide leeg."),
  ).toBeTruthy();
  expect(submit).not.toHaveBeenCalled();
  type("Moment, tijd", "8:05");
  save();
  await waitFor(() => expect(submit).toHaveBeenCalled());
  expect(submit.mock.calls[0][0].moment).toBe("2054-12-06T08:05");
});

it("shows a saved date-time as two inputs", () => {
  render(<Harness initial={{ day: "", time: "", moment: "2054-11-16T10:40" }} />);
  expect(text("Moment, datum")).toBe("16 nov 2054");
  expect(text("Moment, tijd")).toBe("10:40");
});

it("picks a day in a calendar in the interface language and returns to the input", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Dag: kies in de kalender" }));
  expect(await screen.findByText("november 2054")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: /vrijdag 20 november 2054/ }));
  await waitFor(() => expect(text("Dag (optioneel)")).toBe("20 nov 2054"));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText("Dag (optioneel)")),
  );
  save();
  await waitFor(() => expect(submit).toHaveBeenCalled());
  expect(submit.mock.calls[0][0].day).toBe("2054-11-20");
});
