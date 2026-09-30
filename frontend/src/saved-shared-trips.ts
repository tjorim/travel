import type { Projection } from "./ProjectionView";

const storageKey = "travel-saved-shared-trips@1";
const maximumSavedTrips = 30;

export type SavedSharedTrip = {
  token: string;
  title: string | null;
  summary: string | null;
  lastVisitedAt: string;
};

function isSavedSharedTrip(value: unknown): value is SavedSharedTrip {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const trip = value as Record<string, unknown>;
  return (
    typeof trip.token === "string" &&
    trip.token.length >= 20 &&
    trip.token.length <= 512 &&
    (trip.title === null || typeof trip.title === "string") &&
    (trip.summary === null || typeof trip.summary === "string") &&
    typeof trip.lastVisitedAt === "string"
  );
}

export function readSavedSharedTrips(): SavedSharedTrip[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSavedSharedTrip)
      .sort((left, right) => right.lastVisitedAt.localeCompare(left.lastVisitedAt));
  } catch {
    return [];
  }
}

function writeSavedSharedTrips(trips: SavedSharedTrip[]): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(trips.slice(0, maximumSavedTrips)));
    return true;
  } catch {
    // Saving a convenience shortcut must never prevent the shared trip itself
    // from rendering (storage can be disabled or full).
    return false;
  }
}

/** Saves a valid unlisted capability only in this browser's local storage. */
export function rememberSharedTrip(token: string, projection: Projection): boolean {
  if (token.length < 20 || token.length > 512) return false;
  const current: SavedSharedTrip = {
    token,
    title: projection.title,
    // A card shows a one-line preview, not the rendered Markdown.
    summary: projection.summary_text ?? projection.summary,
    lastVisitedAt: new Date().toISOString(),
  };
  return writeSavedSharedTrips([current, ...readSavedSharedTrips().filter((trip) => trip.token !== token)]);
}

export function forgetSharedTrip(token: string): boolean {
  return writeSavedSharedTrips(readSavedSharedTrips().filter((trip) => trip.token !== token));
}
