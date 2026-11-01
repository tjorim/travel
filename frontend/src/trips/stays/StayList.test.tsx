// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { Stay } from "../../tracker-model";
import { StayList } from "./StayList";

const stay = (id: string, fields: Partial<Stay> = {}) =>
  ({
    id,
    status: "planned",
    property_name: `Hotel ${id}`,
    check_in_date: "2054-11-16",
    check_out_date: "2054-11-18",
    check_in_time: null,
    check_out_time: null,
    location: null,
    area: null,
    visibility: "private",
    share_date_precision: "month",
    ...fields,
  }) as Stay;

afterEach(cleanup);

it("moves the check-out by a night for a stay still being planned, not for a booked one", () => {
  const adjust = vi.fn();
  render(
    <StayList
      stays={[
        stay("a"),
        stay("b", {
          status: "confirmed",
          check_in_date: "2054-12-01",
          check_out_date: "2054-12-03",
        }),
        stay("c", { status: "idea", check_in_date: "2054-12-10", check_out_date: "2054-12-11" }),
      ]}
      onInspect={() => {}}
      onAdjustNights={adjust}
    />,
  );
  // Only the planned and the idea stay have a stepper.
  expect(screen.getAllByRole("group")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Eén nacht meer bij Hotel a" }));
  fireEvent.click(screen.getByRole("button", { name: "Eén nacht minder bij Hotel a" }));
  expect(adjust.mock.calls.map(([item, delta]) => [item.id, delta])).toEqual([
    ["a", 1],
    ["a", -1],
  ]);
  // A one-night stay cannot lose its only night.
  expect(
    (screen.getByRole("button", { name: "Eén nacht minder bij Hotel c" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("keeps a stay that visitors can see out of the quick stepper", () => {
  render(
    <StayList
      stays={[stay("a", { visibility: "everyone" }), stay("b", { visibility: "custom" })]}
      onInspect={() => {}}
      onAdjustNights={() => {}}
    />,
  );
  expect(screen.queryAllByRole("group")).toHaveLength(0);
});

it("offers no stepper without a handler and none while saving", () => {
  const { rerender } = render(<StayList stays={[stay("a")]} onInspect={() => {}} />);
  expect(screen.queryAllByRole("group")).toHaveLength(0);
  rerender(<StayList stays={[stay("a")]} onInspect={() => {}} onAdjustNights={() => {}} saving />);
  expect(
    (screen.getByRole("button", { name: "Eén nacht meer bij Hotel a" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
