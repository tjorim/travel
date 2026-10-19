import { expect, it } from "vitest";

import type { Stay, Trip, Visit } from "../../tracker-model";
import { blank, dayLine, fromVisit, lastDay, overnights, visitPlace } from "./model";

const trip = { starts_on: "2054-11-16", ends_on: "2054-11-26" } as Trip;
const stay = {
  id: "s1",
  status: "confirmed",
  check_in_date: "2054-11-16",
  check_out_date: "2054-11-19",
} as Stay;

it("finds the stays that cover a visit's nights and counts the uncovered ones", () => {
  expect(overnights({ starts_on: "2054-11-17", ends_on: "2054-11-20" }, [stay], trip)).toEqual({
    stays: [stay],
    uncovered: 2,
  });
  expect(overnights({ starts_on: "2054-11-26", ends_on: "2054-11-26" }, [stay], trip)).toEqual({
    stays: [],
    uncovered: 0,
  });
});

it("names a visit's place by its location and area", () => {
  expect(
    visitPlace({ area: { label: "Taipei" }, location: null } as Pick<Visit, "area" | "location">),
  ).toBe("Taipei");
  expect(
    visitPlace({
      area: { label: "Taipei" },
      location: { display_name: "Night market" },
    } as Pick<Visit, "area" | "location">),
  ).toContain("Taipei");
});

it("calls out any status but the default, and requires the last day after the first", () => {
  const visit = { status: "planned", kind: null, starts_on: null, ends_on: null } as Visit;
  expect(dayLine({ ...visit, status: "cancelled" })).toContain(" · ");
  expect(dayLine(visit)).not.toContain(" · ");
  const form = { fieldApi: { form: { getFieldValue: () => "2054-11-18" } } };
  expect(lastDay({ value: "2054-11-17", ...form })).toBeTypeOf("function");
  expect(lastDay({ value: "2054-11-19", ...form })).toBeUndefined();
  expect(lastDay({ value: "", ...form })).toBeUndefined();
});

it("loads a visit into editor values", () => {
  expect(blank().status).toBe("planned");
  expect(
    fromVisit({
      area: { id: "a1" },
      location: null,
      status: "idea",
      title: "Dinner",
      start_time: "19:00:00",
      share_time: true,
    } as Visit),
  ).toMatchObject({ status: "idea", title: "Dinner", startTime: "19:00", shareTime: true });
});
