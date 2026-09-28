// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { TravelCheckbox } from "./TravelCheckbox";

afterEach(cleanup);

it("toggles from its label and keyboard, and respects disabled state", () => {
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

  render(<Fixture />);
  const checkbox = screen.getByRole("checkbox", { name: "Reis delen" });
  fireEvent.click(screen.getByText("Reis delen"));
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  fireEvent.keyDown(checkbox, { key: " " });
  fireEvent.keyUp(checkbox, { key: " " });
  expect(checkbox.getAttribute("aria-checked")).toBe("false");

  const disabled = screen.getByRole("checkbox", { name: "Uitgeschakeld" });
  fireEvent.click(disabled);
  expect(disabled.getAttribute("aria-checked")).toBe("true");
});
