import { useEffect, useState } from "react";

import { useAuth } from "../auth-context";
import { addDays, apiHeaders, daysBetween, formatDay, stayCoversNight, type Stay, type TransportLeg, type Trip, type TripTask } from "../tracker-model";

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

export function TripOverview({ trip, revision }: { trip: Trip; revision: number }) {
  const { session } = useAuth();
  const [badges, setBadges] = useState<Badge[]>([]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const headers = apiHeaders(session);
    void Promise.all(["stays", "transport-legs", "trip-tasks"].map((path) => fetch(`/api/trips/${trip.id}/${path}`, { headers, signal: controller.signal })))
      .then(async (responses) => {
        if (responses.some((response) => !response.ok)) throw new Error("overview");
        const [stays, legs, tasks] = await Promise.all(responses.map((response) => response.json())) as [Stay[], TransportLeg[], TripTask[]];
        if (!controller.signal.aborted) setBadges(tripBadges(trip, stays, legs, tasks));
      })
      .catch(() => { if (!controller.signal.aborted) setBadges([]); });
    return () => controller.abort();
  }, [session, trip, revision]);

  const nights = trip.starts_on && trip.ends_on ? daysBetween(trip.starts_on, trip.ends_on) : null;
  if (!trip.starts_on && !badges.length) return null;
  return <section className="card trip-overview" aria-label="Reisoverzicht">
    {trip.starts_on && <p className="eyebrow">{formatDay(trip.starts_on, { day: "numeric", month: "long" })}{trip.ends_on ? ` — ${formatDay(trip.ends_on, { day: "numeric", month: "long", year: "numeric" })}` : ""}{nights ? ` · ${nights} ${nights === 1 ? "nacht" : "nachten"}` : ""}</p>}
    {badges.length > 0 && <ul className="status-badges">{badges.map((badge) => <li key={badge.label} className={badge.done ? "done" : "open"}><span>{badge.label}</span> <strong>{badge.value}</strong></li>)}</ul>}
  </section>;
}
