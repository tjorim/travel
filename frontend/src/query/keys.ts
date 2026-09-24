/**
 * Owner query keys. Every key starts with `"owner"` and the authenticated
 * subject, so one owner's cache can never answer for another and nothing here
 * can collide with the public or unlisted projection views, which do not use
 * the query cache at all.
 */
const scope = (subject: string) => ["owner", subject] as const;

export const ownerKeys = {
  all: scope,
  trips: (subject: string) => [...scope(subject), "trips"] as const,
  trip: (subject: string, tripId: string) => [...scope(subject), "trip", tripId] as const,
  tripResource: (subject: string, tripId: string, resource: TripResource) => [...scope(subject), "trip", tripId, resource] as const,
};

/** Owner-only collections that hang off one trip, named by their API path. */
export type TripResource = "stays" | "transport-legs" | "trip-tasks" | "task-alerts" | "places/broad";
