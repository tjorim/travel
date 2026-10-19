import { m } from "../../paraglide/messages.js";
import { ownerKeys } from "../../query/keys";
import type { Stay } from "../../tracker-model";
import { useTripRecordMutations } from "../use-record-mutations";

/** The owner API calls behind the stay editor: save (create or update) and delete. */
export function useStayMutations(tripId: string) {
  return useTripRecordMutations<Stay>(tripId, "stays", {
    saveFailed: m.owner_the_stay_could_not_be_saved,
    deleteFailed: m.owner_the_stay_could_not_be_deleted,
    // Saving a hotel can create or reuse both a location and its derived area.
    invalidate: (subject) => [
      ownerKeys.tripResource(subject, tripId, "stays"),
      ownerKeys.tripResource(subject, tripId, "locations"),
      ownerKeys.tripResource(subject, tripId, "areas"),
    ],
  });
}
