import { Button } from "@/ui/button";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useTripResource } from "../query/owner-queries";
import type { Trip } from "../tracker-model";
import { today, tripDateRange, tripState } from "./trip-state";
import { sectionById, type TripWorkspaceSection } from "./workspace-sections";
import { TripCover } from "./TripCover";
import { TripStatePill } from "./TripStatePill";

/** Whether the public page is live. Unlisted links are not summarised here: the Sharing section lists them. */
function PublicationState({ tripId }: { tripId: string }) {
  useLocale();
  const status = useTripResource(tripId, "public-projection").data;
  if (!status) return null;
  const live = status.surface_state === "published";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-extrabold",
        live
          ? "bg-travel-online-surface text-travel-online-ink"
          : "bg-travel-disconnected-surface text-travel-disconnected-ink",
      )}
    >
      {live ? m.owner_public_page_live() : m.owner_not_published()}
    </span>
  );
}

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
            className="inline-flex min-h-11 items-center text-travel-muted no-underline hover:underline focus-visible:underline"
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
