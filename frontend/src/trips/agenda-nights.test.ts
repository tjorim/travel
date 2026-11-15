import { expect, it } from "vitest";

import type { Area, Stay } from "../api-types";
import { buildAgendaItems } from "./agenda-items";

const area = { id: "linkou", label: "Linkou", timezone: "Asia/Taipei" } as Area;
const stay = (id: string, checkIn: string, checkOut: string, extra: Partial<Stay> = {}): Stay =>
  ({
    id,
    status: "confirmed",
    check_in_date: checkIn,
    check_out_date: checkOut,
    check_in_time: null,
    check_out_time: null,
    property_name: "Hotel Royal",
    area,
    ...extra,
  }) as Stay;

/** The agenda as day → row texts, in order. */
const days = (stays: Stay[]) => {
  const byDay: Record<string, string[]> = {};
  for (const item of buildAgendaItems(stays, [], [])) (byDay[item.first] ??= []).push(item.text);
  return byDay;
};

it("lists a stay on its check-in day, each later night and the check-out morning", () => {
  expect(days([stay("a", "2054-11-16", "2054-11-20")])).toEqual({
    "2054-11-16": ["Verblijf: Hotel Royal"],
    "2054-11-17": ["Slapen in Hotel Royal"],
    "2054-11-18": ["Slapen in Hotel Royal"],
    "2054-11-19": ["Slapen in Hotel Royal"],
    // The check-out morning is not a night: there is nothing after it.
    "2054-11-20": ["Uitchecken: Hotel Royal"],
  });
});

it("gives a one-night stay a check-in day and a check-out morning only", () => {
  expect(days([stay("a", "2054-11-16", "2054-11-17")])).toEqual({
    "2054-11-16": ["Verblijf: Hotel Royal"],
    "2054-11-17": ["Uitchecken: Hotel Royal"],
  });
});

it("names the area when the stay has no property, and keeps today's wording at check-in", () => {
  const items = buildAgendaItems(
    [stay("a", "2054-11-16", "2054-11-18", { property_name: null })],
    [],
    [],
  );
  expect(items.map((item) => item.text)).toEqual([
    "Verblijf: Nog te kiezen in Linkou",
    "Slapen in Linkou",
    "Uitchecken: Linkou",
  ]);
  expect(items[0].through).toBe("2054-11-17");
});

it("keeps the check-in time on the first day and the check-out time on the last", () => {
  const items = buildAgendaItems(
    [
      stay("a", "2054-11-16", "2054-11-18", {
        check_in_time: "15:00:00",
        check_out_time: "11:00:00",
      }),
    ],
    [],
    [],
  );
  expect(items.map((item) => item.time)).toEqual(["15:00", null, "11:00"]);
});

it("puts an untimed check-out before other untimed items of the day, and a moving day in order", () => {
  const items = buildAgendaItems(
    [
      stay("a", "2054-11-16", "2054-11-18"),
      stay("b", "2054-11-18", "2054-11-19", { property_name: "Hotel Nova" }),
    ],
    [],
    [],
  );
  expect(items.filter((item) => item.first === "2054-11-18").map((item) => item.text)).toEqual([
    "Uitchecken: Hotel Royal",
    "Verblijf: Hotel Nova",
  ]);
});

it("shows overlapping stays on every night they share", () => {
  const result = days([
    stay("a", "2054-11-16", "2054-11-19"),
    stay("b", "2054-11-17", "2054-11-20", { property_name: "Hotel Nova" }),
  ]);
  expect(result["2054-11-18"]).toEqual(["Slapen in Hotel Royal", "Slapen in Hotel Nova"]);
  expect(result["2054-11-17"]).toEqual(["Slapen in Hotel Royal", "Verblijf: Hotel Nova"]);
});

it("lists an idea or a cancelled stay once, on its check-in day: it sleeps nowhere", () => {
  for (const status of ["idea", "cancelled"] as const)
    expect(days([stay("a", "2054-11-16", "2054-11-20", { status })])).toEqual({
      "2054-11-16": ["Verblijf: Hotel Royal"],
    });
});

it("counts the nights across a month and a year boundary", () => {
  expect(Object.keys(days([stay("a", "2054-01-30", "2054-02-02")]))).toEqual([
    "2054-01-30",
    "2054-01-31",
    "2054-02-01",
    "2054-02-02",
  ]);
  expect(Object.keys(days([stay("a", "2054-12-30", "2055-01-02")]))).toEqual([
    "2054-12-30",
    "2054-12-31",
    "2055-01-01",
    "2055-01-02",
  ]);
});

it("counts calendar days over a clock change, whatever the time zone does", () => {
  // Europe/Amsterdam springs forward on 28 March 2054 and falls back on 25 October.
  const spring = days([
    stay("a", "2054-03-27", "2054-03-30", { area: { ...area, timezone: "Europe/Amsterdam" } }),
  ]);
  expect(Object.keys(spring)).toEqual(["2054-03-27", "2054-03-28", "2054-03-29", "2054-03-30"]);
  const autumn = days([
    stay("a", "2054-10-24", "2054-10-27", { area: { ...area, timezone: "Europe/Amsterdam" } }),
  ]);
  expect(Object.keys(autumn)).toEqual(["2054-10-24", "2054-10-25", "2054-10-26", "2054-10-27"]);
});

it("does not invent nights for a stay that ends on or before its check-in", () => {
  expect(days([stay("a", "2054-11-16", "2054-11-16")])).toEqual({
    "2054-11-16": ["Verblijf: Hotel Royal"],
  });
});

it("lists a stay that starts before or ends after the trip on each of its own days", () => {
  // Nothing clips a stay to the trip's dates: the owner still sees where the nights are.
  const result = days([stay("a", "2054-11-14", "2054-11-18")]);
  expect(Object.keys(result)).toEqual([
    "2054-11-14",
    "2054-11-15",
    "2054-11-16",
    "2054-11-17",
    "2054-11-18",
  ]);
});
