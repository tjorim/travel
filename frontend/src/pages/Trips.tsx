import { Button } from "@/ui/button";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useAuth } from "../auth-context";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useFeedback } from "../query/feedback";
import { useTripsQuery } from "../query/owner-queries";
import { EmptyState } from "@/ui/EmptyState";
import { ListTripCard } from "../trips/OwnerTripCard";
import { orderedTrips, today, tripState, type TripState } from "../trips/trip-state";
import { TripEditor } from "../trips/TripEditor";
import { tripsStatusMessage } from "../trips/trips-status";

/** The trips list. A trip is worked on in its own workspace (`TripWorkspace`). */
export function Trips() {
  useLocale();
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const tripsQuery = useTripsQuery();
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  // `strict: false` reads whichever match is active, and this component also renders behind `/capture`.
  const searchParams = useSearch({ strict: false }) as { new?: "1" };
  // `/trips?new=1` (the home page's "Nieuwe reis") opens the new-trip dialog straight away.
  const [creating, setCreating] = useState(() => searchParams.new === "1");
  const [notice, setNotice] = useFeedback<string | null>(null);
  // A page we were sent here from (a deleted trip) can leave a message behind.
  const arrivalNotice =
    location.state.notice === "trip_deleted" ? m.owner_trip_deleted() : undefined;
  const message = notice ?? arrivalNotice ?? tripsStatusMessage(session, tripsQuery, trips);

  function newTrip() {
    setCreating(true);
    setNotice(null);
  }

  function closeNewTrip() {
    setCreating(false);
    if (searchParams.new !== undefined) void navigate({ to: ".", search: {}, replace: true });
  }

  if (!session) return <EmptyState title={m.trips()}>{message}</EmptyState>;

  const day = today();
  const ordered = orderedTrips(trips, day);
  const groups: { state: TripState[]; title: string }[] = [
    { state: ["active", "upcoming"], title: m.owner_now_and_soon() },
    { state: ["planned"], title: m.owner_still_to_plan() },
    { state: ["past"], title: m.owner_past_trips() },
  ];

  return (
    <section className="grid grid-cols-1 gap-4.5" aria-labelledby="trips-title">
      <div className="capture-heading">
        <div>
          <p className="travel-eyebrow">{m.owner_private_trip_management()}</p>
          <h2 id="trips-title">{m.trips()}</h2>
        </div>
        <Button className="secondary compact" type="button" onClick={newTrip}>
          {m.owner_new_trip()}
        </Button>
      </div>
      <p className="help max-w-travel-reading" role="status">
        {message}
      </p>
      <section className="grid content-start gap-travel-section" aria-label={m.your_trips()}>
        {groups.map(({ state, title }) => {
          const shown = ordered.filter((trip) => state.includes(tripState(trip, day)));
          if (!shown.length) return null;
          return (
            <div className="grid gap-4" key={title}>
              <h3 className="m-0">{title}</h3>
              <div className="travel-trip-grid">
                {shown.map((trip) => (
                  <ListTripCard key={trip.id} trip={trip} state={tripState(trip, day)} />
                ))}
              </div>
            </div>
          );
        })}
        {tripsQuery.isSuccess && !trips.length && (
          <p className="m-0 max-w-travel-reading leading-normal text-travel-muted">
            {m.owner_your_first_trip_stays_private_until_you_share_something()}
          </p>
        )}
      </section>
      <TripEditor
        key="new"
        trip={null}
        open={creating}
        onClose={closeNewTrip}
        onSaved={(saved) => void navigate({ to: `/trips/${encodeURIComponent(saved.id)}` })}
        onDeleted={() => undefined}
        onNotice={setNotice}
      />
    </section>
  );
}
