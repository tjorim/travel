import { expect, it } from "vitest";

import { orderedTrips, tripDateRange, tripState } from "./trip-state";

const day = "2054-06-15";

it("classifies a trip by its dates", () => {
  expect(tripState({ starts_on: null, ends_on: null }, day)).toBe("planned");
  expect(tripState({ starts_on: "2054-06-15", ends_on: "2054-06-20" }, day)).toBe("active");
  expect(tripState({ starts_on: "2054-06-10", ends_on: "2054-06-15" }, day)).toBe("active");
  expect(tripState({ starts_on: "2054-06-10", ends_on: null }, day)).toBe("active");
  expect(tripState({ starts_on: "2054-06-16", ends_on: "2054-06-20" }, day)).toBe("upcoming");
  expect(tripState({ starts_on: "2054-06-01", ends_on: "2054-06-14" }, day)).toBe("past");
});

it("orders under way, then ahead by date, then undated, then finished", () => {
  const trips = [
    { id: "past", starts_on: "2054-01-01", ends_on: "2054-01-02" },
    { id: "planned", starts_on: null, ends_on: null },
    { id: "later", starts_on: "2054-09-01", ends_on: "2054-09-09" },
    { id: "soon", starts_on: "2054-07-01", ends_on: "2054-07-09" },
    { id: "now", starts_on: "2054-06-14", ends_on: "2054-06-16" },
  ];
  expect(orderedTrips(trips, day).map((trip) => trip.id)).toEqual([
    "now",
    "soon",
    "later",
    "planned",
    "past",
  ]);
});

it("writes the date range, or nothing before there are dates", () => {
  expect(tripDateRange({ starts_on: null, ends_on: null })).toBeNull();
  expect(tripDateRange({ starts_on: "2054-06-10", ends_on: null })).toBe("10 jun 2054");
  expect(tripDateRange({ starts_on: "2054-06-10", ends_on: "2054-06-12" })).toBe(
    "10 jun 2054 — 12 jun 2054",
  );
});
