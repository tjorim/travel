import { Button } from "@base-ui/react/button";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useAuth } from "../auth-context";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useFeedback } from "../query/feedback";
import { useTripsQuery } from "../query/owner-queries";
import type { Trip } from "../tracker-model";
import { EmptyState } from "../ui/EmptyState";
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

  function openTrip(trip: Trip) {
    void navigate({ to: `/trips/${encodeURIComponent(trip.id)}` });
  }

  if (!session) return <EmptyState title={m.trips()}>{message}</EmptyState>;

  return (
    <section className="grid gap-4.5" aria-labelledby="trips-title">
      <div className="capture-heading">
        <div>
          <p className="travel-eyebrow">{m.owner_private_trip_management()}</p>
          <h2 id="trips-title">{m.trips()}</h2>
        </div>
        <Button className="secondary compact" type="button" onClick={newTrip}>
          {m.owner_new_trip()}
        </Button>
      </div>
      <p className="help" role="status">
        {message}
      </p>
      <section
        className="grid content-start gap-2 [&>p]:m-0 [&>p]:leading-normal [&>p]:text-travel-muted"
        aria-label={m.your_trips()}
      >
        {trips.map((trip) => (
          <Button
            className="grid w-full gap-1 rounded-xl border border-travel-card-border bg-travel-surface p-3.5 text-left text-travel-ink shadow-sm [&_span]:text-sm [&_span]:font-medium [&_span]:text-travel-muted"
            type="button"
            key={trip.id}
            onClick={() => openTrip(trip)}
          >
            <strong>{trip.title}</strong>
            <span>{m.owner_travel_update_count({ count: trip.travel_updates.length })}</span>
          </Button>
        ))}
        {tripsQuery.isSuccess && !trips.length && (
          <p>{m.owner_your_first_trip_stays_private_until_you_share_something()}</p>
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
