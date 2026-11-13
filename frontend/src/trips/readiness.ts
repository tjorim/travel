import { browserTimeZone, daysBetween, localDate } from "../dates";
import { whereabouts } from "../whereabouts";
import { type Stay, type Route, type TripTask } from "../api-types";

/** Calendar days, never elapsed 24-hour periods (including across DST). */
export function tripDay(
  now: Date,
  stays: Stay[] = [],
  routes: Route[] = [],
  homeZone = browserTimeZone(),
) {
  const zone = whereabouts(now.toISOString(), stays, routes, homeZone).zone ?? homeZone;
  return localDate(now.toISOString(), zone);
}
export const isOverdue = (task: Pick<TripTask, "due_date" | "completed_at">, today: string) =>
  !task.completed_at && !!task.due_date && task.due_date < today;
export function tripProgress(start: string | null, end: string | null, today: string) {
  if (!start) return null;
  if (today < start) return { kind: "before" as const, days: daysBetween(today, start) };
  if (end && today > end) return { kind: "finished" as const };
  return {
    kind: "underway" as const,
    day: daysBetween(start, today) + 1,
    total: end ? daysBetween(start, end) + 1 : null,
  };
}
