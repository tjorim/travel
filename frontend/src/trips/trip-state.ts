import { dayjs } from "../dayjs";
import { m } from "../paraglide/messages.js";
import { formatDay, type Trip } from "../tracker-model";

export type TripState = "active" | "upcoming" | "planned" | "past";

/** Today's local date, the day trips are classified against. */
export function today(): string {
  return dayjs().format("YYYY-MM-DD");
}

/** A trip without dates is still being planned; otherwise its dates decide whether it is under way, ahead or done. */
export function tripState(trip: Pick<Trip, "starts_on" | "ends_on">, day: string): TripState {
  if (!trip.starts_on) return "planned";
  if (trip.starts_on <= day && (!trip.ends_on || trip.ends_on >= day)) return "active";
  return trip.starts_on > day ? "upcoming" : "past";
}

const RANK: Record<TripState, number> = { active: 0, upcoming: 1, planned: 2, past: 3 };

/** Under way first, then ahead by date, then undated, then finished. */
export function orderedTrips<T extends Pick<Trip, "starts_on" | "ends_on">>(
  trips: T[],
  day: string,
): T[] {
  return trips
    .slice()
    .sort(
      (left, right) =>
        RANK[tripState(left, day)] - RANK[tripState(right, day)] ||
        (left.starts_on ?? "9999-12-31").localeCompare(right.starts_on ?? "9999-12-31"),
    );
}

export function tripStateLabel(state: TripState): string {
  switch (state) {
    case "active":
      return m.owner_travelling_now();
    case "upcoming":
      return m.owner_coming_soon();
    case "planned":
      return m.owner_still_to_plan();
    case "past":
      return m.owner_past_trip();
  }
}

/** "1 March 2026 — 9 March 2026", or null while the trip has no dates. */
export function tripDateRange(
  trip: Pick<Trip, "starts_on" | "ends_on">,
  format = "D MMM YYYY",
): string | null {
  if (!trip.starts_on) return null;
  return trip.ends_on
    ? `${formatDay(trip.starts_on, format)} — ${formatDay(trip.ends_on, format)}`
    : formatDay(trip.starts_on, format);
}
