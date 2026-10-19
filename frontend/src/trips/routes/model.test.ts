import { expect, it } from "vitest";

import type { Area, Location, Route } from "../../tracker-model";
import { emptyPlace } from "../PlacePicker";
import {
  areaPoint,
  blank,
  dayShift,
  editableCoordinates,
  parseCoordinates,
  routeEntries,
  validCoordinates,
} from "./model";

const route = (id: string, fields: Partial<Route> = {}) =>
  ({
    id,
    status: "idea",
    departs_on: "2054-11-16",
    departure_area: { id: "ams", label: "Amsterdam" },
    arrival_area: { id: "tpe", label: "Taipei" },
    ...fields,
  }) as Route;

it("lists ideas for the same journey together and leaves a lone idea or a booked route alone", () => {
  const entries = routeEntries([
    route("a"),
    route("b"),
    route("c", { status: "confirmed", departs_on: "2054-11-20" }),
    route("d", { departure_area: { id: "x", label: "Rome" } as Route["departure_area"] }),
  ]);
  expect(entries.map((entry) => entry.routes.map((item) => item.id))).toEqual([
    ["a", "b"],
    ["c"],
    ["d"],
  ]);
  expect(entries[0].journey).toContain("Amsterdam → Taipei");
  expect(entries[1].journey).toBeUndefined();
});

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
