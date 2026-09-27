import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearch } from "@tanstack/react-router";

import { useAuth } from "../auth-context";
import { EmptyState } from "../tracker-routes";
import { LocationManager } from "../trips/LocationManager";
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
import { CaptureDialog } from "../trips/CaptureDialog";
import { errorMessage } from "../query/api";
import type { DialogFocusRequest } from "../forms/useRecordDialog";
import { useTripResource, useTripsQuery } from "../query/owner-queries";
import { formatInstant, type Trip, type TravelUpdateCandidateIntent } from "../tracker-model";

export type TripWorkspaceSection = "overview" | "plan" | "story" | "media" | "sharing";

export function Trips({ workspace }: { workspace?: { tripId: string; section: TripWorkspaceSection } } = {}) {
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
  const [notice, setNotice] = useState<string | null>(null);
  // An Agenda row, or the private overview arriving from elsewhere, asks the matching manager below to open that record's dialog.
  type RecordKind = AgendaRecordKind | "area" | "task" | "update" | "document" | "media";
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
  const mapFocus = useMemo(() => focusedPoint ? { id: focusedPoint, request: 1 } : null, [focusedPoint]);
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
  const selectedTrip = workspace ? trips.find((trip) => trip.id === workspace.tripId) ?? null : null;
  const selectedId = selectedTrip?.id ?? null;
  const openMapRecord = useCallback((kind: "area" | "visit" | "route" | "update", id: string) => {
    if (selectedId) void navigate({ to: `/trips/${encodeURIComponent(selectedId)}/${kind === "update" ? "story" : "plan"}`, state: { openRecord: { kind, id } } });
  }, [navigate, selectedId]);
  const areas = useTripResource(selectedId, "areas").data ?? [];
  // A page we were sent here from (a deleted trip) can leave a message behind.
  const arrivalNotice = location.state.notice;
  const message = notice ?? arrivalNotice ?? (!session ? "Meld aan om je private reizen te laden."
    : tripsQuery.isError ? errorMessage(tripsQuery.error, "Je reizen konden niet worden geladen.")
    : tripsQuery.isPending ? "Je reizen laden…"
    : trips.length ? "Kies een reis om de private details te beheren." : "Nog geen reizen. Maak je eerste private reis aan.");

  function showOnMap(pointId: string) {
    if (selectedTrip) void navigate({ to: `/trips/${encodeURIComponent(selectedTrip.id)}`, state: { mapFocus: pointId } });
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

  if (!session) return <EmptyState title="Reizen">{message}</EmptyState>;
  if (workspace && !selectedTrip) {
    if (tripsQuery.isPending) return <EmptyState title="Reis laden">{message}</EmptyState>;
    if (tripsQuery.isError) return <EmptyState title="Reis niet beschikbaar">{message}</EmptyState>;
    return <EmptyState title="Reis niet gevonden">Deze private reis bestaat niet of is niet beschikbaar voor jouw account.</EmptyState>;
  }

  const currentSection = workspace?.section ?? "overview";
  const sectionUrl = (section: TripWorkspaceSection) => `/trips/${encodeURIComponent(selectedTrip?.id ?? "")}${section === "overview" ? "" : `/${section}`}`;

  // Every trip-bound manager remounts per trip, so no editor or dialog carries one trip's record into another.
  if (workspace && selectedTrip) return <section className="trips trip-workspace" aria-labelledby="trip-detail-title" key={selectedTrip.id}>
    <Link className="back-link" to="/trips">← Alle reizen</Link>
    <header className="trip-workspace-header">
      <div><p className="eyebrow">Private reis</p><h2 id="trip-detail-title">{selectedTrip.title}</h2><p>{[selectedTrip.starts_on && selectedTrip.ends_on ? `${selectedTrip.starts_on} — ${selectedTrip.ends_on}` : null, `${selectedTrip.travel_updates.length} ${selectedTrip.travel_updates.length === 1 ? "reisupdate" : "reisupdates"}`].filter(Boolean).join(" · ")}</p></div>
      <div className="button-row"><button className="secondary compact" type="button" onClick={() => setEditing(true)}>Reisgegevens</button><Link className="secondary action-link" to={`/trips/${encodeURIComponent(selectedTrip.id)}/details`}>Volledig privéoverzicht</Link><button className="action-link" type="button" onClick={() => setCapturing(true)}>Moment vastleggen</button></div>
    </header>
    <TripEditor key={`edit-${selectedTrip.id}`} trip={selectedTrip} open={editing} onClose={() => setEditing(false)} onSaved={() => undefined} onDeleted={() => void navigate({ to: "/trips", state: { notice: "Reis verwijderd." } })} onNotice={setNotice} />
    <CaptureDialog lockedTripId={selectedTrip.id} candidate={captureCandidate} onCandidateConsumed={() => setCaptureCandidate(null)} open={capturing} onDismiss={closeCapture} />
    <nav className="trip-section-nav" aria-label="Reisonderdelen">
      {([['overview', 'Overzicht'], ['plan', 'Plan'], ['story', 'Verhaal'], ['media', 'Media & documenten'], ['sharing', 'Delen']] as const).map(([section, label]) => <Link key={section} to={sectionUrl(section)} activeOptions={{ exact: section === "overview" }} aria-current={currentSection === section ? "page" : undefined}>{label}</Link>)}
    </nav>
    {(notice ?? arrivalNotice) && <p className="help" role="status">{notice ?? arrivalNotice}</p>}
    {currentSection === "overview" && <><TripOverview trip={selectedTrip} /><OwnerTripMap trip={selectedTrip} areas={areas} focus={mapFocus} onOpenRecord={openMapRecord} /><div className="detail-grid"><section className="card"><h3>Reisupdates</h3>{selectedTrip.travel_updates.length ? <div className="saved-records">{selectedTrip.travel_updates.slice().sort((left, right) => right.occurred_at.localeCompare(left.occurred_at)).map((update) => <div className="update-summary" key={update.id}><strong>{update.title}</strong><span>{formatInstant(update.occurred_at)}</span></div>)}</div> : <p>Nog geen reisupdates. Leg er één vast wanneer je wilt.</p>}</section><TripTaskManager trip={selectedTrip} /></div></>}
    {currentSection === "plan" && <>
      <nav className="plan-jump-nav" aria-label="Planningsonderdelen">
        <a href="#agenda">Agenda</a><a href="#areas">Gebieden</a><a href="#locations">Locaties</a><a href="#visits">Bezoeken</a><a href="#stays">Verblijven</a><a href="#routes">Routes</a><a href="#tasks">Nog te regelen</a>
      </nav>
      <AgendaView trip={selectedTrip} onOpenRecord={openAgendaRecord} />
      <AreaManager trip={selectedTrip} focusId={recordFocus?.kind === "area" ? recordFocus : null} />
      <LocationManager trip={selectedTrip} />
      <VisitManager trip={selectedTrip} onShowOnMap={showOnMap} focusId={recordFocus?.kind === "visit" ? recordFocus : null} />
      <StayManager trip={selectedTrip} areas={areas} focusId={recordFocus?.kind === "stay" ? recordFocus : null} />
      <RouteManager trip={selectedTrip} focusId={recordFocus?.kind === "route" ? recordFocus : null} />
      <TripTaskManager trip={selectedTrip} focusId={recordFocus?.kind === "task" ? recordFocus : null} />
    </>}
    {currentSection === "story" && <TravelUpdateManager trip={selectedTrip} areas={areas} focusId={recordFocus?.kind === "update" ? recordFocus : null} />}
    {currentSection === "media" && <><DocumentManager trip={selectedTrip} focusId={recordFocus?.kind === "document" ? recordFocus : null} /><LinkedLibraryDocuments tripId={selectedTrip.id} /><MediaManager trip={selectedTrip} onStartCaptureFromCandidate={startCaptureFromCandidate} focusId={recordFocus?.kind === "media" ? recordFocus : null} /></>}
    {currentSection === "sharing" && <PublicationManager trip={selectedTrip} />}
  </section>;

  return <section className="trips" aria-labelledby="trips-title">
    <div className="capture-heading"><div><p className="eyebrow">Private reisbeheer</p><h2 id="trips-title">Reizen</h2></div><button className="secondary compact" type="button" onClick={newTrip}>Nieuwe reis</button></div>
    <p className="help" role="status">{message}</p>
    <section className="trip-list" aria-label="Jouw reizen">
      {trips.map((trip) => <button className="trip-row" type="button" key={trip.id} onClick={() => openTrip(trip)}><strong>{trip.title}</strong><span>{trip.travel_updates.length} {trip.travel_updates.length === 1 ? "reisupdate" : "reisupdates"}</span></button>)}
      {!trips.length && <p>Je eerste reis blijft privé totdat je iets deelt.</p>}
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
  </section>;
}
