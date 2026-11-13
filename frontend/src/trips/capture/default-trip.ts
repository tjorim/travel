import type { TripSummary } from "../../api-types";
import { tripState } from "../trip-state";

/** The newest moment saved to a trip, or an empty string when it has none. */
function lastUsed(trip: Pick<TripSummary, "last_update_at">): string {
  return trip.last_update_at ?? "";
}

/**
 * The trips in the order Capture offers them: the trip underway, then the next upcoming one, then the trip most
 * recently captured into, then the rest as the API listed them. The first is what a new capture starts on.
 */
export function captureTripOrder<
  T extends Pick<TripSummary, "starts_on" | "ends_on" | "last_update_at">,
>(trips: T[], day: string): T[] {
  const states = new Map(trips.map((trip) => [trip, tripState(trip, day)]));
  const sooner = (left: T, right: T) => (left.starts_on ?? "").localeCompare(right.starts_on ?? "");
  const underway = trips.filter((trip) => states.get(trip) === "active").sort(sooner);
  const upcoming = trips.filter((trip) => states.get(trip) === "upcoming").sort(sooner);
  const rest = trips
    .filter((trip) => states.get(trip) !== "active" && states.get(trip) !== "upcoming")
    .sort((left, right) => lastUsed(right).localeCompare(lastUsed(left)));
  return [...underway, ...upcoming, ...rest];
}
