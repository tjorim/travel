// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";

import { SectionAccordion } from "./SectionAccordion";

afterEach(cleanup);

function Harness({ initial = false }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <SectionAccordion id="stays" title="Verblijven" count={3} open={open} onOpenChange={setOpen}>
      <input aria-label="Notitie" />
    </SectionAccordion>
  );
}

it("shows its title and count, and expands and collapses from the bar", () => {
  render(<Harness />);
  const bar = screen.getByRole("button", { name: /Verblijven/ });
  expect(bar.textContent).toContain("3");
  expect(bar.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(bar);
  expect(bar.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(bar);
  expect(bar.getAttribute("aria-expanded")).toBe("false");
});

it("keeps its content mounted while collapsed, so a draft survives", () => {
  render(<Harness initial />);
  const field = screen.getByLabelText("Notitie") as HTMLInputElement;
  fireEvent.change(field, { target: { value: "Bel de receptie" } });
  fireEvent.click(screen.getByRole("button", { name: /Verblijven/ }));
  // Collapsed: hidden, but the same element with the same value.
  expect(field.closest("[hidden]")).toBeTruthy();
  expect(screen.getByLabelText("Notitie")).toBe(field);
  fireEvent.click(screen.getByRole("button", { name: /Verblijven/ }));
  expect((screen.getByLabelText("Notitie") as HTMLInputElement).value).toBe("Bel de receptie");
});

it("is the element a #id link points at", () => {
  const { container } = render(<Harness />);
  expect(container.querySelector("#stays")).toBeTruthy();
});
