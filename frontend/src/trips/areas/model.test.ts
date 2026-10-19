import { expect, it } from "vitest";

import type { Area } from "../../tracker-model";
import {
  areaCoordinate,
  areaSummary,
  blank,
  bothCoordinates,
  fromArea,
  knownTimeZone,
  latitudeRange,
  longitudeRange,
} from "./model";

it("loads an area into editor values and back to blanks", () => {
  const values = fromArea({
    label: "Taipei",
    country_code: "TW",
    region: null,
    latitude: 25.03,
    longitude: 121.56,
    timezone: "Asia/Taipei",
  } as Area);
  expect(values).toEqual({
    label: "Taipei",
    countryCode: "TW",
    region: "",
    latitude: "25.03",
    longitude: "121.56",
    timezone: "Asia/Taipei",
  });
  expect(blank().label).toBe("");
});

it("summarises an area by region, country and time zone", () => {
  expect(areaSummary({ region: "Taipei", country_code: "TW", timezone: null } as Area)).toBe(
    "Taipei · TW",
  );
});

it("rounds a map point to roughly a kilometre", () => {
  expect(areaCoordinate(25.034567)).toBe("25.03");
});

it("requires both coordinates or neither, each within range", () => {
  const form = (longitude: string) => ({ fieldApi: { form: { getFieldValue: () => longitude } } });
  expect(bothCoordinates({ value: "25", ...form("") })).toBeTypeOf("function");
  expect(bothCoordinates({ value: "25", ...form("121") })).toBeUndefined();
  expect(bothCoordinates({ value: "", ...form("") })).toBeUndefined();
  expect(latitudeRange({ value: "91" })).toBeTypeOf("function");
  expect(latitudeRange({ value: "-90" })).toBeUndefined();
  expect(longitudeRange({ value: "181" })).toBeTypeOf("function");
  expect(longitudeRange({ value: "" })).toBeUndefined();
});

it("accepts known IANA time zones only", () => {
  expect(knownTimeZone({ value: "Asia/Taipei" })).toBeUndefined();
  expect(knownTimeZone({ value: "  " })).toBeUndefined();
  expect(knownTimeZone({ value: "Mars/Olympus" })).toBeTypeOf("function");
});
