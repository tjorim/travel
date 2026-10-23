import { Link } from "@tanstack/react-router";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { formatInstant } from "../tracker-model";
import { OwnerTripMap } from "./OwnerTripMap";
import { TripOverview } from "./TripOverview";
import { OverviewTasks } from "./OverviewTasks";
import type { SectionProps } from "./workspace-sections";

/**
 * The workspace's first section: the trip at a glance, its map, recent travel updates and open tasks, in that
 * reading order on a phone. On a wide screen the map takes the main column and the other three stack beside it.
 */
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
      <div className="travel-overview-split">
        <div className="min-w-0 empty:hidden min-[1100px]:col-start-1 min-[1100px]:row-start-1">
          <TripOverview trip={trip} />
        </div>
        <div
          className="min-w-0 min-[1100px]:col-start-2 min-[1100px]:row-span-3 min-[1100px]:row-start-1"
          data-trip-map=""
        >
          <OwnerTripMap trip={trip} areas={areas} focus={mapFocus} onOpenRecord={onOpenMapRecord} />
        </div>
        <section
          className="travel-card grid min-w-0 content-start gap-3.5 min-[1100px]:col-start-1 min-[1100px]:row-start-2"
          aria-labelledby="updates-title"
        >
          <h3 className="m-0" id="updates-title">
            {m.owner_travel_updates()}
          </h3>
          {trip.travel_updates.length ? (
            <ul className="m-0 grid list-none gap-0 p-0">
              {trip.travel_updates
                .slice()
                .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
                .map((update) => (
                  <li
                    className="grid gap-0.5 border-b border-travel-divider py-2.5 first:pt-0 last:border-b-0"
                    key={update.id}
                  >
                    <strong>{update.title}</strong>
                    <span className="text-sm font-medium text-travel-muted">
                      {formatInstant(update.occurred_at)}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="m-0 leading-normal text-travel-muted">
              {m.owner_no_travel_updates_yet_capture_one_whenever_you_like()}
            </p>
          )}
        </section>
        <div className="min-w-0 min-[1100px]:col-start-1 min-[1100px]:row-start-3">
          <OverviewTasks trip={trip} />
        </div>
      </div>
    </>
  );
}
