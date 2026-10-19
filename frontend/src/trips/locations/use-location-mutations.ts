import { m } from "../../paraglide/messages.js";
import { ownerKeys } from "../../query/keys";
import type { Location } from "../../tracker-model";
import { useTripRecordMutations } from "../use-record-mutations";

/** The owner API calls behind the location editor: save (create or update) and delete. */
export function useLocationMutations(tripId: string) {
  return useTripRecordMutations<Location>(tripId, "locations", {
    saveFailed: m.owner_the_location_could_not_be_saved,
    deleteFailed: m.owner_the_location_could_not_be_deleted,
    invalidate: (subject) => [ownerKeys.trip(subject, tripId), ownerKeys.trips(subject)],
  });
}
