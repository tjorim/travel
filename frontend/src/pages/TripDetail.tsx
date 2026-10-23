import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";

import { useAuth } from "../auth-context";
import { useLocale } from "../locale";
import { Markdown } from "../Markdown";
import { m } from "../paraglide/messages.js";
import { errorMessage, openOwnerFile } from "../query/api";
import { errorNotice, useFeedback } from "../query/feedback";
import { useOwner } from "../query/owner-queries";
import { formatDayRange } from "../tracker-model";
import { AreasBlock } from "../trips/detail/AreasBlock";
import { DocumentsBlock } from "../trips/detail/DocumentsBlock";
import { LocationsBlock } from "../trips/detail/LocationsBlock";
import { MediaBlock } from "../trips/detail/MediaBlock";
import { RoutesBlock } from "../trips/detail/RoutesBlock";
import { SECTIONS } from "../trips/detail/sections";
import { StaysBlock } from "../trips/detail/StaysBlock";
import { TasksBlock } from "../trips/detail/TasksBlock";
import { UpdatesBlock } from "../trips/detail/UpdatesBlock";
import { useTripDetail } from "../trips/detail/use-trip-detail";
import { VisitsBlock } from "../trips/detail/VisitsBlock";
import { OwnerTripMap } from "../trips/OwnerTripMap";
import { TripOverview } from "../trips/TripOverview";
import { sectionForRecord } from "../trips/workspace-sections";
import { EmptyState } from "@/ui/EmptyState";

export function TripDetail() {
  useLocale();
  const navigate = useNavigate();
  const { tripId } = useParams({ strict: false });
  const openMapRecord = useCallback(
    (kind: "area" | "location" | "visit" | "route" | "update", recordId: string) => {
      if (tripId)
        void navigate({
          to: `/trips/${encodeURIComponent(tripId)}/${sectionForRecord(kind)}`,
          state: { openRecord: { kind, id: recordId } },
        });
    },
    [navigate, tripId],
  );
  const { session } = useAuth();
  const owner = useOwner();
  const {
    tripsLoaded,
    trip,
    places,
    areas,
    routes,
    stays,
    visits,
    tasks,
    documents,
    libraryDocuments,
    media,
    readError,
  } = useTripDetail(tripId);
  const [notice, setNotice] = useFeedback<string>("");
  const mediaById = new Map(media?.map((asset) => [asset.id, asset]));

  if (!session) return <EmptyState title={m.private_trip()}>{m.sign_in_details()}</EmptyState>;
  if (!tripId) return <EmptyState title={m.trip_not_found()}>{m.invalid_trip_id()}</EmptyState>;
  if (tripsLoaded && !trip)
    return <EmptyState title={m.trip_not_found()}>{m.owner_trip_unavailable()}</EmptyState>;
  // The page shows a whole trip or nothing: a partial page would read as if records were missing.
  if (
    !trip ||
    !places ||
    !areas ||
    !routes ||
    !stays ||
    !visits ||
    !tasks ||
    !documents ||
    !libraryDocuments ||
    !media
  ) {
    return (
      <section className="travel-card" role={readError ? "alert" : "status"}>
        <h2>{m.private_trip()}</h2>
        <p>
          {readError ? errorMessage(readError, m.private_trip_error) : m.private_trip_loading()}
        </p>
      </section>
    );
  }

  const openFile = (url: string, fallback: string) => {
    if (owner)
      openOwnerFile(owner.session, url, fallback).catch((error: unknown) =>
        setNotice(errorNotice(error, fallback)),
      );
  };
  return (
    <main className="grid gap-4.5" aria-labelledby="admin-trip-title">
      <header className="flex items-start justify-between gap-4 max-[620px]:flex-col max-[620px]:items-stretch [&_h1]:m-0 [&_h2]:m-0 [&_h1]:text-2xl [&_h2]:text-2xl [&_p]:mt-1.5 [&_p]:mb-0 [&_p]:text-travel-muted">
        <div>
          <p className="travel-eyebrow">{m.owner_only_for_you_complete_private_overview()}</p>
          <h1 id="admin-trip-title">{trip.title}</h1>
          {trip.starts_on && (
            <p>{formatDayRange(trip.starts_on, trip.ends_on ?? trip.starts_on)}</p>
          )}
        </div>
        <Link className="action-link" to={`/trips/${encodeURIComponent(trip.id)}`}>
          {m.owner_go_to_trip_management()}
        </Link>
      </header>
      {trip.summary && (
        <section
          className="travel-card grid gap-3 [&_h2]:m-0 [&_h3]:m-0 [&_p]:m-0"
          aria-label={m.owner_trip_summary()}
        >
          <Markdown html={trip.summary_html} text={trip.summary} />
        </section>
      )}
      <TripOverview trip={trip} />
      <OwnerTripMap trip={trip} areas={areas} onOpenRecord={openMapRecord} />
      <nav
        className="flex flex-wrap gap-1.5 [&_a]:rounded-full [&_a]:border [&_a]:border-travel-card-border [&_a]:bg-travel-surface [&_a]:px-2.5 [&_a]:py-1.5 [&_a]:text-sm [&_a]:font-bold [&_a]:text-travel-muted [&_a]:no-underline [&_a:hover]:bg-travel-selected-bg [&_a:focus-visible]:bg-travel-selected-bg"
        aria-label={m.owner_sections_in_this_overview()}
      >
        {SECTIONS.map(({ id: sectionId, label }) => (
          <a key={sectionId} href={`#${sectionId}`}>
            {label}
          </a>
        ))}
      </nav>
      {notice && (
        <p className="help" role="status">
          {notice}
        </p>
      )}

      <UpdatesBlock trip={trip} mediaById={mediaById} session={owner?.session ?? null} />
      <VisitsBlock trip={trip} visits={visits} />
      <StaysBlock trip={trip} stays={stays} />
      <RoutesBlock trip={trip} routes={routes} />
      <TasksBlock trip={trip} tasks={tasks} />
      <LocationsBlock trip={trip} places={places} />
      <AreasBlock trip={trip} areas={areas} />
      <DocumentsBlock
        trip={trip}
        documents={documents}
        libraryDocuments={libraryDocuments}
        openFile={openFile}
      />
      <MediaBlock trip={trip} media={media} session={owner?.session ?? null} openFile={openFile} />
    </main>
  );
}
