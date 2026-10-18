import type { TrackerSession } from "../auth";
import { m } from "../paraglide/messages.js";
import { errorMessage } from "../query/api";
import type { useTripsQuery } from "../query/owner-queries";
import type { Trip } from "../tracker-model";

/** What the trips list and a trip's workspace say about loading the owner's trips, before any notice overrides it. */
export function tripsStatusMessage(
  session: TrackerSession | null,
  tripsQuery: ReturnType<typeof useTripsQuery>,
  trips: Trip[],
): string {
  if (!session) return m.sign_in_trips();
  if (tripsQuery.isError) return errorMessage(tripsQuery.error, m.owner_trips_error);
  if (tripsQuery.isPending) return m.owner_trips_loading();
  return trips.length
    ? m.owner_choose_a_trip_to_manage_its_private_details()
    : m.owner_no_trips_yet_create_your_first_private_trip();
}
