// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { stubViewport } from "./mocks/viewport";
import { ProjectionView, type Projection, type ProjectionItem } from "./ProjectionView";
import { planByDay, type DayEntry } from "./visitor-days";

beforeEach(() => stubViewport(true));
afterEach(cleanup);

const area = (label: string, latitude = 1.5, longitude = 2.5) => ({
  label,
  country_code: "XX",
  region: null,
  latitude,
  longitude,
});
const visit = (id: string, starts_on: string | undefined, extra = {}): ProjectionItem => ({
  id,
  title: `Visit ${id}`,
  place: area("Alpha"),
  date_precision: "day",
  ...(starts_on ? { starts_on, ends_on: null } : {}),
  ...extra,
});
const stay = (id: string, starts_on: string, ends_on: string, extra = {}): ProjectionItem => ({
  id,
  title: "Alpha",
  place: area("Alpha"),
  date_precision: "day",
  starts_on,
  ends_on,
  ...extra,
});
const route = (id: string, extra = {}): ProjectionItem => ({
  id,
  mode: "train",
  status: "planned",
  departure: area("Alpha"),
  arrival: area("Beta", 3, 4),
  departs_on: "2054-11-02",
  ...extra,
});
const none = { visits: [], stays: [], routes: [] };
const summary = (entries: DayEntry[]) =>
  entries.map((entry) => (entry.type === "stay" ? `stay:${entry.phase}` : entry.type));
const dates = (days: { date: string }[]) => days.map((day) => day.date);

it("lists a stay on its check-in day, each night after it and its check-out, across a month boundary", () => {
  const plan = planByDay({ ...none, stays: [stay("s", "2054-10-30", "2054-11-03")] });
  expect(dates(plan.days)).toEqual([
    "2054-10-30",
    "2054-10-31",
    "2054-11-01",
    "2054-11-02",
    "2054-11-03",
  ]);
  expect(plan.days.map((day) => summary(day.entries))).toEqual([
    ["stay:check-in"],
    ["stay:night"],
    ["stay:night"],
    ["stay:night"],
    ["stay:check-out"],
  ]);
  expect(plan.other).toEqual(none);
});

it("does the date arithmetic on dates only, so a daylight-saving change never moves a night", () => {
  // Europe changes clocks on 2054-03-29 and the Americas on 2054-03-08: neither shifts a calendar day.
  const plan = planByDay({ ...none, stays: [stay("s", "2054-03-27", "2054-03-31")] });
  expect(dates(plan.days)).toEqual([
    "2054-03-27",
    "2054-03-28",
    "2054-03-29",
    "2054-03-30",
    "2054-03-31",
  ]);
  const leap = planByDay({ ...none, stays: [stay("l", "2056-02-27", "2056-03-02")] });
  expect(dates(leap.days)).toEqual([
    "2056-02-27",
    "2056-02-28",
    "2056-02-29",
    "2056-03-01",
    "2056-03-02",
  ]);
});

it("lists a route once, on the day it departs, even when it arrives the next day", () => {
  const plan = planByDay({
    ...none,
    visits: [visit("v", "2054-11-04")],
    routes: [
      route("night", {
        departs_on: "2054-11-02",
        departs_at: "2054-11-02T22:00:00Z",
        arrives_at: "2054-11-03T06:00:00Z",
        departure_timezone: "UTC",
        arrival_timezone: "UTC",
      }),
    ],
  });
  // The arrival day (3 November) gets no entry of its own.
  expect(dates(plan.days)).toEqual(["2054-11-02", "2054-11-04"]);
  expect(summary(plan.days[0].entries)).toEqual(["route"]);
});

it("shows no timeline when the only dated records are routes", () => {
  // A route alone never makes a day audience: the audience's day comes from a visit or stay.
  const records = { ...none, routes: [route("r", { departs_on: "2054-11-02" })] };
  const plan = planByDay(records);
  expect(plan.days).toEqual([]);
  expect(plan.other).toBe(records);
});

it("reads a route's day from its departure instant in its own zone when no day was delivered", () => {
  const plan = planByDay({
    ...none,
    // 23:30 UTC on 2 November is already 3 November in Taipei.
    routes: [
      route("tz", {
        departs_on: undefined,
        departs_at: "2054-11-02T23:30:00Z",
        departure_timezone: "Asia/Taipei",
      }),
    ],
  });
  expect(dates(plan.days)).toEqual([]);
  const withVisit = planByDay({
    ...none,
    visits: [visit("v", "2054-11-02")],
    routes: [
      route("tz", {
        departs_on: undefined,
        departs_at: "2054-11-02T23:30:00Z",
        departure_timezone: "Asia/Taipei",
      }),
    ],
  });
  expect(dates(withVisit.days)).toEqual(["2054-11-02", "2054-11-03"]);
});

it("keeps month- and year-precision records, undated visits and dayless routes out of the days", () => {
  const month = visit("month", "2054-11", { date_precision: "month" });
  const year = visit("year", "2054", { date_precision: "year" });
  const undated = visit("undated", undefined);
  const monthStay = stay("coarse", "2054-11", "2054-11", { date_precision: "month" });
  const dayless = route("dayless", { departs_on: undefined });
  const plan = planByDay({
    visits: [month, visit("day", "2054-11-05"), year, undated],
    stays: [monthStay],
    routes: [dayless, route("dated", { departs_on: "2054-11-05" })],
  });
  expect(dates(plan.days)).toEqual(["2054-11-05"]);
  expect(plan.other.visits).toEqual([month, year, undated]);
  expect(plan.other.stays).toEqual([monthStay]);
  expect(plan.other.routes).toEqual([dayless]);
  expect(plan.daysNotShared).toBe(false);
});

it("places a route on a day only when it receives a day, and keeps a month or year route in the other plans", () => {
  const month = route("month", { departs_on: "2054-11", date_precision: "month" });
  const year = route("year", { departs_on: "2054", date_precision: "year" });
  // A route that says it is coarser never reads a day from a string that happens to look like one.
  const lying = route("lying", { departs_on: "2054-11-05", date_precision: "month" });
  const day = route("day", { departs_on: "2054-11-05", date_precision: "day" });
  const legacy = route("legacy", { departs_on: "2054-11-05" });
  const plan = planByDay({
    visits: [visit("v", "2054-11-05")],
    stays: [],
    routes: [month, year, lying, day, legacy],
  });
  expect(dates(plan.days)).toEqual(["2054-11-05"]);
  expect(plan.days[0].entries.map((entry) => entry.key)).toEqual([
    "route-day",
    "route-legacy",
    "visit-v",
  ]);
  expect(plan.other.routes).toEqual([month, year, lying]);
  expect(planByDay({ ...none, routes: [month, year] }).other.routes).toEqual([month, year]);
});

it("never reads a day from a month route's departure instant", () => {
  const plan = planByDay({
    visits: [visit("v", "2054-11-02")],
    stays: [],
    routes: [
      route("m", {
        departs_on: "2054-11",
        date_precision: "month",
        departs_at: "2054-11-02T09:00:00Z",
        departure_timezone: "Asia/Taipei",
      }),
    ],
  });
  expect(dates(plan.days)).toEqual(["2054-11-02"]);
  expect(plan.days[0].entries.map((entry) => entry.type)).toEqual(["visit"]);
  expect(plan.other.routes.map((item) => item.id)).toEqual(["m"]);
});

it("never places a record whose precision is coarser than a day, whatever its string says", () => {
  const plan = planByDay({
    ...none,
    visits: [
      visit("v-day", "2054-11-05"),
      // A full-looking date under a coarser precision is not a day.
      visit("v-coarse", "2054-11-06", { date_precision: "month" }),
      visit("v-impossible", "2054-02-31"),
    ],
    stays: [stay("s-coarse", "2054-11-01", "2054-11-04", { date_precision: "year" })],
  });
  expect(dates(plan.days)).toEqual(["2054-11-05"]);
  expect(plan.other.visits.map((item) => item.id)).toEqual(["v-coarse", "v-impossible"]);
  expect(plan.other.stays.map((item) => item.id)).toEqual(["s-coarse"]);
});

it("shows only the check-in of a stay whose end day was not delivered or is not after it", () => {
  const plan = planByDay({
    ...none,
    stays: [
      stay("open", "2054-11-01", "2054-11"),
      stay("same", "2054-11-10", "2054-11-10"),
      stay("backwards", "2054-11-20", "2054-11-18"),
    ],
  });
  expect(plan.days.flatMap((day) => summary(day.entries))).toEqual([
    "stay:check-in",
    "stay:check-in",
    "stay:check-in",
  ]);
  expect(dates(plan.days)).toEqual(["2054-11-01", "2054-11-10", "2054-11-20"]);
});

it("does not unroll an absurdly long stay night by night", () => {
  const plan = planByDay({ ...none, stays: [stay("long", "2054-01-01", "2060-01-01")] });
  expect(plan.days.flatMap((day) => summary(day.entries))).toEqual([
    "stay:check-in",
    "stay:check-out",
  ]);
});

it("keeps repeat visits on one day apart, in the order delivered, and puts the timed one first", () => {
  const plan = planByDay({
    ...none,
    visits: [
      visit("late", "2054-11-05"),
      visit("again", "2054-11-05", { start_time: "09:00" }),
      visit("third", "2054-11-05"),
    ],
  });
  expect(plan.days).toHaveLength(1);
  expect(plan.days[0].entries.map((entry) => entry.item.id)).toEqual(["again", "late", "third"]);
});

it("orders a day as check-out, departures, visits, then where the traveller sleeps", () => {
  const plan = planByDay({
    visits: [visit("v", "2054-11-05")],
    stays: [stay("a", "2054-11-03", "2054-11-05"), stay("b", "2054-11-05", "2054-11-07")],
    routes: [route("r", { departs_on: "2054-11-05" })],
  });
  expect(plan.days.find((day) => day.date === "2054-11-05")?.entries.map((e) => e.key)).toEqual([
    "stay-a-check-out",
    "route-r",
    "visit-v",
    "stay-b",
  ]);
});

it("gives an end day only when the visit shares one after its start", () => {
  const plan = planByDay({
    ...none,
    visits: [
      visit("range", "2054-11-05", { ends_on: "2054-11-07" }),
      visit("month-end", "2054-11-09", { ends_on: "2054-11" }),
      visit("earlier", "2054-11-12", { ends_on: "2054-11-10" }),
    ],
  });
  expect(plan.days.map((day) => (day.entries[0] as { until: string | null }).until)).toEqual([
    "2054-11-07",
    null,
    null,
  ]);
  // A multi-day visit is on its first day only: no later day is invented.
  expect(dates(plan.days)).toEqual(["2054-11-05", "2054-11-09", "2054-11-12"]);
});

it("shows no days, and says why, when every shared visit and stay is month or year precision", () => {
  const records = {
    visits: [visit("v", "2054-11", { date_precision: "month" })],
    stays: [stay("s", "2054", "2054", { date_precision: "year" })],
    routes: [route("r")],
  };
  const plan = planByDay(records);
  expect(plan.days).toEqual([]);
  expect(plan.other).toBe(records);
  expect(plan.daysNotShared).toBe(true);
});

it("gives no reason when nothing was dated by precision: undated records or only routes", () => {
  expect(planByDay({ ...none, visits: [visit("u", undefined)] }).daysNotShared).toBe(false);
  expect(planByDay({ ...none, routes: [route("r")] }).daysNotShared).toBe(false);
  expect(planByDay(none).daysNotShared).toBe(false);
});

it("tells a day audience from records already shown with a story update", () => {
  // The day-precision visit sits under a story update, so the Plan holds only the month visit and no timeline.
  const grouped = visit("grouped", "2054-11-05");
  const month = visit("month", "2054-11", { date_precision: "month" });
  const plan = planByDay({ ...none, visits: [month] }, { visits: [grouped, month], stays: [] });
  expect(plan.days).toEqual([]);
  expect(plan.daysNotShared).toBe(false);
  expect(plan.other.visits).toEqual([month]);
});

function projection(extra: Partial<Projection> = {}): Projection {
  return {
    schema_version: "travel/public-trip@1",
    title: "Day plan",
    summary: null,
    dates: null,
    navigation: [],
    visits: [],
    places: [],
    updates: [],
    stays: [],
    routes: [],
    media: [],
    ...extra,
  };
}

it("renders a day-by-day timeline with the stay across its nights and the rest as other plans", () => {
  const view = render(
    <ProjectionView
      projection={projection({
        visits: [
          visit("walk", "2054-10-31", { start_time: "09:30", timezone: "Asia/Taipei" }),
          visit("month", "2054-11", { date_precision: "month", title: "Market sometime" }),
        ],
        stays: [stay("s", "2054-10-30", "2054-11-02")],
        routes: [route("r", { departs_on: "2054-11-02", label: "Coast train" })],
      })}
      audience="public"
      identifier="slug"
    />,
  );
  const plan = view.container.querySelector("[data-day-plan]")!;
  const days = [...plan.querySelectorAll("[data-day]")].map((day) => day.getAttribute("data-day"));
  expect(days).toEqual(["2054-10-30", "2054-10-31", "2054-11-01", "2054-11-02"]);
  const day = (date: string) => within(plan.querySelector<HTMLElement>(`[data-day="${date}"]`)!);
  expect(day("2054-10-30").getByText("Verblijf: Alpha")).toBeTruthy();
  expect(day("2054-10-31").getByText("Slapen in Alpha")).toBeTruthy();
  expect(day("2054-10-31").getByText("Visit walk")).toBeTruthy();
  expect(day("2054-11-01").getByText("Slapen in Alpha")).toBeTruthy();
  expect(day("2054-11-02").getByText("Uitchecken: Alpha")).toBeTruthy();
  expect(day("2054-11-02").getByText("Coast train")).toBeTruthy();
  // The year is left out while the plan stays in one year, and the markup keeps the ISO date.
  expect(plan.querySelector('[data-day="2054-10-30"] time')?.getAttribute("datetime")).toBe(
    "2054-10-30",
  );
  expect(plan.querySelector('[data-day="2054-10-30"] time')?.textContent).not.toContain("2054");
  // The month visit is not on any day: it is listed after, with its own precision and a reason.
  const other = view.container.querySelector<HTMLElement>("[data-other-plans]")!;
  expect(within(other).getByText("Market sometime")).toBeTruthy();
  expect(within(other).getByText("november 2054")).toBeTruthy();
  expect(plan.textContent).not.toContain("Market sometime");
  expect(view.container.querySelector("[data-days-not-shown]")).toBeNull();
});

it("shows the year on the days when the plan crosses a year", () => {
  const view = render(
    <ProjectionView
      projection={projection({ stays: [stay("s", "2054-12-30", "2055-01-02")] })}
      audience="public"
      identifier="slug"
    />,
  );
  expect(view.container.querySelector('[data-day="2054-12-30"] time')?.textContent).toContain(
    "2054",
  );
  expect(view.container.querySelector('[data-day="2055-01-01"] time')?.textContent).toContain(
    "2055",
  );
});

it("keeps today's lists and adds a neutral note when only months are shared", () => {
  const view = render(
    <ProjectionView
      projection={projection({
        visits: [visit("v", "2054-11", { date_precision: "month", title: "November visit" })],
        stays: [stay("s", "2054-11", "2054-11", { date_precision: "month" })],
        routes: [route("r")],
      })}
      audience="share"
      identifier="token"
    />,
  );
  expect(view.container.querySelector("[data-day-plan]")).toBeNull();
  expect(view.container.querySelector("[data-other-plans]")).toBeNull();
  expect(view.container.querySelector("[data-day]")).toBeNull();
  for (const heading of ["Bezoeken", "Verblijven", "Routes"])
    expect(within(view.container).getByRole("heading", { name: heading, level: 2 })).toBeTruthy();
  const note = view.container.querySelector("[data-days-not-shown]")!;
  expect(note.textContent).toBe(
    "Voor de bezoeken en verblijven van deze reis worden geen exacte dagen getoond.",
  );
  // The note says nothing about settings, audiences or the owner.
  expect(note.textContent).not.toMatch(/precisi|instelling|eigenaar|owner|publiek/i);
});

it("derives nothing from records it does not receive", () => {
  // Only a stay, with no visit or route in the document: no invented day, count or activity.
  const view = render(
    <ProjectionView
      projection={projection({ stays: [stay("s", "2054-11-01", "2054-11-03")] })}
      audience="public"
      identifier="slug"
    />,
  );
  const days = [...view.container.querySelectorAll("[data-day]")].map((day) =>
    day.getAttribute("data-day"),
  );
  expect(days).toEqual(["2054-11-01", "2054-11-02", "2054-11-03"]);
  expect(view.container.querySelector("[data-other-plans]")).toBeNull();
  expect(
    view.container.querySelectorAll('[data-day-entry="visit"], [data-day-entry="route"]'),
  ).toHaveLength(0);
  expect(view.container.textContent).not.toMatch(/\d+ (nights?|nachten?|days?|dagen)/i);
});
