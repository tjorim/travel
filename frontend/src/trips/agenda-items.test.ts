import { expect, it } from "vitest";

import type { Area, Route, Stay, Visit } from "../api-types";
import {
  agendaStatusGroup,
  buildAgendaItems,
  filterAgenda,
  filterAgendaByKind,
  filterAgendaByStatus,
  groupAgendaItems,
  isRecordRow,
  isUndated,
  withTripDays,
} from "./agenda-items";
import { routeLine } from "@/features/trips/routes/model";
import { stayLine } from "@/features/trips/stays/model";
import { visitLine } from "@/features/trips/visits/model";

const taipei = { id: "taipei", label: "Taipei", timezone: "Asia/Taipei" } as Area;
const tainan = { id: "tainan", label: "Tainan", timezone: "Asia/Taipei" } as Area;

const stay = (id: string, extra: Partial<Stay> = {}): Stay =>
  ({
    id,
    status: "planned",
    visibility: "private",
    check_in_date: "2054-11-16",
    check_out_date: "2054-11-18",
    check_in_time: null,
    check_out_time: null,
    property_name: "Hotel Royal",
    location: null,
    area: taipei,
    ...extra,
  }) as Stay;
const route = (id: string, extra: Partial<Route> = {}): Route =>
  ({
    id,
    mode: "train",
    status: "planned",
    visibility: "private",
    label: null,
    departs_on: "2054-11-18",
    departs_at: null,
    arrives_at: null,
    departure_timezone: null,
    arrival_timezone: null,
    departure_area: taipei,
    arrival_area: tainan,
    carrier: null,
    geometry: null,
    ...extra,
  }) as Route;
const visit = (id: string, extra: Partial<Visit> = {}): Visit =>
  ({
    id,
    status: "planned",
    visibility: "private",
    title: "Hot springs",
    kind: null,
    area: taipei,
    location: null,
    starts_on: "2054-11-17",
    ends_on: null,
    start_time: null,
    end_time: null,
    ...extra,
  }) as Visit;

it("carries each record's status, visibility and its per-kind line", () => {
  const stayRecord = stay("s", { visibility: "everyone", status: "idea" });
  const routeRecord = route("r", { carrier: "Taiwan Railways", visibility: "custom" });
  const visitRecord = visit("v", { status: "cancelled" });
  const items = buildAgendaItems([stayRecord], [routeRecord], [visitRecord]);
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));

  expect(byId["stay-s"]).toMatchObject({
    status: "idea",
    visibility: "everyone",
    line: stayLine(stayRecord),
    record: { kind: "stay", value: stayRecord },
  });
  expect(byId["route-r"]).toMatchObject({
    status: "planned",
    visibility: "custom",
    line: routeLine(routeRecord),
    record: { kind: "route", value: routeRecord },
  });
  expect(byId["visit-v"]).toMatchObject({
    status: "cancelled",
    visibility: "private",
    line: visitLine(visitRecord),
    record: { kind: "visit", value: visitRecord },
  });
});

it("builds the per-kind line without status and visibility", () => {
  const [checkIn] = buildAgendaItems([stay("s")], [], []);
  expect(checkIn.line).toContain("Taipei");
  // A stay without a linked location is flagged while it is an idea or planned.
  expect(checkIn.line).toContain("Locatie nog niet gekoppeld");
  expect(checkIn.line).not.toContain("Gepland");
  expect(stayLine(stay("s"), { withStatus: true })).toContain("Gepland");

  const [carrier] = buildAgendaItems(
    [],
    [route("r", { carrier: "Taiwan Railways", geometry: { type: "LineString", coordinates: [] } })],
    [],
  );
  expect(carrier.line).toContain("Trein");
  expect(carrier.line).toContain("Taiwan Railways");
  expect(carrier.line).toContain("met lijn");

  const [cancelled] = buildAgendaItems([], [], [visit("v", { status: "cancelled" })]);
  expect(cancelled.line).not.toContain("Geannuleerd");
  expect(visitLine(visit("v", { status: "cancelled" }), { withStatus: true })).toContain(
    "Geannuleerd",
  );
});

it("gives every row of a stay's days the stay's status, visibility and line", () => {
  const items = buildAgendaItems(
    [stay("s", { status: "confirmed", visibility: "everyone" })],
    [],
    [],
  );
  expect(items.map((item) => item.phase)).toEqual(["check-in", "night", "check-out"]);
  for (const item of items)
    expect(item).toMatchObject({ status: "confirmed", visibility: "everyone", recordId: "s" });
});

it("builds the rows with no day yet, after the dated ones: visits first, then routes", () => {
  const items = buildAgendaItems(
    [stay("s")],
    [route("undated-route", { departs_on: null }), route("dated-route")],
    [visit("undated-visit", { starts_on: null }), visit("dated-visit")],
  );
  expect(items.map((item) => item.id)).toEqual([
    "stay-s",
    "stay-s-night-2054-11-17",
    "visit-dated-visit",
    "stay-s-check-out",
    "route-dated-route",
    "visit-undated-visit",
    "route-undated-route",
  ]);
  const undated = items.filter(isUndated);
  expect(undated.map((item) => item.recordKind)).toEqual(["visit", "route"]);
  for (const item of undated)
    expect(item).toMatchObject({ first: "", last: null, through: null, time: null });
  expect(undated[0]).toMatchObject({ text: "Bezoek: Hot springs", where: "Taipei" });
  expect(undated[1].where).toBe("Taipei");
});

it("groups the rows by day in order, with the undated rows apart", () => {
  const items = buildAgendaItems([stay("s")], [route("r", { departs_on: null })], [visit("v")]);
  const { days, undated } = groupAgendaItems(items);
  expect(days.map(([day, rows]) => [day, rows.map((item) => item.id)])).toEqual([
    ["2054-11-16", ["stay-s"]],
    ["2054-11-17", ["stay-s-night-2054-11-17", "visit-v"]],
    ["2054-11-18", ["stay-s-check-out"]],
  ]);
  expect(undated.map((item) => item.id)).toEqual(["route-r"]);
});

it("keeps a dated route's arrival day and time, and none for an undated one", () => {
  const [timed] = buildAgendaItems(
    [],
    [
      route("r", {
        departs_at: "2054-11-18T01:30:00+00:00",
        arrives_at: "2054-11-18T17:30:00+00:00",
        departure_timezone: "Asia/Taipei",
        arrival_timezone: "Asia/Taipei",
      }),
    ],
    [],
  );
  expect(timed).toMatchObject({ time: "09:30", last: "2054-11-19", through: "2054-11-19" });
});

const mixed = () =>
  buildAgendaItems(
    [
      stay("s1"),
      stay("s2", { status: "idea", check_in_date: "2054-11-20", check_out_date: "2054-11-21" }),
    ],
    [route("r1", { status: "confirmed" }), route("r2", { status: "cancelled" })],
    [visit("v1"), visit("v2", { status: "idea", starts_on: null })],
  );

it("filters by kind, and shows every kind when none is chosen", () => {
  const items = mixed();
  expect(filterAgendaByKind(items, [])).toEqual(items);
  expect(new Set(filterAgendaByKind(items, ["stay"]).map((item) => item.recordKind))).toEqual(
    new Set(["stay"]),
  );
  expect(
    new Set(filterAgendaByKind(items, ["route", "visit"]).map((item) => item.recordKind)),
  ).toEqual(new Set(["route", "visit"]));
});

it("filters by status group: in plan, ideas, cancelled", () => {
  const items = mixed();
  const ids = (rows: typeof items) => [...new Set(rows.map((item) => item.recordId))].sort();
  expect(filterAgendaByStatus(items, [])).toEqual(items);
  expect(ids(filterAgendaByStatus(items, ["plan"]))).toEqual(["r1", "s1", "v1"]);
  expect(ids(filterAgendaByStatus(items, ["idea"]))).toEqual(["s2", "v2"]);
  expect(ids(filterAgendaByStatus(items, ["cancelled"]))).toEqual(["r2"]);
  expect(ids(filterAgendaByStatus(items, ["idea", "cancelled"]))).toEqual(["r2", "s2", "v2"]);
  expect((["idea", "planned", "confirmed", "cancelled"] as const).map(agendaStatusGroup)).toEqual([
    "idea",
    "plan",
    "plan",
    "cancelled",
  ]);
});

it("combines the kind and status filters and leaves the input untouched", () => {
  const items = mixed();
  const before = [...items];
  const rows = filterAgenda(items, { kinds: ["stay", "visit"], statuses: ["idea"] });
  expect(rows.map((item) => item.id)).toEqual(["stay-s2", "visit-v2"]);
  expect(filterAgenda(items, {})).toEqual(items);
  expect(items).toEqual(before);
});

it("lists every day of the trip, with the days that hold something in their place", () => {
  const { days } = groupAgendaItems(buildAgendaItems([stay("s1")], [], []));
  const listed = withTripDays(days, { starts_on: "2054-11-15", ends_on: "2054-11-19" });
  expect(listed.map(([day]) => day)).toEqual([
    "2054-11-15",
    "2054-11-16",
    "2054-11-17",
    "2054-11-18",
    "2054-11-19",
  ]);
  expect(listed[0]![1]).toEqual([]);
  expect(listed[1]![1].map((item) => item.id)).toEqual(["stay-s1"]);
  // A day outside the trip's dates that holds something keeps its row.
  const outside = withTripDays(days, { starts_on: "2054-11-01", ends_on: "2054-11-02" });
  expect(outside.map(([day]) => day)).toEqual([
    "2054-11-01",
    "2054-11-02",
    "2054-11-16",
    "2054-11-17",
    "2054-11-18",
  ]);
});

it("lists only the days that hold something when the trip has no usable dates", () => {
  const { days } = groupAgendaItems(buildAgendaItems([stay("s1")], [], []));
  for (const dates of [
    { starts_on: null, ends_on: null },
    { starts_on: "2054-11-16", ends_on: null },
    { starts_on: "2054-11-20", ends_on: "2054-11-16" },
    { starts_on: "2000-01-01", ends_on: "2054-11-16" },
  ])
    expect(withTripDays(days, dates)).toEqual(days);
});

it("tells the rows that stand for a record from a stay's later nights", () => {
  const rows = buildAgendaItems([stay("s1")], [], []);
  expect(rows.map((item) => [item.phase, isRecordRow(item)])).toEqual([
    ["check-in", true],
    ["night", false],
    ["check-out", false],
  ]);
});
