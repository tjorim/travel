// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { Field, FieldError, FieldLabel } from "./field";
import { SuggestInput } from "./SuggestInput";

afterEach(cleanup);

const zones = ["Asia/Taipei", "Asia/Tokyo", "Europe/Amsterdam"];

function Fixture() {
  const [value, setValue] = useState("");
  return (
    <Field name="zone" invalid={value === "bad"}>
      <FieldLabel>Tijdzone</FieldLabel>
      <SuggestInput value={value} onChange={setValue} suggestions={zones} />
      <FieldError>{value === "bad" ? "Onbekende tijdzone." : null}</FieldError>
    </Field>
  );
}

it("offers matching suggestions, fills one on choice, and keeps free text", () => {
  render(<Fixture />);
  const input = screen.getByLabelText("Tijdzone") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "asia" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Asia/Taipei", "Asia/Tokyo"]);
  const option = screen.getByRole("option", { name: "Asia/Tokyo" });
  fireEvent.click(option);
  expect(input.value).toBe("Asia/Tokyo");

  fireEvent.change(input, { target: { value: "Mars/Olympus" } });
  expect(input.value).toBe("Mars/Olympus");
});

it("wires the field error to the control", () => {
  render(<Fixture />);
  const input = screen.getByLabelText("Tijdzone");
  expect(input.getAttribute("aria-invalid")).toBeNull();
  fireEvent.change(input, { target: { value: "bad" } });
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe("Onbekende tijdzone.");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toContain(alert.id);
});
