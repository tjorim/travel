import { Link } from "@tanstack/react-router";
import { buildAgendaItems } from "./AgendaView";
import { isOverdue, tripDay, tripProgress } from "./readiness";
import { sectionPath } from "./workspace-sections";
import { Badge as StatusBadge } from "@/ui/badge";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useEffect, useMemo, useState } from "react";

import { dayjs } from "../dayjs";
import { useTripResource } from "../query/owner-queries";
import {
  addDays,
  browserTimeZone,
  daysBetween,
  formatDay,
  offsetLabel,
  routeInPlan,
  stayCoversNight,
  stayInPlan,
  utcOffsetMinutes,
  whereabouts,
  type Stay,
  timedRoutes,
  type Route,
  type Trip,
  type TripTask,
} from "../tracker-model";

/** Where a badge leads: the owner section and block holding the records it counts. */
type Badge = {
  label: string;
  value: string;
  done: boolean;
  section: "plan" | "prepare";
  hash: "routes" | "stays" | "tasks";
};

const isConfirmed = (status: Stay["status"] | Route["status"]) => status === "confirmed";

/** The archive header's booking badges, derived live from the owner's records. */
export function tripBadges(
  trip: Pick<Trip, "starts_on" | "ends_on">,
  stays: Stay[],
  routes: Route[],
  tasks: TripTask[],
): Badge[] {
  const badges: Badge[] = [];
  // Only scheduled routes are bookings; a drawn line between two areas is not.
  const activeRoutes = routes.filter((route) => route.departs_on && routeInPlan(route));
  if (activeRoutes.length) {
    const booked = activeRoutes.filter((route) => isConfirmed(route.status)).length;
    badges.push({
      label: m.owner_transport(),
      value:
        booked === activeRoutes.length
          ? m.owner_all_confirmed()
          : m.owner_confirmed_count({ p0: booked, p1: activeRoutes.length }),
      done: booked === activeRoutes.length,
      section: "plan",
      hash: "routes",
    });
  }
  if (trip.starts_on && trip.ends_on && trip.ends_on > trip.starts_on) {
    const nights = Array.from({ length: daysBetween(trip.starts_on, trip.ends_on) }, (_, index) =>
      addDays(trip.starts_on!, index),
    );
    const booked = nights.filter((night) =>
      stays.some((stay) => isConfirmed(stay.status) && stayCoversNight(stay, night)),
    ).length;
    const missing = nights.filter(
      (night) => !stays.some((stay) => stayCoversNight(stay, night)),
    ).length;
    badges.push({
      label: m.owner_nights(),
      value: m.owner_confirmed_nights({
        p0: booked,
        p1: nights.length,
        p2: missing ? m.owner_without_a_stay({ p0: missing }) : "",
      }),
      done: booked === nights.length,
      section: "plan",
      hash: "stays",
    });
  } else if (stays.some(stayInPlan)) {
    const active = stays.filter(stayInPlan);
    const booked = active.filter((stay) => isConfirmed(stay.status)).length;
    badges.push({
      label: m.owner_stays(),
      value: m.owner_confirmed_count({ p0: booked, p1: active.length }),
      done: booked === active.length,
      section: "plan",
      hash: "stays",
    });
  }
  const open = tasks.filter((task) => !task.completed_at).length;
  if (tasks.length)
    badges.push({
      label: m.owner_things_to_arrange(),
      value: open ? m.owner_open_2({ p0: open }) : m.owner_all_done(),
      done: open === 0,
      section: "prepare",
      hash: "tasks",
    });
  return badges;
}

/** The trip's destination zone and when to evaluate it: the first stay with
 * a zone, else the first flight's arrival zone. */
export function tripZone(
  trip: Pick<Trip, "starts_on">,
  stays: Stay[],
  routes: Route[],
): { zone: string; at: string } | null {
  const stay = stays
    .filter((item) => stayInPlan(item) && item.area.timezone)
    .sort((left, right) => left.check_in_date.localeCompare(right.check_in_date))[0];
  if (stay) return { zone: stay.area.timezone!, at: `${stay.check_in_date}T12:00:00Z` };
  const route = timedRoutes(routes)
    .filter((item) => routeInPlan(item) && item.arrival_timezone)
    .sort((left, right) => left.arrives_at.localeCompare(right.arrives_at))[0];
  if (route) return { zone: route.arrival_timezone!, at: route.arrives_at };
  return null;
}

/** "Nu in Voorbeeldstad: 21:15 · 7 u later dan hier" during the trip, and the
 * difference at the trip's own dates (daylight saving can change it). */
export function LocalTimes({
  trip,
  stays,
  routes,
  now,
  homeZone = browserTimeZone(),
}: {
  trip: Pick<Trip, "starts_on">;
  stays: Stay[];
  routes: Route[];
  now: Date;
  homeZone?: string;
}) {
  useLocale();
  const instant = now.toISOString();
  const here = whereabouts(instant, stays, routes, homeZone);
  const destination = tripZone(trip, stays, routes);
  const nowOffset = (zone: string) =>
    utcOffsetMinutes(instant, zone) - utcOffsetMinutes(instant, homeZone);
  const lines: string[] = [];
  if (here.kind !== "home" && here.zone) {
    const time = dayjs(now).tz(here.zone).format("ddd HH:mm");
    lines.push(
      m.owner_now({
        p0: here.kind === "stay" ? m.owner_in({ p0: here.label }) : here.label,
        p1: time,
        p2: offsetLabel(nowOffset(here.zone)),
      }),
    );
  }
  if (destination) {
    const during =
      utcOffsetMinutes(destination.at, destination.zone) -
      utcOffsetMinutes(destination.at, homeZone);
    const current = nowOffset(destination.zone);
    if (here.kind === "home")
      lines.push(
        current !== during
          ? m.owner_trip_offset_now({
              during: offsetLabel(during),
              current: offsetLabel(current, true),
            })
          : m.owner_during_the_trip({ p0: offsetLabel(during), p1: "" }),
      );
  }
  if (!lines.length) return null;
  return (
    <p
      className="m-0 grid gap-0.5 text-travel-muted [&_span:first-child]:font-bold [&_span:first-child]:text-travel-ink"
      aria-live="polite"
    >
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </p>
  );
}

export function TripOverview({ trip }: { trip: Trip }) {
  const locale = useLocale();
  const staysQuery = useTripResource(trip.id, "stays");
  const routesQuery = useTripResource(trip.id, "routes");
  const visitsQuery = useTripResource(trip.id, "visits");
  const tasksQuery = useTripResource(trip.id, "trip-tasks");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const stays = staysQuery.data ?? [];
  const routes = routesQuery.data ?? [];
  // The badges need all three records; one failed read shows none rather than a misleading partial count.
  const badges = useMemo(
    () =>
      staysQuery.data && routesQuery.data && tasksQuery.data
        ? tripBadges(trip, staysQuery.data, routesQuery.data, tasksQuery.data)
        : [],
    [locale, trip, staysQuery.data, routesQuery.data, tasksQuery.data],
  );

  const today = tripDay(now, stays, routes);
  const progress = tripProgress(trip.starts_on, trip.ends_on, today);
  const overdue = (tasksQuery.data ?? []).filter((task) => isOverdue(task, today)).length;
  const agenda = buildAgendaItems(stays, routes, visitsQuery.data ?? []);
  const nights = trip.starts_on && trip.ends_on ? daysBetween(trip.starts_on, trip.ends_on) : null;
  const localTimes = <LocalTimes trip={trip} stays={stays} routes={routes} now={now} />;
  if (!trip.starts_on && !badges.length && !stays.length && !routes.length) return null;
  return (
    <section
      className="travel-card grid gap-2.5 [&_.travel-eyebrow]:m-0"
      aria-label={m.owner_trip_overview()}
    >
      {progress && (
        <strong>
          {progress.kind === "before"
            ? m.readiness_departure({ count: progress.days })
            : progress.kind === "finished"
              ? m.readiness_finished()
              : progress.total
                ? m.readiness_underway({ day: progress.day, total: progress.total })
                : m.readiness_day({ day: progress.day })}
        </strong>
      )}
      {overdue > 0 && (
        <p className="m-0">
          <Link className="secondary action-link" to={sectionPath(trip.id, "prepare")} hash="tasks">
            {m.readiness_overdue({ count: overdue })}
          </Link>
        </p>
      )}
      {trip.starts_on && (
        <p className="travel-eyebrow">
          {formatDay(trip.starts_on, "D MMMM")}
          {trip.ends_on ? ` — ${formatDay(trip.ends_on, "D MMMM YYYY")}` : ""}
          {nights ? ` · ${m.owner_night_count({ count: nights })}` : ""}
        </p>
      )}
      {localTimes}
      {progress?.kind === "underway" && visitsQuery.data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[today, addDays(today, 1)].map((date, index) => {
            const entries = agenda.filter(
              (item) => item.first <= date && (item.last ?? item.first) >= date,
            );
            return (
              <section key={date}>
                <h3 className="m-0 text-base">
                  {index === 0 ? m.readiness_today() : m.readiness_tomorrow()}
                </h3>
                {entries.length ? (
                  <ul className="m-0 grid gap-1 pl-5">
                    {entries.map((item) => (
                      <li key={item.id}>
                        {item.time && <time>{item.time} </time>}
                        {item.kind}: {item.title}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-travel-muted">{m.readiness_empty()}</p>
                )}
              </section>
            );
          })}
        </div>
      )}
      {badges.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {badges.map((badge) => (
            <StatusBadge key={badge.label} render={<li />}>
              <Link
                className="inline-flex items-center gap-1 text-inherit no-underline hover:underline focus-visible:underline"
                to={sectionPath(trip.id, badge.section)}
                hash={badge.hash}
              >
                <span
                  aria-hidden="true"
                  className={
                    badge.done
                      ? "size-2 rounded-full bg-travel-link"
                      : "size-2 rounded-full bg-travel-status-pending"
                  }
                />
                <span className="shrink-0">{badge.label}</span>{" "}
                <strong className="text-travel-ink">{badge.value}</strong>
              </Link>
            </StatusBadge>
          ))}
        </ul>
      )}
    </section>
  );
}
