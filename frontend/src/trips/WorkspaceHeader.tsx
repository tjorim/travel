import { Button } from "@base-ui/react/button";
import { Link } from "@tanstack/react-router";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { formatDay, type Trip } from "../tracker-model";

/** Where the owner is (Trips › this trip), the trip's title and dates, and its header action. */
export function WorkspaceHeader({ trip, onEdit }: { trip: Trip; onEdit: () => void }) {
  useLocale();
  return (
    <>
      <nav aria-label={m.breadcrumb()}>
        <ol className="m-0 flex list-none items-center gap-1.5 p-0 text-sm font-bold text-travel-muted">
          <li>
            <Link
              className="inline-flex min-h-11 items-center text-travel-muted no-underline hover:underline focus-visible:underline"
              to="/trips"
            >
              {m.trips()}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li className="min-w-0 truncate" aria-current="page">
            {trip.title}
          </li>
        </ol>
      </nav>
      <header className="flex items-start justify-between gap-4 max-[620px]:flex-col max-[620px]:items-stretch [&_h1]:m-0 [&_h2]:m-0 [&_h1]:text-2xl [&_h2]:text-2xl [&_p]:mt-1.5 [&_p]:mb-0 [&_p]:text-travel-muted">
        <div>
          <p className="travel-eyebrow">{m.private_trip()}</p>
          <h2 id="trip-detail-title">{trip.title}</h2>
          <p>
            {[
              trip.starts_on && trip.ends_on
                ? `${formatDay(trip.starts_on, "D MMM YYYY")} — ${formatDay(trip.ends_on, "D MMM YYYY")}`
                : null,
              m.owner_travel_update_count({ count: trip.travel_updates.length }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="button-row">
          <Button className="secondary compact" type="button" onClick={onEdit}>
            {m.owner_trip_details()}
          </Button>
        </div>
      </header>
    </>
  );
}
