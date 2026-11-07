import { expect, it } from "vitest";

import { cloneScope, emptyScope, isExcluded, kindCountsText, setShown } from "./catalog";

it("starts a new audience at months", () => {
  expect(emptyScope().defaults).toEqual({ date_precision: "month" });
});

it("carries an audience's date precision through an edit, and an absent one stays absent", () => {
  const base = {
    schema_version: "travel/share-scope@1" as const,
    trip: { title: true, summary: true, dates: null },
    items: [],
  };
  expect(cloneScope({ ...base, defaults: { date_precision: "day" } }).defaults).toEqual({
    date_precision: "day",
  });
  expect(cloneScope({ ...base, defaults: { date_precision: null } }).defaults).toEqual({
    date_precision: null,
  });
  expect(cloneScope({ ...base, defaults: null }).defaults).toBeNull();
  // An older scope has no setting; sending none keeps the stored one rather than widening it.
  expect(cloneScope(base)).not.toHaveProperty("defaults");
  expect(cloneScope(undefined)).not.toHaveProperty("defaults");
});

it("carries an audience's exclusions through an edit, and absent ones stay absent", () => {
  const base = {
    schema_version: "travel/share-scope@1" as const,
    trip: { title: true, summary: true, dates: null },
    items: [],
  };
  const excluded = [{ kind: "area" as const, id: "a1" }];
  expect(cloneScope({ ...base, exclude: excluded }).exclude).toEqual(excluded);
  expect(cloneScope({ ...base, exclude: [] }).exclude).toEqual([]);
  expect(cloneScope({ ...base, exclude: null }).exclude).toEqual([]);
  // A scope from before exclusions sends none, so the server keeps what the audience has: it can never be widened.
  expect(cloneScope(base)).not.toHaveProperty("exclude");
  expect(cloneScope(undefined)).not.toHaveProperty("exclude");
  expect(emptyScope()).not.toHaveProperty("exclude");
});

it("leaves a record out of an audience and puts it back, without touching the others", () => {
  const scope = emptyScope();
  const area = { kind: "area" as const, id: "a1" };
  const visit = { kind: "visit" as const, id: "v1" };
  const hidden = setShown(setShown(scope, area, false), visit, false);
  expect(hidden.exclude).toEqual([area, visit]);
  expect(isExcluded(hidden, area)).toBe(true);
  expect(setShown(hidden, area, true).exclude).toEqual([visit]);
  expect(setShown(hidden, area, false).exclude).toEqual([visit, area]);
  expect(scope.exclude).toBeUndefined();
});

it("words counts of records by kind, an area and a location both being places", () => {
  expect(kindCountsText(undefined)).toBe("");
  expect(kindCountsText({})).toBe("");
  expect(
    kindCountsText({ area: 1, location: 2, visit: 3, stay: 1, route: 2, travel_update: 1 }),
  ).toBe("3 bezoeken, 1 verblijf, 2 routes, 1 reisupdate, 3 plaatsen");
});
