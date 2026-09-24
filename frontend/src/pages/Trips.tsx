import { useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../auth-context";
import { EmptyState } from "../tracker-routes";
import { DocumentManager } from "../trips/DocumentManager";
import { LinkedLibraryDocuments } from "../library/LinkedLibraryDocuments";
import { ItineraryPlanManager } from "../trips/ItineraryPlanManager";
import { HighlightManager } from "../trips/HighlightManager";
import { BroadPlaceManager } from "../trips/BroadPlaceManager";
import { MomentExcerptManager } from "../trips/MomentExcerptManager";
import { MediaManager } from "../trips/MediaManager";
import { OwnerTripMap } from "../trips/OwnerTripMap";
import { PublicationManager } from "../trips/PublicationManager";
import { RouteStageManager } from "../trips/RouteStageManager";
import { StayManager } from "../trips/StayManager";
import { TrackManager } from "../trips/TrackManager";
import { TransportLegManager } from "../trips/TransportLegManager";
import { TripEditor } from "../trips/TripEditor";
import { TripOverview } from "../trips/TripOverview";
import { TripTaskManager } from "../trips/TripTaskManager";
import { errorMessage } from "../query/api";
import { useTripResource, useTripsQuery } from "../query/owner-queries";
import type { Trip } from "../tracker-model";

export type TripWorkspaceSection = "overview" | "plan" | "story" | "media" | "sharing";

export function Trips({ workspace }: { workspace?: { tripId: string; section: TripWorkspaceSection } } = {}) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const tripsQuery = useTripsQuery();
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  // undefined: follow the first trip; null: a new trip is being drafted; a string: the chosen trip.
  const [selection, setSelection] = useState<string | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapFocus, setMapFocus] = useState<{ id: string; request: number } | null>(null);

  const selectedTrip = workspace
    ? trips.find((trip) => trip.id === workspace.tripId) ?? null
    : selection === null ? null : trips.find((trip) => trip.id === selection) ?? trips[0] ?? null;
  const selectedId = selectedTrip?.id ?? null;
  const broadPlaces = useTripResource(selectedId, "places/broad").data ?? [];
  const message = notice ?? (!session ? "Meld aan om je private reizen te laden."
    : tripsQuery.isError ? errorMessage(tripsQuery.error, "Je reizen konden niet worden geladen.")
    : tripsQuery.isPending ? "Je reizen laden…"
    : trips.length ? "Kies een reis om de private details te beheren." : "Nog geen reizen. Maak je eerste private reis aan.");

  function showOnMap(pointId: string) {
    setMapFocus((current) => ({ id: pointId, request: (current?.request ?? 0) + 1 }));
    document.querySelector(".trip-detail .trip-map")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  function newTrip() {
    setSelection(null);
    setNotice(null);
  }

  function selectTrip(trip: Trip) {
    setSelection(trip.id);
    setNotice(null);
    if (!workspace) navigate(`/trips/${encodeURIComponent(trip.id)}`);
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
    <header className="trip-workspace-header">
      <div><p className="eyebrow">Private reis</p><h2 id="trip-detail-title">{selectedTrip.title}</h2><p>{[selectedTrip.visibility === "private" ? "Privé" : selectedTrip.visibility === "public" ? "Publiek" : "Verborgen link", selectedTrip.starts_on && selectedTrip.ends_on ? `${selectedTrip.starts_on} — ${selectedTrip.ends_on}` : null, `${selectedTrip.moments.length} momenten`].filter(Boolean).join(" · ")}</p></div>
      <div className="button-row"><NavLink className="action-link" to="/trips">Alle reizen</NavLink><NavLink className="action-link" to="/capture">Moment vastleggen</NavLink></div>
    </header>
    <nav className="trip-section-nav" aria-label="Reisonderdelen">
      {([['overview', 'Overzicht'], ['plan', 'Plan'], ['story', 'Verhaal'], ['media', 'Media & documenten'], ['sharing', 'Delen']] as const).map(([section, label]) => <NavLink key={section} to={sectionUrl(section)} end={section === "overview"} aria-current={currentSection === section ? "page" : undefined}>{label}</NavLink>)}
    </nav>
    <p className="help" role="status">{message}</p>
    {currentSection === "plan" && <BroadPlaceManager trip={selectedTrip} />}
    {currentSection === "overview" && <><TripOverview trip={selectedTrip} /><OwnerTripMap trip={selectedTrip} broadPlaces={broadPlaces} focus={mapFocus} /><div className="detail-grid"><section className="card"><h3>Momenten</h3>{selectedTrip.moments.length ? <div className="saved-moments">{selectedTrip.moments.slice().reverse().map((moment) => <div className="moment-summary" key={moment.id}><strong>{moment.title}</strong><span>{new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(moment.occurred_at))}</span></div>)}</div> : <p>Nog geen momenten. Leg er één vast wanneer je wilt.</p>}</section><TripTaskManager trip={selectedTrip} /></div></>}
    {currentSection === "plan" && <><RouteStageManager trip={selectedTrip} broadPlaces={broadPlaces} /><StayManager trip={selectedTrip} broadPlaces={broadPlaces} /><TransportLegManager trip={selectedTrip} /><ItineraryPlanManager trip={selectedTrip} onShowOnMap={showOnMap} /><TripTaskManager trip={selectedTrip} /></>}
    {currentSection === "story" && <><TrackManager trip={selectedTrip} /><HighlightManager trip={selectedTrip} /><MomentExcerptManager trip={selectedTrip} broadPlaces={broadPlaces} /></>}
    {currentSection === "media" && <><DocumentManager trip={selectedTrip} /><LinkedLibraryDocuments tripId={selectedTrip.id} /><MediaManager trip={selectedTrip} /></>}
    {currentSection === "sharing" && <PublicationManager trip={selectedTrip} />}
  </section>;

  return <section className="trips" aria-labelledby="trips-title">
    <div className="capture-heading"><div><p className="eyebrow">Private reisbeheer</p><h2 id="trips-title">Reizen</h2></div><button className="secondary compact" type="button" onClick={newTrip}>Nieuwe reis</button></div>
    <p className="help" role="status">{message}</p>
    <div className="trip-layout">
      <section className="trip-list" aria-label="Jouw reizen">
        {trips.map((trip) => <button className={`trip-row ${trip.id === selectedId ? "selected" : ""}`} type="button" key={trip.id} onClick={() => selectTrip(trip)}><strong>{trip.title}</strong><span>{trip.visibility === "private" ? "Privé" : trip.visibility === "public" ? "Publiek" : "Verborgen link"} · {trip.moments.length} momenten</span></button>)}
        {!trips.length && <p>Je eerste reis begint privé en als concept.</p>}
      </section>
      <TripEditor
        key={selectedTrip?.id ?? "new"}
        trip={selectedTrip}
        onSaved={(saved, created) => { setSelection(saved.id); if (created) navigate(`/trips/${encodeURIComponent(saved.id)}`); }}
        onDeleted={() => setSelection(null)}
        onNotice={setNotice}
      />
    </div>
    {selectedTrip && <section className="trip-detail" aria-labelledby="trip-detail-title" key={selectedTrip.id}>
      <div className="capture-heading"><div><p className="eyebrow">{selectedTrip.title}</p><h3 id="trip-detail-title">Private inhoud</h3></div><div className="button-row"><NavLink className="action-link" to={`/trips/${encodeURIComponent(selectedTrip.id)}`}>Reis bekijken</NavLink><NavLink className="action-link" to="/capture">Moment vastleggen</NavLink></div></div>
      <TripOverview trip={selectedTrip} />
      <OwnerTripMap trip={selectedTrip} broadPlaces={broadPlaces} focus={mapFocus} />
      <div className="detail-grid">
        <section className="card"><h3 id="moments-title">Momenten</h3>{selectedTrip.moments.length ? <div className="saved-moments">{selectedTrip.moments.slice().reverse().map((moment) => <div className="moment-summary" key={moment.id}><strong>{moment.title}</strong><span>{new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(moment.occurred_at))}{moment.place ? ` · ${moment.place.display_name ?? moment.place.locality ?? "exacte plaats"}` : ""}</span></div>)}</div> : <p>Nog geen momenten. Leg er één vast wanneer je wilt.</p>}</section>
      </div>
      <BroadPlaceManager trip={selectedTrip} />
      <RouteStageManager trip={selectedTrip} broadPlaces={broadPlaces} />
      <TrackManager trip={selectedTrip} />
      <StayManager trip={selectedTrip} broadPlaces={broadPlaces} />
      <TransportLegManager trip={selectedTrip} />
      <ItineraryPlanManager trip={selectedTrip} onShowOnMap={showOnMap} />
      <TripTaskManager trip={selectedTrip} />
      <HighlightManager trip={selectedTrip} />
      <MomentExcerptManager trip={selectedTrip} broadPlaces={broadPlaces} />
      <DocumentManager trip={selectedTrip} />
      <LinkedLibraryDocuments tripId={selectedTrip.id} />
      <MediaManager trip={selectedTrip} />
      <PublicationManager trip={selectedTrip} />
    </section>}
  </section>;
}
