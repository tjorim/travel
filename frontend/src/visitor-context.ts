import { dayjs } from "./dayjs";
import type {
  Projection,
  ProjectionArea,
  ProjectionRoute,
  ProjectionStay,
  ProjectionVisit,
} from "./projection-types";

/** What the visitor projection already delivers about the same area and day as one story update. */
export type UpdateContext = {
  visits: ProjectionVisit[];
  stays: ProjectionStay[];
  routes: ProjectionRoute[];
};

export type StoryContext = {
  /** Approved records tied to exactly one update, by update id. */
  byUpdate: Map<string, UpdateContext>;
  /** Everything not tied to exactly one update; these keep their compact separate blocks. */
  separate: UpdateContext;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(value: string | null | undefined): string | null {
  return value || null;
}

/**
 * An area as the visitor sees it. The projection carries no area id, so two records are "the same area" only when
 * every shared field (label, country, region and rounded point) is identical.
 */
function areaKey(area: ProjectionArea | null | undefined): string | null {
  if (!area || !text(area.label)) return null;
  return JSON.stringify([
    text(area.label),
    text(area.country_code),
    text(area.region),
    area.latitude ?? null,
    area.longitude ?? null,
  ]);
}

/** A date only when it is shared to the day; month and year dates never place a record on a specific update. */
function day(
  delivered: string | null | undefined,
  precisionOf: string | null | undefined,
): string | null {
  const value = text(delivered);
  const precision = text(precisionOf);
  if (!value || !DAY.test(value) || (precision !== null && precision !== "day")) return null;
  return dayjs.utc(value).isValid() ? value : null;
}

function routeDay(route: ProjectionRoute): string | null {
  // A route shared only by month or year has no day, and no instant is delivered with it.
  if (text(route.departs_on)) return day(route.departs_on, route.date_precision);
  const at = text(route.departs_at);
  if (!at || !dayjs(at).isValid()) return null;
  try {
    return dayjs(at)
      .tz(text(route.departure_timezone) ?? undefined)
      .format("YYYY-MM-DD");
  } catch {
    return null;
  }
}

/**
 * Ties visits, stays and routes to the one story update that shares their area and day. A record that matches no
 * update, or more than one (repeat visits on a day, several updates in one area, a stay spanning many updates), or has
 * no day-precision date, stays in `separate` instead of being guessed at. Nothing is added to what the audience
 * already receives.
 */
export function groupStoryContext(
  projection: Pick<Projection, "updates" | "visits" | "stays" | "routes">,
): StoryContext {
  const updates = projection.updates.flatMap((update) => {
    const date = day(update.story_date, update.date_precision);
    const area = areaKey(update.place);
    return date && area ? [{ id: update.id, date, area }] : [];
  });
  const byUpdate = new Map<string, UpdateContext>();
  const separate: UpdateContext = { visits: [], stays: [], routes: [] };

  const place = <K extends keyof UpdateContext>(
    kind: K,
    item: UpdateContext[K][number],
    areas: (string | null)[],
    from: string | null,
    to: string | null,
  ) => {
    const keys = areas.filter((value): value is string => value !== null);
    const matches =
      from && keys.length
        ? updates.filter(
            (update) =>
              keys.includes(update.area) && update.date >= from && update.date <= (to ?? from),
          )
        : [];
    if (matches.length !== 1) {
      (separate[kind] as UpdateContext[K][number][]).push(item);
      return;
    }
    const context = byUpdate.get(matches[0].id) ?? { visits: [], stays: [], routes: [] };
    (context[kind] as UpdateContext[K][number][]).push(item);
    byUpdate.set(matches[0].id, context);
  };

  for (const visit of projection.visits) {
    const from = day(visit.starts_on, visit.date_precision);
    const to = text(visit.ends_on) ? day(visit.ends_on, visit.date_precision) : from;
    // An end the owner shared at a coarser precision leaves the span unknown.
    place("visits", visit, [areaKey(visit.place)], to ? from : null, to);
  }
  for (const stay of projection.stays) {
    const from = day(stay.starts_on, stay.date_precision);
    const to = day(stay.ends_on, stay.date_precision) ?? from;
    place("stays", stay, [areaKey(stay.place)], from, to);
  }
  for (const route of projection.routes) {
    const date = routeDay(route);
    // A route belongs to an update at either end; when both ends have an update that day it stays separate.
    place("routes", route, [areaKey(route.departure), areaKey(route.arrival)], date, date);
  }
  return { byUpdate, separate };
}
