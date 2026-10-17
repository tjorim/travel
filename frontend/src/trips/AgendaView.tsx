import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { Button } from "@base-ui/react/button";
import { useMemo } from "react";

import { useTripResource } from "../query/owner-queries";
import {
  addDays,
  formatDayRange,
  localDate,
  routeTitle,
  stayLabel,
  visitTitle,
  wallClock,
  type Trip,
} from "../tracker-model";

export type AgendaRecordKind = "stay" | "route" | "visit";

type AgendaItem = {
  id: string;
  recordKind: AgendaRecordKind;
  recordId: string;
  kind: string;
  title: string;
  first: string;
  last: string | null;
  time: string | null;
  where: string;
};

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

  const items = useMemo<AgendaItem[]>(
    () =>
      [
        ...(staysQuery.data ?? []).map((stay): AgendaItem => ({
          id: `stay-${stay.id}`,
          recordKind: "stay",
          recordId: stay.id,
          kind: m.owner_stay(),
          title: stayLabel(stay),
          first: stay.check_in_date,
          last: addDays(stay.check_out_date, -1),
          time: stay.check_in_time?.slice(0, 5) ?? null,
          where: stay.area.label,
        })),
        // A route is on its departure day, with a time only once it has one.
        ...(routesQuery.data ?? []).flatMap((route): AgendaItem[] =>
          route.departs_on
            ? [
                {
                  id: `route-${route.id}`,
                  recordKind: "route",
                  recordId: route.id,
                  kind: m.owner_route(),
                  title: routeTitle(route),
                  first: route.departs_on,
                  last: route.arrives_at
                    ? localDate(route.arrives_at, route.arrival_timezone)
                    : null,
                  time: route.departs_at
                    ? wallClock(route.departs_at, route.departure_timezone).slice(11, 16)
                    : null,
                  where: route.departure_area.label,
                },
              ]
            : [],
        ),
        ...(visitsQuery.data ?? []).flatMap((visit): AgendaItem[] =>
          visit.starts_on
            ? [
                {
                  id: `visit-${visit.id}`,
                  recordKind: "visit",
                  recordId: visit.id,
                  kind: m.owner_visit(),
                  title: visitTitle(visit),
                  first: visit.starts_on,
                  last: visit.ends_on,
                  time: visit.start_time?.slice(0, 5) ?? null,
                  where: visit.area.label,
                },
              ]
            : [],
        ),
        // The list above is already in each record's own meaningful order (stays by check-in day,
        // routes by day/time/creation, visits by explicit position); a stable sort below keeps that
        // order for same-day, same-time ties instead of an opaque id breaking it arbitrarily.
      ].sort(
        (left, right) =>
          left.first.localeCompare(right.first) ||
          (left.time ?? "99:99").localeCompare(right.time ?? "99:99"),
      ),
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
        first: "",
        last: null,
        time: null,
        where: visit.area.label,
      })),
    ...(routesQuery.data ?? [])
      .filter((route) => !route.departs_on)
      .map((route): AgendaItem => ({
        id: `route-${route.id}`,
        recordKind: "route",
        recordId: route.id,
        kind: m.owner_route(),
        title: routeTitle(route),
        first: "",
        last: null,
        time: null,
        where: route.departure_area.label,
      })),
  ];

  const row = (item: AgendaItem) => (
    <li key={item.id}>
      <Button
        className="block w-full cursor-pointer border-0 bg-transparent px-0 py-1 text-left text-inherit disabled:cursor-default enabled:hover:underline enabled:focus-visible:underline"
        type="button"
        disabled={!onOpenRecord}
        onClick={() => onOpenRecord?.(item.recordKind, item.recordId)}
        aria-label={m.owner_open_3({ p0: item.kind, p1: item.title })}
      >
        {item.time && <time>{item.time}</time>}{" "}
        <span>
          {item.kind}: {item.title}
        </span>{" "}
        <small>
          {item.last && item.last !== item.first
            ? `${formatDayRange(item.first, item.last)} · `
            : ""}
          {item.where}
        </small>
      </Button>
    </li>
  );

  return (
    <section className="travel-card manager" id="agenda" aria-labelledby="agenda-title">
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
