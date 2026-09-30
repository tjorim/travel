import { errorNotice, useFeedback } from "../query/feedback";
import { m } from "../paraglide/messages.js";
import { useLocale } from "../locale";
import { Button } from "@base-ui/react/button";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

import { useAuth } from "../auth-context";
import { dayjs } from "../dayjs";
import { EmptyState } from "../tracker-routes";

import { errorMessage } from "../query/api";
import { tripResourceQueryOptions, useMarkAlertRead, useOwner, useTripsQuery } from "../query/owner-queries";
import {
  addDays,
  daysBetween,
  formatDay,
  formatInstant,
  stayCoversNight,
  type Stay,
  type Route,
  type Trip,
  type TripTask,
  type TripTaskAlert,
} from "../tracker-model";

type TripSnapshot = { stays: Stay[]; routes: Route[]; tasks: TripTask[]; alerts: TripTaskAlert[] };

function today(): string {
  return dayjs().format("YYYY-MM-DD");
}

function tripState(trip: Trip, day: string): "active" | "upcoming" | "planned" | "past" {
  if (!trip.starts_on) return "planned";
  if (trip.starts_on <= day && (!trip.ends_on || trip.ends_on >= day)) return "active";
  return trip.starts_on > day ? "upcoming" : "past";
}

function nextAction(trip: Trip, snapshot: TripSnapshot): string {
  if (!trip.starts_on) return "Kies reisdata en een bestemming om te beginnen met plannen";
  const openTasks = snapshot.tasks
    .filter((task) => !task.completed_at)
    .sort((left, right) => (left.due_date ?? "9999-12-31").localeCompare(right.due_date ?? "9999-12-31"));
  if (openTasks[0])
    return openTasks[0].due_date
      ? `Taak: ${openTasks[0].title} · voor ${formatDay(openTasks[0].due_date)}`
      : `Taak: ${openTasks[0].title}`;

  if (trip.starts_on && trip.ends_on && trip.ends_on > trip.starts_on) {
    const nights = Array.from({ length: daysBetween(trip.starts_on, trip.ends_on) }, (_, index) =>
      addDays(trip.starts_on!, index),
    );
    const missing = nights.filter((night) => !snapshot.stays.some((stay) => stayCoversNight(stay, night))).length;
    if (missing) return `${missing} ${missing === 1 ? "nacht heeft" : "nachten hebben"} nog geen verblijf`;
  }

  const unbookedRoute = snapshot.routes.find(
    (route) => route.status !== "cancelled" && route.status !== "booked" && route.status !== "confirmed",
  );
  if (unbookedRoute) return "Vervoer moet nog geboekt of bevestigd worden";
  if (!trip.travel_updates.length) return "Leg een eerste reisupdate vast";
  return "Open je reisoverzicht";
}

function orderedTrips(trips: Trip[], day: string): Trip[] {
  const rank = { active: 0, upcoming: 1, planned: 2, past: 3 };
  return trips
    .slice()
    .sort(
      (left, right) =>
        rank[tripState(left, day)] - rank[tripState(right, day)] ||
        (left.starts_on ?? "9999-12-31").localeCompare(right.starts_on ?? "9999-12-31"),
    );
}

export function OwnerHome() {
  useLocale();
  const { session } = useAuth();
  const owner = useOwner();
  const tripsQuery = useTripsQuery();
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const resourceQueries = useQueries({
    queries: trips.flatMap((trip) =>
      (["stays", "routes", "trip-tasks", "task-alerts"] as const).map((resource) =>
        tripResourceQueryOptions(owner, trip.id, resource),
      ),
    ),
  });
  const markAlertRead = useMarkAlertRead();
  const [notice, setNotice] = useFeedback<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  // Each trip owns four consecutive queries, in the order requested above.
  const snapshots = useMemo(
    () =>
      Object.fromEntries(
        trips.map((trip, index): [string, TripSnapshot] => {
          const [stays, routes, tasks, alerts] = resourceQueries
            .slice(index * 4, index * 4 + 4)
            .map((query) => query.data ?? []);
          return [
            trip.id,
            {
              stays: stays as Stay[],
              routes: routes as Route[],
              tasks: tasks as TripTask[],
              alerts: alerts as TripTaskAlert[],
            },
          ];
        }),
      ),
    [trips, resourceQueries],
  );
  const partial = resourceQueries.some((query) => query.isError);

  const state: "loading" | "ready" | "error" = tripsQuery.data
    ? "ready"
    : !online || tripsQuery.isError
      ? "error"
      : "loading";
  const message =
    notice ??
    (state === "error"
      ? !online
        ? m.owner_offline()
        : errorMessage(tripsQuery.error, m.owner_load_error)
      : state === "loading"
        ? m.workspace_loading()
        : partial
          ? m.workspace_partial()
          : trips.length
            ? ""
            : m.owner_no_trips());

  const day = today();
  const visibleTrips = useMemo(
    () => orderedTrips(trips, day).filter((trip) => tripState(trip, day) !== "past"),
    [trips, day],
  );
  const unreadAlerts = useMemo(
    () =>
      trips.flatMap((trip) =>
        (snapshots[trip.id]?.alerts ?? []).filter((alert) => !alert.read_at).map((alert) => ({ ...alert, trip })),
      ),
    [snapshots, trips],
  );
  const recentUpdates = useMemo(
    () =>
      trips
        .flatMap((trip) => trip.travel_updates.map((update) => ({ ...update, trip })))
        .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
        .slice(0, 3),
    [trips],
  );

  if (!session) return <EmptyState title={m.your_trips()}>{m.sign_in_workspace()}</EmptyState>;
  if (state === "loading")
    return (
      <section className="travel-card" role="status">
        <h2>{m.your_trips()}</h2>
        <p>{message}</p>
      </section>
    );
  if (state === "error")
    return (
      <section className="travel-card" role="alert">
        <h2>Je reiswerkruimte is niet beschikbaar</h2>
        <p>{message}</p>
        <Button type="button" onClick={() => window.location.reload()}>
          Opnieuw proberen
        </Button>
      </section>
    );

  return (
    <main className="grid gap-6.5" aria-labelledby="owner-home-title">
      <header className="capture-heading">
        <div>
          <p className="travel-eyebrow">Private reiswerkruimte</p>
          <h1 className="max-w-travel-home-title" id="owner-home-title">
            Waar wil je verder?
          </h1>
          <p className="max-w-145 leading-relaxed text-travel-muted">
            Je reizen, aandachtspunten en herinneringen op één rustige plek.
          </p>
        </div>
        <div className="button-row">
          <a className="secondary action-link" href="/">
            Publieke reizen bekijken
          </a>
          <Link className="action-link" to="/trips" search={{ new: "1" }}>
            Nieuwe reis
          </Link>
        </div>
      </header>
      {!online && (
        <p className="connection offline" role="status">
          Je bent offline. De getoonde gegevens kunnen verouderd zijn.
        </p>
      )}
      {unreadAlerts.length > 0 && (
        <section className="travel-card" aria-labelledby="inbox-title">
          <h2 className="m-0" id="inbox-title">
            Inbox
          </h2>
          <p>
            {unreadAlerts.length} {unreadAlerts.length === 1 ? "nieuwe herinnering" : "nieuwe herinneringen"}
          </p>
          <div className="saved-records">
            {unreadAlerts.map((alert) => (
              <article className="excerpt-row" key={alert.id}>
                <div>
                  <strong>{alert.title}</strong>
                  <span>
                    {alert.trip.title} · gepland voor {formatInstant(alert.scheduled_for)}
                  </span>
                </div>
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() =>
                    markAlertRead
                      .mutateAsync({ tripId: alert.trip.id, alertId: alert.id })
                      .catch((error: unknown) =>
                        setNotice(errorNotice(error, "De melding kon niet worden bijgewerkt.")),
                      )
                  }
                >
                  Gelezen
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby="trip-list-title">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="m-0" id="trip-list-title">
            Nu en binnenkort
          </h2>
          <Link className="font-bold text-travel-forest" to="/trips">
            Alle reizen beheren
          </Link>
        </div>
        {visibleTrips.length ? (
          <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 min-[900px]:grid-cols-3">
            {visibleTrips.map((trip) => {
              const snapshot = snapshots[trip.id] ?? { stays: [], routes: [], tasks: [], alerts: [] };
              const status = tripState(trip, day);
              return (
                <article className="travel-card flex flex-col gap-3 [&_h3]:m-0 [&_p]:m-0" key={trip.id}>
                  <p className="travel-eyebrow">
                    {status === "active" ? "Nu op reis" : status === "upcoming" ? "Binnenkort" : "Nog plannen"}
                  </p>
                  <h3>{trip.title}</h3>
                  {trip.starts_on ? (
                    <p>
                      {formatDay(trip.starts_on, "D MMMM YYYY")}
                      {trip.ends_on ? ` — ${formatDay(trip.ends_on, "D MMMM YYYY")}` : ""}
                    </p>
                  ) : (
                    <p>Kies reisdata wanneer je klaar bent om te plannen.</p>
                  )}
                  <p className="grid gap-0.75 rounded-travel-media bg-travel-tint px-3 py-2.75 text-sm text-travel-positive! [&_strong]:text-travel-ink">
                    <strong>Volgende stap</strong>
                    {nextAction(trip, snapshot)}
                  </p>
                  <Link className="action-link mt-auto w-fit" to={`/trips/${encodeURIComponent(trip.id)}`}>
                    Open reis
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <section className="travel-card">
            <h3>{trips.length ? "Geen actieve of komende reizen" : "Begin met je eerste reis"}</h3>
            <p>{trips.length ? "Eerdere reizen blijven beschikbaar via beheren." : message}</p>
            <Link className="action-link" to="/trips" search={{ new: "1" }}>
              Nieuwe reis
            </Link>
          </section>
        )}
      </section>
      {recentUpdates.length > 0 && (
        <section className="travel-card grid gap-3.5" aria-labelledby="activity-title">
          <h2 className="m-0" id="activity-title">
            Recent vastgelegd
          </h2>
          <div className="saved-records">
            {recentUpdates.map((update) => (
              <Link
                className="grid gap-1 rounded-travel-media border border-travel-divider p-3 text-travel-ink no-underline hover:border-travel-forest hover:bg-travel-hover [&_span]:text-sm [&_span]:text-travel-muted"
                key={update.id}
                to={`/trips/${encodeURIComponent(update.trip.id)}`}
              >
                <strong>{update.title}</strong>
                <span>
                  {update.trip.title} · {formatInstant(update.occurred_at)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {message && (
        <p className="help" role="status">
          {message}
        </p>
      )}
    </main>
  );
}
