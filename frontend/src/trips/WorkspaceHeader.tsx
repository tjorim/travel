import { Button } from "@/ui/button";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import PublicationState from "./PublicationState";
import type { Trip } from "../tracker-model";
import { today, tripDateRange, tripState } from "./trip-state";
import { sectionById, type TripWorkspaceSection } from "./workspace-sections";
import { TripCover } from "./TripCover";
import { TripStatePill } from "./TripStatePill";

/** Where the owner is (Trips › current section), the trip's cover, title and dates, and its header action. */
export function WorkspaceHeader({ trip, onEdit }: { trip: Trip; onEdit: () => void }) {
  useLocale();
  const hasCover = Boolean(trip.cover_url);
  return (
    <>
      <header className="grid min-w-0 gap-4">
        <TripCover trip={trip} wide />
        <div
          className={cn(
            "flex items-start justify-between gap-4 max-[620px]:flex-col max-[620px]:items-stretch trip-sidebar:flex-col trip-sidebar:items-stretch",
            !hasCover &&
              "rounded-travel-card border-t-4 border-travel-warning-border bg-travel-surface p-travel-context-pad shadow-travel-card",
          )}
        >
          <div className="grid min-w-0 gap-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <TripStatePill state={tripState(trip, today())} />
              <PublicationState tripId={trip.id} />
            </div>
            <h1
              className="m-0 max-w-travel-reading text-travel-context-title leading-tight trip-sidebar:text-travel-sidebar-title tracking-tight"
              id="trip-detail-title"
            >
              {trip.title}
            </h1>
            <p className="m-0 leading-normal font-medium text-travel-muted">
              {[
                tripDateRange(trip),
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
        </div>
      </header>
    </>
  );
}

export function WorkspaceBreadcrumb({ section }: { section: TripWorkspaceSection }) {
  useLocale();
  return (
    <nav aria-label={m.breadcrumb()}>
      <ol className="m-0 flex list-none items-center gap-1.5 p-0 text-sm font-bold text-travel-muted">
        <li className="shrink-0">
          <Link
            className="inline-flex min-h-11 min-w-11 items-center text-travel-muted no-underline hover:underline focus-visible:underline"
            to="/trips"
            activeOptions={{ exact: true }}
          >
            {m.trips()}
          </Link>
        </li>
        <li aria-hidden="true">›</li>
        <li className="min-w-0 truncate" aria-current="page">
          {sectionById(section).label()}
        </li>
      </ol>
    </nav>
  );
}
