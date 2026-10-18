import { Link } from "@tanstack/react-router";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { formatInstant } from "../tracker-model";
import { OwnerTripMap } from "./OwnerTripMap";
import { TripOverview } from "./TripOverview";
import { OverviewTasks } from "./OverviewTasks";
import type { SectionProps } from "./workspace-sections";

/** The workspace's first section: the trip at a glance, its map, recent travel updates and open tasks. */
export function WorkspaceOverview({ trip, areas, mapFocus, onOpenMapRecord }: SectionProps) {
  useLocale();
  return (
    <>
      <div className="flex justify-end">
        <Link
          className="secondary action-link"
          to={`/trips/${encodeURIComponent(trip.id)}/details`}
        >
          {m.owner_complete_private_overview()}
        </Link>
      </div>
      <TripOverview trip={trip} />
      <OwnerTripMap trip={trip} areas={areas} focus={mapFocus} onOpenRecord={onOpenMapRecord} />
      <div className="grid gap-4.5 min-[680px]:grid-cols-2">
        <section className="travel-card grid content-start gap-4.5 [&_h3]:m-0 [&_p]:m-0">
          <h3>{m.owner_travel_updates()}</h3>
          {trip.travel_updates.length ? (
            <div className="saved-records">
              {trip.travel_updates
                .slice()
                .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
                .map((update) => (
                  <div
                    className="grid w-full gap-1 rounded-xl border border-travel-card-border bg-travel-surface p-3.5 text-left text-travel-ink shadow-sm [&_span]:text-sm [&_span]:font-medium [&_span]:text-travel-muted"
                    key={update.id}
                  >
                    <strong>{update.title}</strong>
                    <span>{formatInstant(update.occurred_at)}</span>
                  </div>
                ))}
            </div>
          ) : (
            <p>{m.owner_no_travel_updates_yet_capture_one_whenever_you_like()}</p>
          )}
        </section>
        <OverviewTasks trip={trip} />
      </div>
    </>
  );
}
