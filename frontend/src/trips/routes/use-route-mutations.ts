import { m } from "../../paraglide/messages.js";
import { ownerKeys } from "../../query/keys";
import type { Route } from "../../tracker-model";
import { useTripRecordMutations } from "../use-record-mutations";

/** The owner API calls behind the route editor: save (create or update) and delete. */
export function useRouteMutations(tripId: string) {
  return useTripRecordMutations<Route>(tripId, "routes", {
    saveFailed: m.owner_the_route_could_not_be_saved,
    deleteFailed: m.owner_the_route_could_not_be_deleted,
    // A new location can create a reusable location and its derived area.
    invalidate: (subject) => [
      ownerKeys.tripResource(subject, tripId, "routes"),
      ownerKeys.tripResource(subject, tripId, "locations"),
      ownerKeys.tripResource(subject, tripId, "areas"),
    ],
  });
}
