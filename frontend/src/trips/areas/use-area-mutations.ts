import { m } from "../../paraglide/messages.js";
import { ownerKeys } from "../../query/keys";
import type { Area } from "../../tracker-model";
import { useTripRecordMutations } from "../use-record-mutations";

/** The owner API calls behind the area editor: save (create or update) and delete. */
export function useAreaMutations(tripId: string) {
  return useTripRecordMutations<Area>(tripId, "areas", {
    saveFailed: m.owner_the_area_could_not_be_saved,
    deleteFailed: m.owner_the_area_could_not_be_deleted,
    // Visits, stays and reisupdates embed the area, so the trip is refreshed with it.
    invalidate: (subject) => [
      ownerKeys.tripResource(subject, tripId, "areas"),
      ownerKeys.trips(subject),
    ],
  });
}
