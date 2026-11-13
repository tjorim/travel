import { m } from "../../paraglide/messages.js";
import { ownerKeys } from "../../query/keys";
import type { Visit } from "../../api-types";
import { useTripRecordMutations } from "../use-record-mutations";

/** The owner API calls behind the visit editor: save (create or update) and delete. */
export function useVisitMutations(tripId: string) {
  // A new location can create a reusable location and its derived area.
  const invalidate = (subject: string) => [
    ownerKeys.tripResource(subject, tripId, "visits"),
    ownerKeys.tripResource(subject, tripId, "locations"),
    ownerKeys.tripResource(subject, tripId, "areas"),
  ];
  const { save, remove } = useTripRecordMutations<Visit>(tripId, "visits", {
    saveFailed: m.owner_the_visit_could_not_be_saved,
    deleteFailed: m.owner_the_visit_could_not_be_deleted,
    invalidate,
  });
  return { save, remove };
}
