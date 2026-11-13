import type { Route, Stay } from "./api-types";
import { addDays, wallClock } from "./dates";
import { m } from "./paraglide/messages.js";
import { areaName, routeInPlan, stayCoversNight, stayInPlan, timedRoutes } from "./records";

export type Whereabouts = {
  kind: "travel" | "stay" | "between" | "home";
  zone: string | null;
  label: string;
};

const stayZone = (stay: Stay) => stay.area.timezone ?? null;

/** The night an owner is in at an instant, local to a zone: before noon the
 * previous evening's stay still applies (check-out is in the morning). */
function effectiveNight(instant: string, zone: string): string {
  const wall = wallClock(instant, zone);
  return Number(wall.slice(11, 13)) < 12 ? addDays(wall.slice(0, 10), -1) : wall.slice(0, 10);
}

/** Where the plan puts the owner at ``instant``: at home outside the trip
 * (first departure or check-in to last arrival or check-out), otherwise
 * travelling, at a stay, or between stays in the last known zone. */
export function whereabouts(
  instant: string,
  stays: Stay[],
  routes: Route[],
  homeZone: string,
): Whereabouts {
  const now = Date.parse(instant);
  const active = timedRoutes(routes).filter(routeInPlan);
  const zoned = stays.filter((stay) => stayInPlan(stay) && stayZone(stay));
  const midday = (isoDate: string) => Date.parse(`${isoDate}T12:00:00Z`);
  const bounds = [
    ...active.flatMap((route) => [Date.parse(route.departs_at), Date.parse(route.arrives_at)]),
    ...zoned.flatMap((stay) => [midday(stay.check_in_date), midday(stay.check_out_date)]),
  ];
  const home: Whereabouts = { kind: "home", zone: homeZone, label: m.owner_home() };
  if (!bounds.length || now < Math.min(...bounds) || now >= Math.max(...bounds)) return home;
  const route = active.find(
    (candidate) =>
      Date.parse(candidate.departs_at) <= now && now < Date.parse(candidate.arrives_at),
  );
  if (route)
    return {
      kind: "travel",
      zone: route.arrival_timezone,
      label: m.owner_on_the_way_to({ p0: areaName(route.arrival_area) }),
    };
  const current = zoned.find((stay) =>
    stayCoversNight(stay, effectiveNight(instant, stayZone(stay)!)),
  );
  if (current) return { kind: "stay", zone: stayZone(current), label: areaName(current.area) };
  const last = [
    ...active
      .filter((candidate) => Date.parse(candidate.arrives_at) <= now)
      .map((candidate) => ({
        at: Date.parse(candidate.arrives_at),
        zone: candidate.arrival_timezone,
        label: areaName(candidate.arrival_area),
      })),
    // A stay that already began counts as recent up to its check-out.
    ...zoned
      .filter((stay) => midday(stay.check_in_date) <= now)
      .map((stay) => ({
        at: Math.min(now, midday(stay.check_out_date)),
        zone: stayZone(stay),
        label: areaName(stay.area),
      })),
  ].sort((left, right) => right.at - left.at)[0];
  return last
    ? { kind: "between", zone: last.zone, label: m.owner_between_stays_last_in({ p0: last.label }) }
    : home;
}
