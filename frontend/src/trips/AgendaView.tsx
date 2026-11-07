import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { Button } from "@/ui/button";
import { useMemo } from "react";

import { useTripResource } from "../query/owner-queries";
import {
  addDays,
  formatDayRange,
  localDate,
  routeTitle,
  stayInPlan,
  stayLabel,
  visitTitle,
  wallClock,
  type Trip,
  type Stay,
  type Route,
  type Visit,
  areaName,
} from "../tracker-model";

export type AgendaRecordKind = "stay" | "route" | "visit";

export type AgendaItem = {
  id: string;
  recordKind: AgendaRecordKind;
  recordId: string;
  kind: string;
  title: string;
  /** What the row says: the kind and title, or for a stay's later nights where the owner sleeps. */
  text: string;
  /** The day this item is listed under. */
  first: string;
  /** The last day it also covers, for a route or visit that spans days; a stay lists each of its days itself. */
  last: string | null;
  /** The last day of the span the row names, shown beside the first. */
  through: string | null;
  time: string | null;
  where: string;
  /** For a stay: the check-in day, a later night or the check-out morning. */
  phase?: "check-in" | "night" | "check-out";
};

/**
 * A stay on every day it matters: the check-in day (with its range), each night after it as "sleeping in",
 * and the check-out morning, which adds no night. Only a stay in the plan sleeps anywhere; an idea or a
 * cancelled stay is listed on its check-in day alone. All arithmetic is on date-only strings.
 */
function stayItems(stay: Stay): AgendaItem[] {
  const base = {
    recordKind: "stay" as const,
    recordId: stay.id,
    kind: m.owner_stay(),
    last: null,
    where: areaName(stay.area),
  };
  const place = stay.property_name ?? areaName(stay.area);
  const lastNight = addDays(stay.check_out_date, -1);
  const checkIn: AgendaItem = {
    ...base,
    id: `stay-${stay.id}`,
    title: stayLabel(stay),
    text: `${base.kind}: ${stayLabel(stay)}`,
    first: stay.check_in_date,
    through: lastNight,
    time: stay.check_in_time?.slice(0, 5) ?? null,
    phase: "check-in",
  };
  if (!stayInPlan(stay) || stay.check_out_date <= stay.check_in_date) return [checkIn];
  const nights: AgendaItem[] = [];
  for (
    let night = addDays(stay.check_in_date, 1);
    night < stay.check_out_date;
    night = addDays(night, 1)
  )
    nights.push({
      ...base,
      id: `stay-${stay.id}-night-${night}`,
      title: place,
      text: m.agenda_sleeping_in({ place }),
      first: night,
      through: null,
      time: null,
      phase: "night",
    });
  return [
    checkIn,
    ...nights,
    {
      ...base,
      id: `stay-${stay.id}-check-out`,
      title: place,
      text: m.agenda_check_out({ place }),
      first: stay.check_out_date,
      through: null,
      time: stay.check_out_time?.slice(0, 5) ?? null,
      phase: "check-out",
    },
  ];
}

/** Within a day: timed first; an untimed check-out is the morning's first thing, other untimed items come last. */
const sortTime = (item: AgendaItem) =>
  item.time ?? (item.phase === "check-out" ? "00:00" : "99:99");

export function buildAgendaItems(stays: Stay[], routes: Route[], visits: Visit[]): AgendaItem[] {
  return [
    ...stays.flatMap(stayItems),
    // A route is on its departure day, with a time only once it has one.
    ...routes.flatMap((route): AgendaItem[] =>
      route.departs_on
        ? [
            {
              id: `route-${route.id}`,
              recordKind: "route",
              recordId: route.id,
              kind: m.owner_route(),
              title: routeTitle(route),
              text: `${m.owner_route()}: ${routeTitle(route)}`,
              first: route.departs_on,
              last: route.arrives_at ? localDate(route.arrives_at, route.arrival_timezone) : null,
              through: route.arrives_at
                ? localDate(route.arrives_at, route.arrival_timezone)
                : null,
              time: route.departs_at
                ? wallClock(route.departs_at, route.departure_timezone).slice(11, 16)
                : null,
              where: areaName(route.departure_area),
            },
          ]
        : [],
    ),
    ...visits.flatMap((visit): AgendaItem[] =>
      visit.starts_on
        ? [
            {
              id: `visit-${visit.id}`,
              recordKind: "visit",
              recordId: visit.id,
              kind: m.owner_visit(),
              title: visitTitle(visit),
              text: `${m.owner_visit()}: ${visitTitle(visit)}`,
              first: visit.starts_on,
              last: visit.ends_on,
              through: visit.ends_on,
              time: visit.start_time?.slice(0, 5) ?? null,
              where: areaName(visit.area),
            },
          ]
        : [],
    ),
    // The list above is already in each record's own meaningful order (stays by check-in day,
    // routes by day/time/creation, visits by explicit position); a stable sort below keeps that
    // order for same-day, same-time ties instead of an opaque id breaking it arbitrarily.
  ].sort(
    (left, right) =>
      left.first.localeCompare(right.first) || sortTime(left).localeCompare(sortTime(right)),
  );
}

/**
 * Everything on the trip by day, in order, then what has no day yet: each row opens the record it
 * describes, since it is still edited in its own section.
 * Within a day, timed items come first; untimed items keep their record's own order (a route by
 * departure day/time/creation order, a visit by its explicit position), not their opaque id.
 */
export function AgendaView({
  trip,
  onOpenRecord,
}: {
  trip: Trip;
  onOpenRecord?: (kind: AgendaRecordKind, id: string) => void;
}) {
  const locale = useLocale();
  const staysQuery = useTripResource(trip.id, "stays");
  const routesQuery = useTripResource(trip.id, "routes");
  const visitsQuery = useTripResource(trip.id, "visits");

  const items = useMemo(
    () => buildAgendaItems(staysQuery.data ?? [], routesQuery.data ?? [], visitsQuery.data ?? []),
    [locale, staysQuery.data, routesQuery.data, visitsQuery.data],
  );

  const days = items.reduce(
    (map, item) => map.set(item.first, [...(map.get(item.first) ?? []), item]),
    new Map<string, AgendaItem[]>(),
  );
  // Nothing disappears: what has no day yet is listed on its own.
  const undated: AgendaItem[] = [
    ...(visitsQuery.data ?? [])
      .filter((visit) => !visit.starts_on)
      .map((visit): AgendaItem => ({
        id: `visit-${visit.id}`,
        recordKind: "visit",
        recordId: visit.id,
        kind: m.owner_visit(),
        title: visitTitle(visit),
        text: `${m.owner_visit()}: ${visitTitle(visit)}`,
        first: "",
        last: null,
        through: null,
        time: null,
        where: areaName(visit.area),
      })),
    ...(routesQuery.data ?? [])
      .filter((route) => !route.departs_on)
      .map((route): AgendaItem => ({
        id: `route-${route.id}`,
        recordKind: "route",
        recordId: route.id,
        kind: m.owner_route(),
        title: routeTitle(route),
        text: `${m.owner_route()}: ${routeTitle(route)}`,
        first: "",
        last: null,
        through: null,
        time: null,
        where: areaName(route.departure_area),
      })),
  ];

  const row = (item: AgendaItem) => (
    <li key={item.id}>
      <Button
        className="block w-full cursor-pointer border-0 bg-transparent px-0 py-1 text-left text-inherit disabled:cursor-default enabled:hover:underline enabled:focus-visible:underline"
        type="button"
        disabled={!onOpenRecord}
        onClick={() => onOpenRecord?.(item.recordKind, item.recordId)}
      >
        {item.time && <time>{item.time}</time>} <span>{item.text}</span>{" "}
        <small>
          {item.through && item.through !== item.first
            ? `${formatDayRange(item.first, item.through)} · `
            : ""}
          {item.where}
        </small>
      </Button>
    </li>
  );

  return (
    <section className="travel-card manager" aria-labelledby="agenda-title">
      <div className="capture-heading">
        <div>
          <h3 id="agenda-title">{m.owner_agenda()}</h3>
          <p>
            {m.owner_everything_by_day_in_order_anything_without_a_day_is_listed_at_the_botto()}
          </p>
        </div>
      </div>
      {items.length === 0 && undated.length === 0 ? (
        <p>{m.owner_nothing_in_the_agenda_yet_add_a_stay_route_or_visit_to_see_it_here()}</p>
      ) : (
        <div className="saved-records mt-0.5">
          {[...days].map(([day, entries]) => (
            <article className="excerpt-row" data-stacked="" key={day}>
              <strong>{formatDayRange(day, null)}</strong>
              <ul className="m-0 grid gap-1.5 pl-5">{entries.map(row)}</ul>
            </article>
          ))}
          {undated.length > 0 && (
            <article className="excerpt-row" data-stacked="">
              <strong>{m.owner_no_day_yet()}</strong>
              <ul className="m-0 grid gap-1.5 pl-5">{undated.map(row)}</ul>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
