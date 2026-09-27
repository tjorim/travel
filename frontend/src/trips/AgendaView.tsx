import { useMemo } from "react";

import { useTripResource } from "../query/owner-queries";
import { addDays, formatDayRange, localDate, routeTitle, stayLabel, visitTitle, wallClock, type Trip } from "../tracker-model";

export type AgendaRecordKind = "stay" | "route" | "visit";

type AgendaItem = {
  id: string; recordKind: AgendaRecordKind; recordId: string; kind: string; title: string;
  first: string; last: string | null; time: string | null; where: string;
};

/**
 * Everything on the trip by day, in order, then what has no day yet: each row opens the record it
 * describes, since it is still edited in its own section.
 * Within a day, timed items come first; untimed items keep their record's own order (a route by
 * departure day/time/creation order, a visit by its explicit position), not their opaque id.
 */
export function AgendaView({ trip, onOpenRecord }: { trip: Trip; onOpenRecord?: (kind: AgendaRecordKind, id: string) => void }) {
  const staysQuery = useTripResource(trip.id, "stays");
  const routesQuery = useTripResource(trip.id, "routes");
  const visitsQuery = useTripResource(trip.id, "visits");

  const items = useMemo<AgendaItem[]>(() => [
    ...(staysQuery.data ?? []).map((stay): AgendaItem => ({ id: `stay-${stay.id}`, recordKind: "stay", recordId: stay.id, kind: "Verblijf", title: stayLabel(stay), first: stay.check_in_date, last: addDays(stay.check_out_date, -1), time: stay.check_in_time?.slice(0, 5) ?? null, where: stay.area.label })),
    // A route is on its departure day, with a time only once it has one.
    ...(routesQuery.data ?? []).flatMap((route): AgendaItem[] => route.departs_on ? [{
      id: `route-${route.id}`, recordKind: "route", recordId: route.id, kind: "Route", title: routeTitle(route), first: route.departs_on, last: route.arrives_at ? localDate(route.arrives_at, route.arrival_timezone) : null,
      time: route.departs_at ? wallClock(route.departs_at, route.departure_timezone).slice(11, 16) : null, where: route.departure_area.label,
    }] : []),
    ...(visitsQuery.data ?? []).flatMap((visit): AgendaItem[] => visit.starts_on ? [{
      id: `visit-${visit.id}`, recordKind: "visit", recordId: visit.id, kind: "Bezoek", title: visitTitle(visit), first: visit.starts_on, last: visit.ends_on, time: visit.start_time?.slice(0, 5) ?? null, where: visit.area.label,
    }] : []),
    // The list above is already in each record's own meaningful order (stays by check-in day,
    // routes by day/time/creation, visits by explicit position); a stable sort below keeps that
    // order for same-day, same-time ties instead of an opaque id breaking it arbitrarily.
  ].sort((left, right) => left.first.localeCompare(right.first) || (left.time ?? "99:99").localeCompare(right.time ?? "99:99")), [staysQuery.data, routesQuery.data, visitsQuery.data]);

  const days = items.reduce((map, item) => map.set(item.first, [...(map.get(item.first) ?? []), item]), new Map<string, AgendaItem[]>());
  // Nothing disappears: what has no day yet is listed on its own.
  const undated: AgendaItem[] = [
    ...(visitsQuery.data ?? []).filter((visit) => !visit.starts_on).map((visit): AgendaItem => ({ id: `visit-${visit.id}`, recordKind: "visit", recordId: visit.id, kind: "Bezoek", title: visitTitle(visit), first: "", last: null, time: null, where: visit.area.label })),
    ...(routesQuery.data ?? []).filter((route) => !route.departs_on).map((route): AgendaItem => ({ id: `route-${route.id}`, recordKind: "route", recordId: route.id, kind: "Route", title: routeTitle(route), first: "", last: null, time: null, where: route.departure_area.label })),
  ];

  const row = (item: AgendaItem) => <li key={item.id}>
    <button className="agenda-entry" type="button" disabled={!onOpenRecord} onClick={() => onOpenRecord?.(item.recordKind, item.recordId)} aria-label={`${item.kind} ${item.title} openen`}>
      {item.time && <time>{item.time}</time>} <span>{item.kind}: {item.title}</span> <small>{item.last && item.last !== item.first ? `${formatDayRange(item.first, item.last)} · ` : ""}{item.where}</small>
    </button>
  </li>;

  return <section className="card manager" id="agenda" aria-labelledby="agenda-title">
    <div className="capture-heading"><div><h3 id="agenda-title">Agenda</h3><p>Alles per dag, op volgorde; wat nog geen dag heeft staat onderaan. Open een regel om het bijbehorende onderdeel te bekijken en te bewerken.</p></div></div>
    {items.length === 0 && undated.length === 0 ? <p>Nog niets in de agenda. Voeg een verblijf, route of bezoek toe, dan verschijnt het hier.</p> : <div className="saved-records manager-list">{[...days].map(([day, entries]) => <article className="excerpt-row stacked" key={day}>
      <strong>{formatDayRange(day, null)}</strong>
      <ul className="agenda-day">{entries.map(row)}</ul>
    </article>)}{undated.length > 0 && <article className="excerpt-row stacked">
      <strong>Nog geen dag</strong>
      <ul className="agenda-day">{undated.map(row)}</ul>
    </article>}</div>}
  </section>;
}
