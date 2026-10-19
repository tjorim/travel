import { m } from "../../paraglide/messages.js";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwnerMutation } from "../../query/owner-queries";
import type { Visit } from "../../tracker-model";
import { useTripRecordMutations } from "../use-record-mutations";

/** The owner API calls behind the visit editor: save (create or update), reorder and delete. */
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
  const move = useOwnerMutation<{ visit: Visit; position: number }, Visit>({
    fallback: m.owner_the_visit_could_not_be_moved,
    request: ({ visit, position }) => ({
      path: `${tripPath(tripId, "visits")}/${visit.id}`,
      method: "PATCH",
      body: { position },
    }),
    invalidate,
  });
  return { save, move, remove };
}
