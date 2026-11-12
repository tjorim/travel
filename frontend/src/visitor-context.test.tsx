// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  ProjectionView,
  type Projection,
  type ProjectionRoute,
  type ProjectionStay,
  type ProjectionUpdate,
  type ProjectionVisit,
} from "./ProjectionView";
import { fixture } from "./test-projection";
import { groupStoryContext } from "./visitor-context";

afterEach(cleanup);

const area = (label: string, latitude = 1.5, longitude = 2.5) => ({
  label,
  country_code: "XX",
  region: null,
  latitude,
  longitude,
});
const update = (id: string, story_date: string, place: unknown = area("Alpha")): ProjectionUpdate =>
  fixture<ProjectionUpdate>({
    id,
    title: `Story ${id}`,
    body: "Text",
    story_date,
    date_precision: "day",
    place,
  });
const visit = (id: string, starts_on: string | undefined, extra = {}): ProjectionVisit =>
  fixture<ProjectionVisit>({
    id,
    title: `Visit ${id}`,
    place: area("Alpha"),
    date_precision: "day",
    ...(starts_on ? { starts_on, ends_on: null } : {}),
    ...extra,
  });
const stay = (id: string, starts_on: string, ends_on: string, extra = {}): ProjectionStay =>
  fixture<ProjectionStay>({
    id,
    title: "Alpha",
    place: area("Alpha"),
    date_precision: "day",
    starts_on,
    ends_on,
    ...extra,
  });
const route = (id: string, extra = {}): ProjectionRoute =>
  fixture<ProjectionRoute>({
    id,
    mode: "train",
    status: "planned",
    departure: area("Alpha"),
    arrival: area("Beta", 3, 4),
    departs_on: "2054-11-02",
    ...extra,
  });
const ids = (items: { id: string }[]) => items.map((item) => item.id);

it("ties a visit, stay and route to the one update sharing their area and day", () => {
  const result = groupStoryContext({
    updates: [update("u1", "2054-11-02")],
    visits: [visit("v1", "2054-11-02")],
    stays: [stay("s1", "2054-11-01", "2054-11-04")],
    routes: [route("r1")],
  });
  const context = result.byUpdate.get("u1")!;
  expect([ids(context.visits), ids(context.stays), ids(context.routes)]).toEqual([
    ["v1"],
    ["s1"],
    ["r1"],
  ]);
  expect(result.separate).toEqual({ visits: [], stays: [], routes: [] });
});

it("keeps repeat visits on different days with their own updates", () => {
  const result = groupStoryContext({
    updates: [update("u1", "2054-11-02"), update("u2", "2054-11-09")],
    visits: [visit("v1", "2054-11-02"), visit("v2", "2054-11-09")],
    stays: [],
    routes: [],
  });
  expect(ids(result.byUpdate.get("u1")!.visits)).toEqual(["v1"]);
  expect(ids(result.byUpdate.get("u2")!.visits)).toEqual(["v2"]);
});

it("keeps two visits to one place on one day together under that update", () => {
  const result = groupStoryContext({
    updates: [update("u1", "2054-11-02")],
    visits: [visit("v1", "2054-11-02"), visit("v2", "2054-11-02")],
    stays: [],
    routes: [],
  });
  expect(ids(result.byUpdate.get("u1")!.visits)).toEqual(["v1", "v2"]);
});

it("leaves undated, month and year precision records in separate blocks", () => {
  const result = groupStoryContext({
    updates: [update("u1", "2054-11-02")],
    visits: [
      visit("undated", undefined),
      visit("month", "2054-11", { date_precision: "month" }),
      visit("year", "2054", { date_precision: "year" }),
    ],
    stays: [stay("coarse", "2054-11", "2054-11", { date_precision: "month" })],
    routes: [route("no-day", { departs_on: undefined })],
  });
  expect(result.byUpdate.size).toBe(0);
  expect(ids(result.separate.visits)).toEqual(["undated", "month", "year"]);
  expect(ids(result.separate.stays)).toEqual(["coarse"]);
  expect(ids(result.separate.routes)).toEqual(["no-day"]);
});

it("does not guess when several updates share the area and day, or a stay spans several", () => {
  const result = groupStoryContext({
    updates: [update("u1", "2054-11-02"), update("u2", "2054-11-02"), update("u3", "2054-11-03")],
    visits: [visit("v1", "2054-11-02")],
    stays: [stay("s1", "2054-11-03", "2054-11-05"), stay("s2", "2054-11-02", "2054-11-03")],
    routes: [],
  });
  expect(ids(result.separate.visits)).toEqual(["v1"]);
  expect(ids(result.separate.stays)).toEqual(["s2"]);
  expect(ids(result.byUpdate.get("u3")!.stays)).toEqual(["s1"]);
});

it("keeps records separate when updates in different areas share the date", () => {
  const result = groupStoryContext({
    updates: [update("u1", "2054-11-02"), update("u2", "2054-11-02", area("Beta", 3, 4))],
    visits: [visit("v1", "2054-11-02"), visit("elsewhere", "2054-11-02", { place: area("Gamma") })],
    stays: [],
    routes: [route("r1")],
  });
  expect(ids(result.byUpdate.get("u1")!.visits)).toEqual(["v1"]);
  expect(ids(result.separate.visits)).toEqual(["elsewhere"]);
  // The route touches both updates' areas that day, so it is ambiguous.
  expect(ids(result.separate.routes)).toEqual(["r1"]);
});

it("ignores updates without a day-precision date or a shared area", () => {
  const result = groupStoryContext({
    updates: [
      { ...update("month", "2054-11"), date_precision: "month" },
      update("nowhere", "2054-11-02", null),
    ],
    visits: [visit("v1", "2054-11-02")],
    stays: [],
    routes: [],
  });
  expect(ids(result.separate.visits)).toEqual(["v1"]);
});

it("leaves a route shared only by month or year in the separate block", () => {
  const result = groupStoryContext({
    updates: [update("u1", "2054-11-02")],
    visits: [],
    stays: [],
    routes: [
      route("month", { departs_on: "2054-11", date_precision: "month" }),
      route("year", { departs_on: "2054", date_precision: "year" }),
      route("lying", { departs_on: "2054-11-02", date_precision: "month" }),
      route("day", { departs_on: "2054-11-02", date_precision: "day" }),
    ],
  });
  expect(ids(result.byUpdate.get("u1")!.routes)).toEqual(["day"]);
  expect(ids(result.separate.routes)).toEqual(["month", "year", "lying"]);
});

it("reads a timed route's day in its departure time zone", () => {
  const result = groupStoryContext({
    updates: [update("u1", "2054-11-03")],
    visits: [],
    stays: [],
    routes: [
      route("r1", {
        departs_on: undefined,
        departs_at: "2054-11-02T20:00:00+00:00",
        departure_timezone: "Asia/Taipei",
      }),
    ],
  });
  expect(ids(result.byUpdate.get("u1")!.routes)).toEqual(["r1"]);
});

function data(): Projection {
  return {
    schema_version: "travel/public-trip@1",
    title: "Trip",
    summary: null,
    dates: null,
    navigation: [],
    places: [],
    media: [],
    updates: [update("u1", "2054-11-02")],
    visits: [visit("v1", "2054-11-02"), visit("loose", undefined)],
    stays: [stay("s1", "2054-11-02", "2054-11-03")],
    routes: [route("r1")],
  };
}

it("renders grouped records inside their update and the rest in compact blocks", () => {
  const view = render(<ProjectionView projection={data()} audience="public" identifier="slug" />);
  const grouped = view.container.querySelector("[data-update-context]")!;
  expect(grouped.closest("article")?.textContent).toContain("Story u1");
  expect(grouped.textContent).toContain("Bezoek: Visit v1");
  expect(grouped.textContent).toContain("Verblijf: Alpha");
  expect(grouped.textContent).toContain("Alpha · XX → Beta · XX");
  expect(grouped.textContent).not.toContain("Visit loose");
  // Each record appears once: grouped records are not repeated in the plan blocks.
  expect(view.container.querySelectorAll("#visit-v1")).toHaveLength(1);
  expect(view.container.querySelector("#visit-loose")).not.toBeNull();
  expect(view.container.querySelector("#stay-s1")?.closest("[data-update-context]")).not.toBeNull();
});

it("shows no private visit, property, booking or note values that the projection never carried", () => {
  // The projection is the whole input; strings the server never sends cannot be rendered. This guards the DOM
  // against any field outside the visitor allowlist reaching the grouped block.
  const canary = [
    "CANARY-PRIVATE-VISIT",
    "CANARY-PROPERTY-NAME",
    "CANARY-BOOKING-REF",
    "CANARY-PRIVATE-NOTE",
    "CANARY-STREET-ADDRESS",
  ];
  const input = data();
  input.visits[0] = fixture<ProjectionVisit>({
    ...input.visits[0],
    private_title: canary[0],
    private_notes: canary[3],
  });
  input.stays[0] = fixture<ProjectionStay>({
    ...input.stays[0],
    property_name: canary[1],
    booking_reference: canary[2],
    address_line1: canary[4],
  });
  input.routes[0] = fixture<ProjectionRoute>({
    ...input.routes[0],
    booking_reference: canary[2],
    notes: canary[3],
  });
  const view = render(<ProjectionView projection={input} audience="share" identifier="slug" />);
  for (const value of canary) expect(view.container.innerHTML).not.toContain(value);
});
