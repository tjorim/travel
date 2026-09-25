import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../auth-context";
import { EmptyState } from "../tracker-routes";
import { errorMessage } from "../query/api";
import { tripResourceQueryOptions, useMarkAlertRead, useOwner, useTripsQuery } from "../query/owner-queries";
import { addDays, daysBetween, formatDay, stayCoversNight, type Stay, type TransportLeg, type Trip, type TripTask, type TripTaskAlert } from "../tracker-model";

type TripSnapshot = { stays: Stay[]; legs: TransportLeg[]; tasks: TripTask[]; alerts: TripTaskAlert[] };

function today(): string {
  const parts = new Intl.DateTimeFormat("en", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === kind)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function tripState(trip: Trip, day: string): "active" | "upcoming" | "planned" | "past" {
  if (!trip.starts_on) return "planned";
  if (trip.starts_on <= day && (!trip.ends_on || trip.ends_on >= day)) return "active";
  return trip.starts_on > day ? "upcoming" : "past";
}

function nextAction(trip: Trip, snapshot: TripSnapshot): string {
  if (!trip.starts_on) return "Kies reisdata en een bestemming om te beginnen met plannen";
  const openTasks = snapshot.tasks.filter((task) => !task.completed_at).sort((left, right) => (left.due_date ?? "9999-12-31").localeCompare(right.due_date ?? "9999-12-31"));
  if (openTasks[0]) return openTasks[0].due_date ? `Taak: ${openTasks[0].title} · voor ${formatDay(openTasks[0].due_date)}` : `Taak: ${openTasks[0].title}`;

  if (trip.starts_on && trip.ends_on && trip.ends_on > trip.starts_on) {
    const nights = Array.from({ length: daysBetween(trip.starts_on, trip.ends_on) }, (_, index) => addDays(trip.starts_on!, index));
    const missing = nights.filter((night) => !snapshot.stays.some((stay) => stayCoversNight(stay, night))).length;
    if (missing) return `${missing} ${missing === 1 ? "nacht heeft" : "nachten hebben"} nog geen verblijf`;
  }

  const unbookedLeg = snapshot.legs.find((leg) => leg.status !== "cancelled" && leg.status !== "booked" && leg.status !== "confirmed");
  if (unbookedLeg) return "Vervoer moet nog geboekt of bevestigd worden";
  if (!trip.travel_updates.length) return "Leg een eerste reisupdate vast";
  return "Open je reisoverzicht";
}

function orderedTrips(trips: Trip[], day: string): Trip[] {
  const rank = { active: 0, upcoming: 1, planned: 2, past: 3 };
  return trips.slice().sort((left, right) => rank[tripState(left, day)] - rank[tripState(right, day)] || (left.starts_on ?? "9999-12-31").localeCompare(right.starts_on ?? "9999-12-31"));
}

export function OwnerHome() {
  const { session } = useAuth();
  const owner = useOwner();
  const tripsQuery = useTripsQuery();
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const resourceQueries = useQueries({
    queries: trips.flatMap((trip) => (["stays", "transport-legs", "trip-tasks", "task-alerts"] as const).map((resource) => tripResourceQueryOptions(owner, trip.id, resource))),
  });
  const markAlertRead = useMarkAlertRead();
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => { window.removeEventListener("online", updateConnection); window.removeEventListener("offline", updateConnection); };
  }, []);

  // Each trip owns four consecutive queries, in the order requested above.
  const snapshots = useMemo(() => Object.fromEntries(trips.map((trip, index): [string, TripSnapshot] => {
    const [stays, legs, tasks, alerts] = resourceQueries.slice(index * 4, index * 4 + 4).map((query) => query.data ?? []);
    return [trip.id, { stays: stays as Stay[], legs: legs as TransportLeg[], tasks: tasks as TripTask[], alerts: alerts as TripTaskAlert[] }];
  })), [trips, resourceQueries]);
  const partial = resourceQueries.some((query) => query.isError);

  const state: "loading" | "ready" | "error" = tripsQuery.data ? "ready" : !online || tripsQuery.isError ? "error" : "loading";
  const message = notice
    ?? (state === "error" ? (!online ? "Je bent offline. Maak opnieuw verbinding om je actuele reiswerkruimte te laden." : "Je reizen konden niet worden geladen. Controleer je verbinding en probeer opnieuw.")
      : state === "loading" ? "Je reiswerkruimte laden…"
      : partial ? "Een deel van je reisoverzicht kon niet worden geladen."
      : trips.length ? "" : "Nog geen reizen. Begin met een reis die privé blijft totdat jij anders kiest.");

  const day = today();
  const visibleTrips = useMemo(() => orderedTrips(trips, day).filter((trip) => tripState(trip, day) !== "past"), [trips, day]);
  const unreadAlerts = useMemo(() => trips.flatMap((trip) => (snapshots[trip.id]?.alerts ?? []).filter((alert) => !alert.read_at).map((alert) => ({ ...alert, trip }))), [snapshots, trips]);
  const recentUpdates = useMemo(() => trips.flatMap((trip) => trip.travel_updates.map((update) => ({ ...update, trip }))).sort((left, right) => right.occurred_at.localeCompare(left.occurred_at)).slice(0, 3), [trips]);

  if (!session) return <EmptyState title="Jouw reizen">Meld aan om je private reiswerkruimte te openen.</EmptyState>;
  if (state === "loading") return <section className="card" role="status"><h2>Jouw reizen</h2><p>{message}</p></section>;
  if (state === "error") return <section className="card" role="alert"><h2>Je reiswerkruimte is niet beschikbaar</h2><p>{message}</p><button type="button" onClick={() => window.location.reload()}>Opnieuw proberen</button></section>;

  return <main className="owner-home" aria-labelledby="owner-home-title">
    <header className="capture-heading"><div><p className="eyebrow">Private reiswerkruimte</p><h1 id="owner-home-title">Waar wil je verder?</h1><p className="lede">Je reizen, aandachtspunten en herinneringen op één rustige plek.</p></div><div className="button-row"><a className="secondary action-link" href="/">Publieke reizen bekijken</a><NavLink className="action-link" to="/trips?new=1">Nieuwe reis</NavLink></div></header>
    {!online && <p className="connection offline" role="status">Je bent offline. De getoonde gegevens kunnen verouderd zijn.</p>}
    {unreadAlerts.length > 0 && <section className="card owner-inbox" aria-labelledby="inbox-title"><h2 id="inbox-title">Inbox</h2><p>{unreadAlerts.length} {unreadAlerts.length === 1 ? "nieuwe herinnering" : "nieuwe herinneringen"}</p><div className="saved-moments">{unreadAlerts.map((alert) => <article className="excerpt-row" key={alert.id}><div><strong>{alert.title}</strong><span>{alert.trip.title} · gepland voor {new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(alert.scheduled_for))}</span></div><button className="secondary compact" type="button" onClick={() => markAlertRead.mutateAsync({ tripId: alert.trip.id, alertId: alert.id }).catch((error: unknown) => setNotice(errorMessage(error, "De melding kon niet worden bijgewerkt.")))}>Gelezen</button></article>)}</div></section>}
    <section aria-labelledby="trip-list-title"><div className="section-heading"><h2 id="trip-list-title">Nu en binnenkort</h2><NavLink to="/trips">Alle reizen beheren</NavLink></div>{visibleTrips.length ? <div className="owner-trip-cards">{visibleTrips.map((trip) => { const snapshot = snapshots[trip.id] ?? { stays: [], legs: [], tasks: [], alerts: [] }; const status = tripState(trip, day); return <article className="card owner-trip-card" key={trip.id}><p className="eyebrow">{status === "active" ? "Nu op reis" : status === "upcoming" ? "Binnenkort" : "Nog plannen"}</p><h3>{trip.title}</h3>{trip.starts_on ? <p>{formatDay(trip.starts_on, { day: "numeric", month: "long", year: "numeric" })}{trip.ends_on ? ` — ${formatDay(trip.ends_on, { day: "numeric", month: "long", year: "numeric" })}` : ""}</p> : <p>Kies reisdata wanneer je klaar bent om te plannen.</p>}<p className="next-action"><strong>Volgende stap</strong>{nextAction(trip, snapshot)}</p><NavLink className="action-link" to={`/trips/${encodeURIComponent(trip.id)}`}>Open reis</NavLink></article>; })}</div> : <section className="card"><h3>{trips.length ? "Geen actieve of komende reizen" : "Begin met je eerste reis"}</h3><p>{trips.length ? "Eerdere reizen blijven beschikbaar via beheren." : message}</p><NavLink className="action-link" to="/trips?new=1">Nieuwe reis</NavLink></section>}</section>
    {recentUpdates.length > 0 && <section className="card owner-activity" aria-labelledby="activity-title"><h2 id="activity-title">Recent vastgelegd</h2><div className="saved-moments">{recentUpdates.map((update) => <NavLink className="activity-row" key={update.id} to={`/trips/${encodeURIComponent(update.trip.id)}`}><strong>{update.title}</strong><span>{update.trip.title} · {new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(update.occurred_at))}</span></NavLink>)}</div></section>}
    {message && <p className="help" role="status">{message}</p>}
  </main>;
}
