import { expect, it } from "vitest";

import type { Stay, Trip } from "../../tracker-model";
import {
  accommodationLine,
  accommodationOf,
  blankStay,
  checkOutAfterCheckIn,
  fromStay,
  httpsOnly,
  locationLine,
  overlaps,
  placeChanged,
  stayPlaceFields,
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
    area: { id: "area-1", label: "Taipei" },
    share_date_precision: "month",
    ...fields,
  }) as Stay;

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

const values = (fields: Partial<ReturnType<typeof fromStay>> = {}) => ({
  ...fromStay(stay("a", { property_name: "Hotel" })),
  ...fields,
});

it("files a stay under its area alone until an accommodation is described", () => {
  expect(accommodationOf(values())).toBe("none");
  // A name or a city alone is not an accommodation: nothing would be created for it.
  expect(accommodationOf(values({ propertyName: "Hotel", locality: "Taipei" }))).toBe("none");
  expect(stayPlaceFields(values({ areaId: "area-1" }))).toEqual({
    area_id: "area-1",
    location: null,
  });
});

it("sends a saved accommodation on its own and a new one with the area when one is chosen", () => {
  expect(
    stayPlaceFields(values({ location: { existing_location_id: "loc-1" }, areaId: "area-1" })),
  ).toEqual({ location: { existing_location_id: "loc-1" } });
  const typed = stayPlaceFields(
    values({ address: " 1 Road ", locality: "Taipei", countryCode: "tw", areaId: "area-1" }),
  );
  expect(typed).toEqual({
    location: {
      display_name: "Hotel",
      address_line1: "1 Road",
      locality: "Taipei",
      country_code: "TW",
      area_id: "area-1",
    },
  });
  // Without a chosen area the server derives it from the accommodation's city.
  expect(stayPlaceFields(values({ address: "1 Road", areaId: "" }))).not.toHaveProperty(
    "location.area_id",
  );
});

it("names the accommodation of a stay, or says it is not chosen yet", () => {
  expect(accommodationLine({ location: null })).toBe("Accommodatie nog niet gekozen");
  expect(
    accommodationLine({ location: { display_name: "Hotel Royal", locality: "Taipei" } as never }),
  ).toBe("Hotel Royal · Taipei");
});

it("reads an area-only stay into editor values with its area and no accommodation", () => {
  const editor = fromStay(stay("a", { property_name: null }));
  expect(editor.areaId).toBe("area-1");
  expect(editor.location).toBeNull();
  expect(placeChanged({ ...editor, areaId: "area-2" }, editor)).toBe(true);
});
