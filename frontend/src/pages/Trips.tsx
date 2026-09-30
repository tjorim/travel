import { useFeedback } from "../query/feedback";
import { m } from "../paraglide/messages.js";
import { useLocale } from "../locale";
import { Button } from "@base-ui/react/button";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearch } from "@tanstack/react-router";

import { useAuth } from "../auth-context";
import { EmptyState } from "../tracker-routes";
import { DocumentManager } from "../trips/DocumentManager";
import { LinkedLibraryDocuments } from "../library/LinkedLibraryDocuments";
import { VisitManager } from "../trips/VisitManager";
import { AgendaView, type AgendaRecordKind } from "../trips/AgendaView";
import { AreaManager } from "../trips/AreaManager";
import { TravelUpdateManager } from "../trips/TravelUpdateManager";
import { MediaManager } from "../trips/MediaManager";
import { OwnerTripMap } from "../trips/OwnerTripMap";
import { PublicationManager } from "../trips/PublicationManager";
import { StayManager } from "../trips/StayManager";
import { RouteManager } from "../trips/RouteManager";
import { TripEditor } from "../trips/TripEditor";
import { TripOverview } from "../trips/TripOverview";
import { TripTaskManager } from "../trips/TripTaskManager";
import { PackingManager } from "../trips/PackingManager";
import { CaptureDialog } from "../trips/CaptureDialog";
import { errorMessage } from "../query/api";
import type { DialogFocusRequest } from "../forms/useRecordDialog";
import { useTripResource, useTripsQuery } from "../query/owner-queries";
import { formatDay, formatInstant, type Trip, type TravelUpdateCandidateIntent } from "../tracker-model";

export type TripWorkspaceSection = "overview" | "plan" | "packing" | "story" | "media" | "sharing";

export function Trips({ workspace }: { workspace?: { tripId: string; section: TripWorkspaceSection } } = {}) {
  useLocale();
  const { session } = useAuth();
  const navigate = useNavigate();
  const tripsQuery = useTripsQuery();
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const location = useLocation();
  // `strict: false` reads whichever match is active: the trips-list route validates `new`,
  // but the workspace routes are siblings without it, so a strict match would throw there.
  const searchParams = useSearch({ strict: false }) as { new?: "1" };
  // `/trips?new=1` (the home page's "Nieuwe reis") opens the new-trip dialog straight away.
  const [creating, setCreating] = useState(() => searchParams.new === "1");
  const [editing, setEditing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureCandidate, setCaptureCandidate] = useState<TravelUpdateCandidateIntent | null>(null);
  const [notice, setNotice] = useFeedback<string | null>(null);
  // An Agenda row, or the private overview arriving from elsewhere, asks the matching manager below to open that record's dialog.
  type RecordKind = AgendaRecordKind | "area" | "location" | "task" | "update" | "document" | "media";
  const [recordFocus, setRecordFocus] = useState<({ kind: RecordKind } & DialogFocusRequest) | null>(null);
  const openAgendaRecord = (kind: AgendaRecordKind, id: string) => setRecordFocus({ kind, id, token: Date.now() });
  const openRecordRequest = location.state.openRecord;
  const openRecordKind = openRecordRequest?.kind;
  const openRecordId = openRecordRequest?.id;
  useEffect(() => {
    if (openRecordKind && openRecordId) setRecordFocus({ kind: openRecordKind, id: openRecordId, token: Date.now() });
  }, [openRecordKind, openRecordId]);
  // "Toon op kaart" elsewhere in the workspace opens the overview, whose map focuses that point.
  const focusedPoint = location.state.mapFocus;
  const mapFocus = useMemo(() => (focusedPoint ? { id: focusedPoint, request: 1 } : null), [focusedPoint]);
  useEffect(() => {
    if (!focusedPoint) return;
    // The map mounts a little after the overview, so wait for it before scrolling.
    let attempts = 0;
    const timer = window.setInterval(() => {
      const map = document.querySelector(".trip-workspace .trip-map");
      if (!map && ++attempts <= 30) return;
      window.clearInterval(timer);
      map?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 100);
    return () => window.clearInterval(timer);
  }, [focusedPoint]);

  // The list page only lists; a trip is worked on in its own workspace.
  const selectedTrip = workspace ? (trips.find((trip) => trip.id === workspace.tripId) ?? null) : null;
  const selectedId = selectedTrip?.id ?? null;
  const openMapRecord = useCallback(
    (kind: "area" | "location" | "visit" | "route" | "update", id: string) => {
      if (selectedId)
        void navigate({
          to: `/trips/${encodeURIComponent(selectedId)}/${kind === "update" ? "story" : "plan"}`,
          state: { openRecord: { kind, id } },
        });
    },
    [navigate, selectedId],
  );
  const areas = useTripResource(selectedId, "areas").data ?? [];
  // A page we were sent here from (a deleted trip) can leave a message behind.
  const arrivalNotice = location.state.notice === "trip_deleted" ? m.owner_trip_deleted() : undefined;
  const message =
    notice ??
    arrivalNotice ??
    (!session
      ? m.sign_in_trips()
      : tripsQuery.isError
        ? errorMessage(tripsQuery.error, m.owner_trips_error)
        : tripsQuery.isPending
          ? m.owner_trips_loading()
          : trips.length
            ? m.owner_choose_a_trip_to_manage_its_private_details()
            : m.owner_no_trips_yet_create_your_first_private_trip());

  function showOnMap(pointId: string) {
    if (selectedTrip)
      void navigate({ to: `/trips/${encodeURIComponent(selectedTrip.id)}`, state: { mapFocus: pointId } });
  }

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

  function startCaptureFromCandidate(candidate: TravelUpdateCandidateIntent) {
    setCaptureCandidate(candidate);
    setCapturing(true);
  }

  function closeCapture() {
    setCapturing(false);
    setCaptureCandidate(null);
  }

  if (!session) return <EmptyState title={m.trips()}>{message}</EmptyState>;
  if (workspace && !selectedTrip) {
    if (tripsQuery.isPending) return <EmptyState title={m.loading_trip()}>{message}</EmptyState>;
    if (tripsQuery.isError) return <EmptyState title={m.unavailable_trip()}>{message}</EmptyState>;
    return <EmptyState title={m.trip_not_found()}>{m.owner_trip_unavailable()}</EmptyState>;
  }

  const currentSection = workspace?.section ?? "overview";
  const sectionUrl = (section: TripWorkspaceSection) =>
    `/trips/${encodeURIComponent(selectedTrip?.id ?? "")}${section === "overview" ? "" : `/${section}`}`;

  // Every trip-bound manager remounts per trip, so no editor or dialog carries one trip's record into another.
  if (workspace && selectedTrip)
    return (
      <section className="grid gap-4.5" aria-labelledby="trip-detail-title" key={selectedTrip.id}>
        <Link
          className="inline-flex min-h-11 items-center justify-self-start font-bold text-travel-muted no-underline hover:underline focus-visible:underline"
          to="/trips"
        >
          {m.owner_all_trips()}
        </Link>
        <header className="flex items-start justify-between gap-4 max-[620px]:flex-col max-[620px]:items-stretch [&_h1]:m-0 [&_h2]:m-0 [&_h1]:text-2xl [&_h2]:text-2xl [&_p]:mt-1.5 [&_p]:mb-0 [&_p]:text-travel-muted">
          <div>
            <p className="travel-eyebrow">{m.private_trip()}</p>
            <h2 id="trip-detail-title">{selectedTrip.title}</h2>
            <p>
              {[
                selectedTrip.starts_on && selectedTrip.ends_on
                  ? `${formatDay(selectedTrip.starts_on, "D MMM YYYY")} — ${formatDay(selectedTrip.ends_on, "D MMM YYYY")}`
                  : null,
                m.owner_travel_update_count({ count: selectedTrip.travel_updates.length }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="button-row">
            <Button className="secondary compact" type="button" onClick={() => setEditing(true)}>
              {m.owner_trip_details()}
            </Button>
            <Link className="secondary action-link" to={`/trips/${encodeURIComponent(selectedTrip.id)}/details`}>
              {m.owner_complete_private_overview()}
            </Link>
            <Button className="action-link" type="button" onClick={() => setCapturing(true)}>
              {m.owner_capture_a_moment()}
            </Button>
          </div>
        </header>
        <TripEditor
          key={`edit-${selectedTrip.id}`}
          trip={selectedTrip}
          open={editing}
          onClose={() => setEditing(false)}
          onSaved={() => undefined}
          onDeleted={() => void navigate({ to: "/trips", state: { notice: "trip_deleted" } })}
          onNotice={setNotice}
        />
        <CaptureDialog
          lockedTripId={selectedTrip.id}
          candidate={captureCandidate}
          onCandidateConsumed={() => setCaptureCandidate(null)}
          open={capturing}
          onDismiss={closeCapture}
        />
        <nav
          className="flex gap-1.5 overflow-x-auto border-b border-travel-divider pb-0.5 scrollbar-thin"
          aria-label={m.owner_trip_sections()}
        >
          {(
            [
              ["overview", m.owner_overview()],
              ["plan", m.owner_plan()],
              ["packing", m.owner_packing()],
              ["story", m.owner_story()],
              ["media", m.owner_media_documents()],
              ["sharing", m.owner_sharing()],
            ] as const
          ).map(([section, label]) => (
            <Link
              className="inline-flex min-h-11 shrink-0 items-center rounded-t-lg px-2.5 text-sm font-bold text-travel-muted no-underline aria-[current=page]:bg-travel-selected-bg aria-[current=page]:text-travel-forest"
              key={section}
              to={sectionUrl(section)}
              activeOptions={{ exact: section === "overview" }}
              aria-current={currentSection === section ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        {(notice ?? arrivalNotice) && (
          <p className="help" role="status">
            {notice ?? arrivalNotice}
          </p>
        )}
        {currentSection === "overview" && (
          <>
            <TripOverview trip={selectedTrip} />
            <OwnerTripMap trip={selectedTrip} areas={areas} focus={mapFocus} onOpenRecord={openMapRecord} />
            <div className="grid gap-4.5 min-[680px]:grid-cols-2">
              <section className="travel-card grid content-start gap-4.5 [&_h3]:m-0 [&_p]:m-0">
                <h3>{m.owner_travel_updates()}</h3>
                {selectedTrip.travel_updates.length ? (
                  <div className="saved-records">
                    {selectedTrip.travel_updates
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
              <TripTaskManager trip={selectedTrip} />
            </div>
          </>
        )}
        {currentSection === "plan" && (
          <>
            <nav
              className="flex flex-wrap gap-1.5 [&_a]:inline-flex max-[679px]:[&_a]:min-h-11 [&_a]:items-center [&_a]:rounded-full [&_a]:border [&_a]:border-travel-card-border [&_a]:bg-travel-surface [&_a]:px-2.5 [&_a]:py-1.5 [&_a]:text-sm [&_a]:font-bold [&_a]:text-travel-muted [&_a]:no-underline [&_a:hover]:bg-travel-selected-bg [&_a:focus-visible]:bg-travel-selected-bg"
              aria-label={m.owner_planning_sections()}
            >
              <a href="#agenda">{m.owner_agenda()}</a>
              <a href="#areas">{m.owner_areas_and_locations()}</a>
              <a href="#visits">{m.owner_visits()}</a>
              <a href="#stays">{m.owner_stays()}</a>
              <a href="#routes">{m.owner_routes()}</a>
              <a href="#tasks">{m.owner_things_to_arrange()}</a>
            </nav>
            <AgendaView trip={selectedTrip} onOpenRecord={openAgendaRecord} />
            <AreaManager
              trip={selectedTrip}
              focusId={recordFocus?.kind === "area" ? recordFocus : null}
              locationFocusId={recordFocus?.kind === "location" ? recordFocus : null}
            />
            <VisitManager
              trip={selectedTrip}
              onShowOnMap={showOnMap}
              focusId={recordFocus?.kind === "visit" ? recordFocus : null}
            />
            <StayManager
              trip={selectedTrip}
              areas={areas}
              focusId={recordFocus?.kind === "stay" ? recordFocus : null}
            />
            <RouteManager trip={selectedTrip} focusId={recordFocus?.kind === "route" ? recordFocus : null} />
            <TripTaskManager trip={selectedTrip} focusId={recordFocus?.kind === "task" ? recordFocus : null} />
          </>
        )}
        {currentSection === "story" && (
          <TravelUpdateManager
            trip={selectedTrip}
            areas={areas}
            focusId={recordFocus?.kind === "update" ? recordFocus : null}
          />
        )}
        {currentSection === "packing" && <PackingManager trip={selectedTrip} />}
        {currentSection === "media" && (
          <>
            <DocumentManager trip={selectedTrip} focusId={recordFocus?.kind === "document" ? recordFocus : null} />
            <LinkedLibraryDocuments tripId={selectedTrip.id} />
            <MediaManager
              trip={selectedTrip}
              onStartCaptureFromCandidate={startCaptureFromCandidate}
              focusId={recordFocus?.kind === "media" ? recordFocus : null}
            />
          </>
        )}
        {currentSection === "sharing" && <PublicationManager trip={selectedTrip} />}
      </section>
    );

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
