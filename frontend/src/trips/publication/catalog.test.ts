import { expect, it } from "vitest";

import { cloneScope, emptyScope } from "./catalog";

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
