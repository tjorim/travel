import { expect, it } from "vitest";

import type { Area, Location } from "../../api-types";
import { emptyPlace } from "../PlacePicker";
import {
  areaPoint,
  resolvedAreaPoint,
  blank,
  dayShift,
  editableCoordinates,
  parseCoordinates,
  validCoordinates,
} from "./model";

it("reads a drawn line and explains why a text is not one", () => {
  expect(parseCoordinates("[[121.5,25],[121.6,25.1]]")).toEqual([
    [121.5, 25],
    [121.6, 25.1],
  ]);
  expect(typeof parseCoordinates("not json")).toBe("string");
  expect(typeof parseCoordinates("[[1,2]]")).toBe("string");
  expect(typeof parseCoordinates('[[1,"2"],[3,4]]')).toBe("string");
  expect(editableCoordinates("[[1,2]]")).toEqual([]);
  expect(editableCoordinates("")).toEqual([]);
  expect(validCoordinates({ value: "  " })).toBeUndefined();
  expect(validCoordinates({ value: "[[1,2],[3,4]]" })).toBeUndefined();
  expect(validCoordinates({ value: "[[1,2]]" })).toBeTypeOf("function");
});

it("counts the calendar days between departure and arrival in each end's own zone", () => {
  expect(
    dayShift({
      departs_at: "2054-11-16T20:00:00+00:00",
      departure_timezone: "Europe/Amsterdam",
      arrives_at: "2054-11-17T20:00:00+00:00",
      arrival_timezone: "Asia/Taipei",
    }),
  ).toBe(2);
});

it("starts a blank route in the browser's time zone with no places", () => {
  const values = blank();
  expect(values.mode).toBe("train");
  expect(values.departure).toEqual(emptyPlace());
  expect(values.departureTimezone).toBe(values.arrivalTimezone);
});

it("suggests the shared point of a public location, else the area's", () => {
  const areas = [{ id: "tpe", label: "Taipei", latitude: 25, longitude: 121.5 }] as Area[];
  const locations = [
    {
      id: "l1",
      area_id: "tpe",
      label: "Main Station",
      visibility: "everyone",
      latitude: 25.04,
      longitude: 121.51,
    },
    { id: "l2", area_id: "tpe", visibility: "private", latitude: 1, longitude: 2 },
  ] as Location[];
  const place = (choice: string) => ({ ...emptyPlace(), choice });
  expect(areaPoint(place("location:l1"), areas, locations)).toEqual([
    expect.objectContaining({ coordinates: [121.51, 25.04] }),
  ]);
  expect(areaPoint(place("location:l2"), areas, locations)).toEqual([
    { label: "Taipei", coordinates: [121.5, 25] },
  ]);
  expect(areaPoint(place("area:tpe"), areas, locations)).toEqual([
    { label: "Taipei", coordinates: [121.5, 25] },
  ]);
  expect(areaPoint(place("area:none"), areas, locations)).toEqual([]);
});

it("resolves flight ends to area points even for public locations, never location coordinates", () => {
  const areas = [{ id: "a", label: "Area", longitude: 4.12, latitude: 51.23 }] as Area[];
  for (const visibility of ["everyone", "private", "custom"] as const) {
    const locations = [
      { id: "l", area_id: "a", visibility, longitude: 99, latitude: 88 },
    ] as Location[];
    expect(resolvedAreaPoint({ ...emptyPlace(), choice: "location:l" }, areas, locations)).toEqual([
      { label: "Area", coordinates: [4.12, 51.23] },
    ]);
    expect(resolvedAreaPoint({ ...emptyPlace(), choice: "location:l" }, [], locations)).toEqual([]);
  }
});

it("rounds new area candidates as area creation does and ignores stale candidates for saved choices", () => {
  const value = {
    ...emptyPlace(),
    choice: "new",
    newAreaId: "__new__",
    newAreaCandidate: {
      label: "New area",
      longitude: 4.123456,
      latitude: 51.234567,
    },
  } as Parameters<typeof resolvedAreaPoint>[0];
  expect(resolvedAreaPoint(value, [], [])[0].coordinates).toEqual([4.12, 51.23]);
  expect(resolvedAreaPoint({ ...value, choice: "area:missing" }, [], [])).toEqual([]);
});
