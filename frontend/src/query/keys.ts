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
  /** Redacted copies of one document or media asset. Nested under the asset list, so refreshing the list refreshes them. */
  derivatives: (subject: string, tripId: string, kind: DerivativeParent, assetId: string) => [...scope(subject), "trip", tripId, kind, assetId, "derivatives"] as const,
  library: (subject: string, resource: LibraryResource) => [...scope(subject), "library", resource] as const,
  /** Library documents linked to one trip. Nested under the library documents. */
  linkedLibraryDocuments: (subject: string, tripId: string) => [...scope(subject), "library", "documents", "linked", tripId] as const,
  providers: (subject: string) => [...scope(subject), "provider-tokens"] as const,
};

/** Owner-only collections that hang off one trip, named by their API path. */
export type TripResource =
  | "stays" | "transport-legs" | "trip-tasks" | "task-alerts" | "places/broad" | "places" | "broad-routes"
  | "itinerary-entries" | "documents" | "media" | "recorded-tracks" | "public-projection" | "share-links";

export type DerivativeParent = "documents" | "media";
export type LibraryResource = "documents" | "emergency-info";
