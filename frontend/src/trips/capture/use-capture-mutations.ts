import { m } from "../../paraglide/messages.js";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwnerMutation } from "../../query/owner-queries";
import type { TravelUpdate } from "../../tracker-model";

export const SAVE_FALLBACK = m.api_capture_save;

/** The owner API calls behind the capture dialog: save and delete a travel update. */
export function useCaptureMutations() {
  const saveUpdate = useOwnerMutation<
    { tripId: string; updateId: string | null; payload: Record<string, unknown> },
    TravelUpdate
  >({
    fallback: SAVE_FALLBACK,
    request: ({ tripId, updateId, payload }) => ({
      path: updateId
        ? tripPath(tripId, `travel-updates/${updateId}`)
        : tripPath(tripId, "travel-updates"),
      method: updateId ? "PATCH" : "POST",
      body: payload,
    }),
    // A travel update may create a reusable location and its derived area alongside the trip's embedded update list.
    invalidate: (subject, { tripId }) => [
      ownerKeys.trips(subject),
      ownerKeys.tripResource(subject, tripId, "locations"),
      ownerKeys.tripResource(subject, tripId, "areas"),
    ],
  });
  const deleteUpdate = useOwnerMutation<{ tripId: string; updateId: string }>({
    fallback: m.owner_the_travel_update_could_not_be_deleted,
    request: ({ tripId, updateId }) => ({
      path: tripPath(tripId, `travel-updates/${updateId}`),
      method: "DELETE",
    }),
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });
  return { saveUpdate, deleteUpdate };
}
