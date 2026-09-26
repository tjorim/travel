import { useMemo } from "react";

import { useTripResource } from "../query/owner-queries";
import { addDays, formatDayRange, localDate, routeTitle, stayLabel, visitTitle, wallClock, type Trip } from "../tracker-model";

type AgendaItem = { id: string; kind: string; title: string; first: string; last: string | null; time: string | null; where: string };

/** Everything on the trip that has a day, in order: read-only, since each item is edited in its own section. */
export function AgendaView({ trip }: { trip: Trip }) {
  const staysQuery = useTripResource(trip.id, "stays");
  const routesQuery = useTripResource(trip.id, "routes");
  const visitsQuery = useTripResource(trip.id, "visits");

  const items = useMemo<AgendaItem[]>(() => [
    ...(staysQuery.data ?? []).map((stay): AgendaItem => ({ id: `stay-${stay.id}`, kind: "Verblijf", title: stayLabel(stay), first: stay.check_in_date, last: addDays(stay.check_out_date, -1), time: stay.check_in_time?.slice(0, 5) ?? null, where: stay.area.label })),
    ...(routesQuery.data ?? []).flatMap((route): AgendaItem[] => route.departs_at ? [{
      id: `route-${route.id}`, kind: "Route", title: routeTitle(route), first: localDate(route.departs_at, route.departure_timezone), last: route.arrives_at ? localDate(route.arrives_at, route.arrival_timezone) : null,
      time: wallClock(route.departs_at, route.departure_timezone).slice(11, 16), where: route.departure_area.label,
    }] : []),
    ...(visitsQuery.data ?? []).flatMap((visit): AgendaItem[] => visit.starts_on ? [{
      id: `visit-${visit.id}`, kind: "Bezoek", title: visitTitle(visit), first: visit.starts_on, last: visit.ends_on, time: visit.start_time?.slice(0, 5) ?? null, where: visit.area.label,
    }] : []),
  ].sort((left, right) => left.first.localeCompare(right.first) || (left.time ?? "99:99").localeCompare(right.time ?? "99:99") || left.id.localeCompare(right.id)), [staysQuery.data, routesQuery.data, visitsQuery.data]);

  const days = items.reduce((map, item) => map.set(item.first, [...(map.get(item.first) ?? []), item]), new Map<string, AgendaItem[]>());
  const undated = (visitsQuery.data ?? []).filter((visit) => !visit.starts_on).length;

  return <section className="card manager" aria-labelledby="agenda-title">
    <div className="capture-heading"><div><h3 id="agenda-title">Agenda</h3><p>Alles met een dag, op volgorde. Je bewerkt het in het onderdeel zelf; hier lees je alleen.</p></div></div>
    {items.length === 0 ? <p>Nog niets met een dag. Geef een verblijf, route of bezoek een datum, dan verschijnt het hier.</p> : <div className="saved-records manager-list">{[...days].map(([day, entries]) => <article className="excerpt-row stacked" key={day}>
      <strong>{formatDayRange(day, null)}</strong>
      <ul className="agenda-day">{entries.map((item) => <li key={item.id}>{item.time && <time>{item.time}</time>} <span>{item.kind}: {item.title}</span> <small>{item.last && item.last !== item.first ? `${formatDayRange(item.first, item.last)} · ` : ""}{item.where}</small></li>)}</ul>
    </article>)}</div>}
    {undated > 0 && <p className="help">{undated} {undated === 1 ? "bezoek heeft" : "bezoeken hebben"} nog geen dag en staat niet in de agenda.</p>}
  </section>;
}
