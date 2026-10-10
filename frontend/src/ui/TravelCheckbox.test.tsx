// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { TravelCheckbox } from "./TravelCheckbox";

afterEach(cleanup);

it("toggles from its label and keyboard, and respects disabled state", async () => {
  function Fixture() {
    const [checked, setChecked] = useState(false);
    return (
      <>
        <label>
          <TravelCheckbox checked={checked} onCheckedChange={setChecked} />
          Reis delen
        </label>
        <label>
          <TravelCheckbox checked disabled aria-label="Uitgeschakeld" />
          Uitgeschakeld
        </label>
      </>
    );
  }

  const user = userEvent.setup();
  render(<Fixture />);
  const checkbox = screen.getByRole("checkbox", { name: "Reis delen" });
  await user.click(screen.getByText("Reis delen"));
  expect(checkbox).toBeChecked();
  checkbox.focus();
  await user.keyboard(" ");
  expect(checkbox).not.toBeChecked();

  const disabled = screen.getByRole("checkbox", { name: "Uitgeschakeld" });
  await user.click(disabled);
  expect(disabled).toBeChecked();
});
