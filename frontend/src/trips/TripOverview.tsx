import { useEffect, useMemo, useState } from "react";

import { useTripResource } from "../query/owner-queries";
import { addDays, browserTimeZone, daysBetween, formatDay, offsetLabel, stayCoversNight, utcOffsetMinutes, whereabouts, type Stay, type TransportLeg, type Trip, type TripTask } from "../tracker-model";

type Badge = { label: string; value: string; done: boolean };

const isBooked = (status: Stay["status"] | TransportLeg["status"]) => status === "booked" || status === "confirmed";

/** The archive header's booking badges, derived live from the owner's records. */
export function tripBadges(trip: Pick<Trip, "starts_on" | "ends_on">, stays: Stay[], legs: TransportLeg[], tasks: TripTask[]): Badge[] {
  const badges: Badge[] = [];
  const activeLegs = legs.filter((leg) => leg.status !== "cancelled");
  if (activeLegs.length) {
    const booked = activeLegs.filter((leg) => isBooked(leg.status)).length;
    badges.push({ label: "Vervoer", value: booked === activeLegs.length ? "geboekt" : `${booked}/${activeLegs.length} geboekt`, done: booked === activeLegs.length });
  }
  if (trip.starts_on && trip.ends_on && trip.ends_on > trip.starts_on) {
    const nights = Array.from({ length: daysBetween(trip.starts_on, trip.ends_on) }, (_, index) => addDays(trip.starts_on!, index));
    const booked = nights.filter((night) => stays.some((stay) => isBooked(stay.status) && stayCoversNight(stay, night))).length;
    const missing = nights.filter((night) => !stays.some((stay) => stayCoversNight(stay, night))).length;
    badges.push({ label: "Nachten", value: `${booked}/${nights.length} geboekt${missing ? ` · ${missing} zonder verblijf` : ""}`, done: booked === nights.length });
  } else if (stays.some((stay) => stay.status !== "cancelled")) {
    const active = stays.filter((stay) => stay.status !== "cancelled");
    const booked = active.filter((stay) => isBooked(stay.status)).length;
    badges.push({ label: "Verblijven", value: `${booked}/${active.length} geboekt`, done: booked === active.length });
  }
  const open = tasks.filter((task) => !task.completed_at).length;
  if (tasks.length) badges.push({ label: "Nog te regelen", value: open ? `${open} open` : "alles gedaan", done: open === 0 });
  return badges;
}

/** The trip's destination zone and when to evaluate it: the first stay with
 * a zone, else the first flight's arrival zone. */
export function tripZone(trip: Pick<Trip, "starts_on">, stays: Stay[], legs: TransportLeg[]): { zone: string; at: string } | null {
  const stay = stays.filter((item) => item.status !== "cancelled" && item.broad_place?.timezone).sort((left, right) => left.check_in_date.localeCompare(right.check_in_date))[0];
  if (stay) return { zone: stay.broad_place!.timezone!, at: `${stay.check_in_date}T12:00:00Z` };
  const leg = legs.filter((item) => item.status !== "cancelled" && item.arrival_timezone).sort((left, right) => left.arrives_at.localeCompare(right.arrives_at))[0];
  if (leg) return { zone: leg.arrival_timezone!, at: leg.arrives_at };
  return null;
}

/** "Nu in Linkou: 21:15 · 7 u later dan hier" during the trip, and the
 * difference at the trip's own dates (daylight saving can change it). */
export function LocalTimes({ trip, stays, legs, now, homeZone = browserTimeZone() }: { trip: Pick<Trip, "starts_on">; stays: Stay[]; legs: TransportLeg[]; now: Date; homeZone?: string }) {
  const instant = now.toISOString();
  const here = whereabouts(instant, stays, legs, homeZone);
  const destination = tripZone(trip, stays, legs);
  const nowOffset = (zone: string) => utcOffsetMinutes(instant, zone) - utcOffsetMinutes(instant, homeZone);
  const lines: string[] = [];
  if (here.kind !== "home" && here.zone) {
    const time = new Intl.DateTimeFormat("nl-BE", { timeZone: here.zone, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(now);
    lines.push(`Nu ${here.kind === "stay" ? `in ${here.label}` : here.label}: ${time} · ${offsetLabel(nowOffset(here.zone))}`);
  }
  if (destination) {
    const during = utcOffsetMinutes(destination.at, destination.zone) - utcOffsetMinutes(destination.at, homeZone);
    const current = nowOffset(destination.zone);
    if (here.kind === "home") lines.push(`Tijdens de reis: ${offsetLabel(during)}${current !== during ? ` (nu ${offsetLabel(current).replace(" dan hier", "")})` : ""}`);
  }
  if (!lines.length) return null;
  return <p className="local-times" aria-live="polite">{lines.map((line) => <span key={line}>{line}</span>)}</p>;
}

export function TripOverview({ trip }: { trip: Trip }) {
  const staysQuery = useTripResource(trip.id, "stays");
  const legsQuery = useTripResource(trip.id, "transport-legs");
  const tasksQuery = useTripResource(trip.id, "trip-tasks");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const stays = staysQuery.data ?? [];
  const legs = legsQuery.data ?? [];
  // The badges need all three records; one failed read shows none rather than a misleading partial count.
  const badges = useMemo(() => staysQuery.data && legsQuery.data && tasksQuery.data ? tripBadges(trip, staysQuery.data, legsQuery.data, tasksQuery.data) : [], [trip, staysQuery.data, legsQuery.data, tasksQuery.data]);

  const nights = trip.starts_on && trip.ends_on ? daysBetween(trip.starts_on, trip.ends_on) : null;
  const localTimes = <LocalTimes trip={trip} stays={stays} legs={legs} now={now} />;
  if (!trip.starts_on && !badges.length && !stays.length && !legs.length) return null;
  return <section className="card trip-overview" aria-label="Reisoverzicht">
    {trip.starts_on && <p className="eyebrow">{formatDay(trip.starts_on, { day: "numeric", month: "long" })}{trip.ends_on ? ` — ${formatDay(trip.ends_on, { day: "numeric", month: "long", year: "numeric" })}` : ""}{nights ? ` · ${nights} ${nights === 1 ? "nacht" : "nachten"}` : ""}</p>}
    {localTimes}
    {badges.length > 0 && <ul className="status-badges">{badges.map((badge) => <li key={badge.label} className={badge.done ? "done" : "open"}><span>{badge.label}</span> <strong>{badge.value}</strong></li>)}</ul>}
  </section>;
}
