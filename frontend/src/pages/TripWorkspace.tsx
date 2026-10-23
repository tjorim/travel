import { Navigate, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "../auth-context";
import { useCapture } from "../capture-context";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useFeedback } from "../query/feedback";
import { useTripResource, useTripsQuery } from "../query/owner-queries";
import type { TravelUpdateCandidateIntent } from "../tracker-model";
import { EmptyState } from "@/ui/EmptyState";
import type { AgendaRecordKind } from "../trips/AgendaView";
import type { MapRecordKind, RecordFocus } from "../trips/record-focus";
import { tripsStatusMessage } from "../trips/trips-status";
import { TripEditor } from "../trips/TripEditor";
import { WorkspaceHeader } from "../trips/WorkspaceHeader";
import { WorkspaceSearch } from "../trips/WorkspaceSearch";
import { WorkspaceTabs } from "../trips/WorkspaceTabs";
import {
  DEFAULT_SECTION,
  resolveSection,
  sectionById,
  sectionForRecord,
  sectionPath,
  type TripWorkspaceSection,
} from "../trips/workspace-sections";

/** The `/trips/$tripId[/$section]` route. */
export function TripWorkspace() {
  const { tripId, section } = useParams({ strict: false });
  if (!tripId) return <Navigate to="/trips" replace />;
  const resolved = section ? resolveSection(section) : DEFAULT_SECTION;
  // An unknown section falls back to the overview; a merged one redirects to where its content now lives.
  if (!resolved) return <Navigate to={sectionPath(tripId, DEFAULT_SECTION)} replace />;
  if (section && section !== resolved)
    return <Navigate to={sectionPath(tripId, resolved)} replace />;
  return <TripWorkspaceView tripId={tripId} section={resolved} />;
}

export function TripWorkspaceView({
  tripId,
  section,
}: {
  tripId: string;
  section: TripWorkspaceSection;
}) {
  useLocale();
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const tripsQuery = useTripsQuery();
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const [editing, setEditing] = useState(false);
  const openCapture = useCapture();
  const [notice, setNotice] = useFeedback<string | null>(null);
  // An Agenda row, or the private overview arriving from elsewhere, asks the matching manager below to open that record's dialog.
  const [recordFocus, setRecordFocus] = useState<RecordFocus | null>(null);
  const openAgendaRecord = (kind: AgendaRecordKind, id: string) =>
    setRecordFocus({ kind, id, token: Date.now() });
  const openRecordRequest = location.state.openRecord;
  const openRecordKind = openRecordRequest?.kind;
  const openRecordId = openRecordRequest?.id;
  const openRecordToken = openRecordRequest?.token;
  useEffect(() => {
    if (openRecordKind && openRecordId)
      setRecordFocus({ kind: openRecordKind, id: openRecordId, token: Date.now() });
  }, [openRecordKind, openRecordId, openRecordToken]);
  // "Toon op kaart" elsewhere in the workspace opens the overview, whose map focuses that point.
  const focusedPoint = location.state.mapFocus;
  const mapFocus = useMemo(
    () => (focusedPoint ? { id: focusedPoint, request: 1 } : null),
    [focusedPoint],
  );
  useEffect(() => {
    if (!focusedPoint) return;
    // The map mounts a little after the overview, so wait for it before scrolling.
    let attempts = 0;
    const timer = window.setInterval(() => {
      const map = document.querySelector("[data-trip-map]");
      if (!map && ++attempts <= 30) return;
      window.clearInterval(timer);
      map?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 100);
    return () => window.clearInterval(timer);
  }, [focusedPoint]);

  const trip = trips.find((candidate) => candidate.id === tripId) ?? null;
  const selectedId = trip?.id ?? null;
  const openMapRecord = useCallback(
    (kind: MapRecordKind, id: string) => {
      if (selectedId)
        void navigate({
          to: sectionPath(selectedId, sectionForRecord(kind)),
          state: { openRecord: { kind, id } },
        });
    },
    [navigate, selectedId],
  );
  const areas = useTripResource(selectedId, "areas").data ?? [];
  // A page we were sent here from (a deleted trip) can leave a message behind.
  const arrivalNotice =
    location.state.notice === "trip_deleted" ? m.owner_trip_deleted() : undefined;
  const message = notice ?? arrivalNotice ?? tripsStatusMessage(session, tripsQuery, trips);

  function showOnMap(pointId: string) {
    if (trip)
      void navigate({
        to: `/trips/${encodeURIComponent(trip.id)}`,
        state: { mapFocus: pointId },
      });
  }

  const startCaptureFromCandidate = (candidate: TravelUpdateCandidateIntent) =>
    openCapture({ tripId, candidate });

  if (!session) return <EmptyState title={m.trips()}>{message}</EmptyState>;
  if (!trip) {
    if (tripsQuery.isPending) return <EmptyState title={m.loading_trip()}>{message}</EmptyState>;
    if (tripsQuery.isError) return <EmptyState title={m.unavailable_trip()}>{message}</EmptyState>;
    return <EmptyState title={m.trip_not_found()}>{m.owner_trip_unavailable()}</EmptyState>;
  }

  const Section = sectionById(section).component;

  // Every trip-bound manager remounts per trip, so no editor or dialog carries one trip's record into another.
  return (
    <section className="grid grid-cols-1 gap-4.5" aria-labelledby="trip-detail-title" key={trip.id}>
      <WorkspaceHeader trip={trip} onEdit={() => setEditing(true)} />
      <TripEditor
        key={`edit-${trip.id}`}
        trip={trip}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={() => undefined}
        onDeleted={() => void navigate({ to: "/trips", state: { notice: "trip_deleted" } })}
        onNotice={setNotice}
      />
      <WorkspaceTabs tripId={trip.id} current={section} />
      <WorkspaceSearch tripId={trip.id} />
      {(notice ?? arrivalNotice) && (
        <p className="help" role="status">
          {notice ?? arrivalNotice}
        </p>
      )}
      <Section
        trip={trip}
        areas={areas}
        recordFocus={recordFocus}
        mapFocus={mapFocus}
        onOpenMapRecord={openMapRecord}
        onOpenAgendaRecord={openAgendaRecord}
        onShowOnMap={showOnMap}
        onStartCaptureFromCandidate={startCaptureFromCandidate}
      />
    </section>
  );
}
