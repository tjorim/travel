import { expect, it } from "vitest";

import type { TravelUpdate } from "../../tracker-model";
import { captureTripOrder } from "./default-trip";

const update = (occurred_at: string) => ({ occurred_at }) as TravelUpdate;
const trip = (
  id: string,
  starts_on: string | null,
  ends_on: string | null,
  updates: string[] = [],
) => ({ id, starts_on, ends_on, travel_updates: updates.map(update) });

const day = "2054-11-10";
const ids = (trips: ReturnType<typeof trip>[]) => captureTripOrder(trips, day).map((t) => t.id);

it("starts on the trip underway, before an upcoming one", () => {
  expect(
    ids([
      trip("later", "2054-12-01", "2054-12-09"),
      trip("soon", "2054-11-20", "2054-11-25"),
      trip("now", "2054-11-01", "2054-11-21"),
    ]),
  ).toEqual(["now", "soon", "later"]);
});

it("takes the nearest upcoming trip when none is underway", () => {
  expect(
    ids([
      trip("later", "2054-12-01", "2054-12-09"),
      trip("old", "2054-01-01", "2054-01-09", ["2054-01-03T10:00:00Z"]),
      trip("soon", "2054-11-20", "2054-11-25"),
    ]),
  ).toEqual(["soon", "later", "old"]);
});

it("falls back to the trip captured into last, then to the API order", () => {
  expect(
    ids([
      trip("first", null, null),
      trip("older", "2053-01-01", "2053-01-09", ["2053-01-03T10:00:00Z"]),
      trip("newest", "2054-01-01", "2054-01-09", ["2054-01-03T10:00:00Z", "2054-01-05T10:00:00Z"]),
      trip("second", null, null),
    ]),
  ).toEqual(["newest", "older", "first", "second"]);
});

it("counts an open-ended trip as underway from its first day", () => {
  expect(ids([trip("none", null, null), trip("open", "2054-11-10", null)])).toEqual([
    "open",
    "none",
  ]);
});
