import { expect, it } from "vitest";

import type { Stay, Trip } from "../../tracker-model";
import {
  blankStay,
  checkOutAfterCheckIn,
  fromStay,
  httpsOnly,
  locationLine,
  overlaps,
  placeChanged,
  stayEntries,
} from "./model";

const stay = (id: string, fields: Partial<Stay> = {}) =>
  ({
    id,
    status: "idea",
    check_in_date: "2054-11-16",
    check_out_date: "2054-11-18",
    check_in_time: null,
    check_out_time: null,
    location: null,
    share_date_precision: "month",
    ...fields,
  }) as Stay;

it("groups ideas for the same dates and keeps a lone idea or a booked stay on its own", () => {
  const entries = stayEntries([
    stay("a"),
    stay("b"),
    stay("c", { status: "confirmed" }),
    stay("d", { check_in_date: "2054-11-20", check_out_date: "2054-11-21" }),
  ]);
  expect(entries.map((entry) => entry.stays.map((item) => item.id))).toEqual([
    ["a", "b"],
    ["c"],
    ["d"],
  ]);
  expect(entries[0].dates).toBeTruthy();
  expect(entries[1].dates).toBeUndefined();
});

it("treats back-to-back stays as not overlapping", () => {
  expect(overlaps(stay("a"), "2054-11-17", "2054-11-19")).toBe(true);
  expect(overlaps(stay("a"), "2054-11-18", "2054-11-19")).toBe(false);
  expect(overlaps(stay("a"), "2054-11-14", "2054-11-16")).toBe(false);
});

it("opens a new stay on the trip's first day for one night", () => {
  const values = blankStay({ starts_on: "2054-11-16" } as Trip);
  expect([values.checkInDate, values.checkOutDate]).toEqual(["2054-11-16", "2054-11-17"]);
});

it("round-trips a stay into editor values and notices an edited place field", () => {
  const values = fromStay(
    stay("a", { property_name: "Hotel", check_in_time: "15:00:00", website_url: null }),
  );
  expect(values.propertyName).toBe("Hotel");
  expect(values.checkInTime).toBe("15:00");
  expect(placeChanged(values, { ...values })).toBe(false);
  expect(placeChanged({ ...values, locality: "Taipei" }, values)).toBe(true);
  expect(placeChanged({ ...values, notes: "x" }, values)).toBe(false);
});

it("validates the check-out day and website address", () => {
  const form = (checkIn: string) => ({
    fieldApi: { form: { getFieldValue: () => checkIn } },
  });
  expect(checkOutAfterCheckIn({ value: "2054-11-16", ...form("2054-11-16") })).toBeTypeOf(
    "function",
  );
  expect(checkOutAfterCheckIn({ value: "2054-11-17", ...form("2054-11-16") })).toBeUndefined();
  expect(httpsOnly({ value: "http://x.example" })).toBeTypeOf("function");
  expect(httpsOnly({ value: "https://x.example" })).toBeUndefined();
  expect(httpsOnly({ value: "" })).toBeUndefined();
});

it("names the linked location once", () => {
  expect(locationLine(undefined)).toBe("");
  expect(locationLine({ display_name: "Taipei", locality: "Taipei" } as Stay["location"])).toBe(
    "Taipei",
  );
});
