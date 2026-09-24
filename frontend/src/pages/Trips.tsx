import { useMemo, useState, type FormEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../auth-context";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
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
import { errorMessage, ownerRequest } from "../query/api";
import { useOwner, useRefreshTrip, useTripResource, useTripsQuery } from "../query/owner-queries";
import { timeZoneOptions, type MomentExcerpt, type Trip } from "../tracker-model";

export type TripWorkspaceSection = "overview" | "plan" | "story" | "media" | "sharing";
type BroadPlaceDraft = { id: string | null; label: string; countryCode: string; region: string; latitude: string; longitude: string; timezone?: string };

export function Trips({ workspace }: { workspace?: { tripId: string; section: TripWorkspaceSection } } = {}) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const owner = useOwner();
  const refresh = useRefreshTrip();
  const tripsQuery = useTripsQuery();
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  // undefined: follow the first trip; null: a new trip is being drafted; a string: the chosen trip.
  const [selection, setSelection] = useState<string | null | undefined>(undefined);
  const [excerptDraft, setExcerptDraft] = useState({ id: null as string | null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day" as MomentExcerpt["date_precision"], storyDate: "", title: "", body: "" });
  const [broadPlaceDraft, setBroadPlaceDraft] = useState<BroadPlaceDraft>({ id: null, label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" });
  const [excerptInitial, setExcerptInitial] = useState(excerptDraft);
  const [broadPlaceInitial, setBroadPlaceInitial] = useState(broadPlaceDraft);
  const [excerptEditor, setExcerptEditor] = useState(false);
  const [broadPlaceEditor, setBroadPlaceEditor] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapRevision, setMapRevision] = useState(0);
  const [planRevision, setPlanRevision] = useState(0);
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

  // Stays, transport and tasks refresh their shared queries themselves; the itinerary still reads by revision.
  const bumpPlan = () => setPlanRevision((current) => current + 1);
  const refreshTrips = () => refresh.trips();
  const refreshBroadPlaces = async () => {
    if (!selectedId) return;
    await refresh.resources(selectedId, ["places/broad"]);
    setMapRevision((current) => current + 1);
  };

  function showOnMap(pointId: string) {
    setMapFocus((current) => ({ id: pointId, request: (current?.request ?? 0) + 1 }));
    document.querySelector(".trip-detail .trip-map")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  function resetDrafts() {
    setExcerptDraft({ id: null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day", storyDate: "", title: "", body: "" });
    setBroadPlaceDraft({ id: null, label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" });
  }

  function newTrip() {
    setSelection(null);
    setNotice(null);
    resetDrafts();
  }

  function selectTrip(trip: Trip) {
    setSelection(trip.id);
    setNotice(null);
    resetDrafts();
    if (!workspace) navigate(`/trips/${encodeURIComponent(trip.id)}`);
  }

  function editExcerpt(excerpt: MomentExcerpt) {
    const next = { id: excerpt.id, sourceMomentId: excerpt.source_moment_id ?? "", broadPlaceId: excerpt.broad_place_id ?? "", datePrecision: excerpt.date_precision, storyDate: excerpt.story_date ?? "", title: excerpt.title, body: excerpt.body }; setExcerptDraft(next); setExcerptInitial(next); setExcerptEditor(true);
  }

  function newExcerpt() {
    const next = { id: null as string | null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day" as MomentExcerpt["date_precision"], storyDate: "", title: "", body: "" }; setExcerptDraft(next); setExcerptInitial(next); setExcerptEditor(true);
  }

  async function saveExcerpt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedTrip) return;
    const payload = {
      source_moment_id: excerptDraft.sourceMomentId || null,
      broad_place_id: excerptDraft.broadPlaceId || null,
      date_precision: excerptDraft.datePrecision,
      story_date: excerptDraft.storyDate || null,
      title: excerptDraft.title.trim(),
      body: excerptDraft.body.trim(),
    };
    setNotice(excerptDraft.id ? "Uittreksel opslaan…" : "Uittreksel maken…");
    await ownerRequest(session, excerptDraft.id ? `/api/trips/${selectedTrip.id}/moment-excerpts/${excerptDraft.id}` : `/api/trips/${selectedTrip.id}/moment-excerpts`, "Het uittreksel kon niet worden opgeslagen.", { method: excerptDraft.id ? "PATCH" : "POST", body: payload });
    await refreshTrips();
    setExcerptEditor(false);
    setNotice("Uittreksel opgeslagen. Het is nog niet gedeeld.");
  }

  async function deleteExcerpt(excerpt: MomentExcerpt) {
    if (!session || !selectedTrip) return;
    await ownerRequest(session, `/api/trips/${selectedTrip.id}/moment-excerpts/${excerpt.id}`, "Het uittreksel kon niet worden verwijderd.", { method: "DELETE" });
    await refreshTrips();
    setExcerptEditor(false);
    setNotice("Uittreksel verwijderd.");
  }

  async function saveBroadPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedTrip) return;
    if ((broadPlaceDraft.latitude === "") !== (broadPlaceDraft.longitude === "")) throw new Error("Vul beide brede coördinaten in of laat beide leeg.");
    const countryCode = broadPlaceDraft.countryCode.trim().toUpperCase();
    await ownerRequest(session, broadPlaceDraft.id ? `/api/trips/${selectedTrip.id}/places/broad/${broadPlaceDraft.id}` : `/api/trips/${selectedTrip.id}/places/broad`, "De brede plaats kon niet worden opgeslagen.", {
      method: broadPlaceDraft.id ? "PATCH" : "POST",
      body: {
        label: broadPlaceDraft.label.trim(),
        country_code: countryCode || null,
        region: broadPlaceDraft.region.trim() || null,
        latitude: broadPlaceDraft.latitude === "" ? null : Number(broadPlaceDraft.latitude),
        longitude: broadPlaceDraft.longitude === "" ? null : Number(broadPlaceDraft.longitude),
        timezone: broadPlaceDraft.timezone?.trim() || null,
      },
    });
    await refreshBroadPlaces();
    const next = { id: null as string | null, label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" }; setBroadPlaceDraft(next); setBroadPlaceInitial(next); setBroadPlaceEditor(false);
    setNotice("Brede plaats opgeslagen. Je kunt hem nu bewust aan een uittreksel koppelen.");
  }

  if (!session) return <EmptyState title="Reizen">{message}</EmptyState>;
  if (workspace && !selectedTrip) {
    if (tripsQuery.isPending) return <EmptyState title="Reis laden">{message}</EmptyState>;
    if (tripsQuery.isError) return <EmptyState title="Reis niet beschikbaar">{message}</EmptyState>;
    return <EmptyState title="Reis niet gevonden">Deze private reis bestaat niet of is niet beschikbaar voor jouw account.</EmptyState>;
  }

  const currentSection = workspace?.section ?? "overview";
  const sectionUrl = (section: TripWorkspaceSection) => `/trips/${encodeURIComponent(selectedTrip?.id ?? "")}${section === "overview" ? "" : `/${section}`}`;

  if (workspace && selectedTrip) return <section className="trips trip-workspace" aria-labelledby="trip-detail-title">
    <header className="trip-workspace-header">
      <div><p className="eyebrow">Private reis</p><h2 id="trip-detail-title">{selectedTrip.title}</h2><p>{[selectedTrip.visibility === "private" ? "Privé" : selectedTrip.visibility === "public" ? "Publiek" : "Verborgen link", selectedTrip.starts_on && selectedTrip.ends_on ? `${selectedTrip.starts_on} — ${selectedTrip.ends_on}` : null, `${selectedTrip.moments.length} momenten`].filter(Boolean).join(" · ")}</p></div>
      <div className="button-row"><NavLink className="action-link" to="/trips">Alle reizen</NavLink><NavLink className="action-link" to="/capture">Moment vastleggen</NavLink></div>
    </header>
    <nav className="trip-section-nav" aria-label="Reisonderdelen">
      {([['overview', 'Overzicht'], ['plan', 'Plan'], ['story', 'Verhaal'], ['media', 'Media & documenten'], ['sharing', 'Delen']] as const).map(([section, label]) => <NavLink key={section} to={sectionUrl(section)} end={section === "overview"} aria-current={currentSection === section ? "page" : undefined}>{label}</NavLink>)}
    </nav>
    <p className="help" role="status">{message}</p>
    {currentSection === "plan" && <BroadPlaceManager trip={selectedTrip} onChange={refreshBroadPlaces} />}
    {currentSection === "overview" && <><TripOverview trip={selectedTrip} /><OwnerTripMap trip={selectedTrip} broadPlaces={broadPlaces} revision={mapRevision} focus={mapFocus} /><div className="detail-grid"><section className="card"><h3>Momenten</h3>{selectedTrip.moments.length ? <div className="saved-moments">{selectedTrip.moments.slice().reverse().map((moment) => <div className="moment-summary" key={moment.id}><strong>{moment.title}</strong><span>{new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(moment.occurred_at))}</span></div>)}</div> : <p>Nog geen momenten. Leg er één vast wanneer je wilt.</p>}</section><TripTaskManager trip={selectedTrip} onChange={bumpPlan} /></div></>}
    {currentSection === "plan" && <><RouteStageManager trip={selectedTrip} broadPlaces={broadPlaces} onChange={refreshTrips} /><StayManager trip={selectedTrip} broadPlaces={broadPlaces} onChange={bumpPlan} /><TransportLegManager trip={selectedTrip} onChange={bumpPlan} /><ItineraryPlanManager trip={selectedTrip} revision={planRevision} onShowOnMap={showOnMap} /><TripTaskManager trip={selectedTrip} onChange={bumpPlan} /></>}
    {currentSection === "story" && <><TrackManager trip={selectedTrip} onChange={() => setMapRevision((current) => current + 1)} /><HighlightManager trip={selectedTrip} onChange={refreshTrips} /><section className="card excerpt-editor"><div className="capture-heading"><div><h3>Moment-uittreksels</h3><p>Een uittreksel blijft privé totdat je het expliciet publiceert.</p></div>{excerptDraft.id && <button className="secondary compact" type="button" onClick={newExcerpt}>Nieuw uittreksel</button>}</div><form className="stack-form" onSubmit={(event) => void saveExcerpt(event).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Het uittreksel kon niet worden opgeslagen."))}><label>Titel<input required maxLength={160} value={excerptDraft.title} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, title: event.target.value }))} /></label><label>Uittreksel<textarea required maxLength={10000} rows={5} value={excerptDraft.body} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, body: event.target.value }))} /></label><button type="submit">{excerptDraft.id ? "Uittreksel opslaan" : "Uittreksel maken"}</button></form>{selectedTrip.moment_excerpts.length > 0 && <div className="saved-moments">{selectedTrip.moment_excerpts.map((excerpt) => <article className="excerpt-row" key={excerpt.id}><div><strong>{excerpt.title}</strong><span>{excerpt.date_precision}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => editExcerpt(excerpt)}>Bewerken</button><button className="danger compact" type="button" onClick={() => void deleteExcerpt(excerpt).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Het uittreksel kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}</section></>}
    {currentSection === "story" && <MomentExcerptManager trip={selectedTrip} broadPlaces={broadPlaces} onChange={refreshTrips} />}
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
        onDeleted={() => { setSelection(null); resetDrafts(); }}
        onNotice={setNotice}
      />
    </div>
    {selectedTrip && <section className="trip-detail" aria-labelledby="trip-detail-title">
      <div className="capture-heading"><div><p className="eyebrow">{selectedTrip.title}</p><h3 id="trip-detail-title">Private inhoud</h3></div><div className="button-row"><NavLink className="action-link" to={`/trips/${encodeURIComponent(selectedTrip.id)}`}>Reis bekijken</NavLink><NavLink className="action-link" to="/capture">Moment vastleggen</NavLink></div></div>
      <TripOverview trip={selectedTrip} />
      <OwnerTripMap trip={selectedTrip} broadPlaces={broadPlaces} revision={mapRevision} focus={mapFocus} />
      <div className="detail-grid">
        <section className="card"><h3 id="moments-title">Momenten</h3>{selectedTrip.moments.length ? <div className="saved-moments">{selectedTrip.moments.slice().reverse().map((moment) => <div className="moment-summary" key={moment.id}><strong>{moment.title}</strong><span>{new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(moment.occurred_at))}{moment.place ? ` · ${moment.place.display_name ?? moment.place.locality ?? "exacte plaats"}` : ""}</span></div>)}</div> : <p>Nog geen momenten. Leg er één vast wanneer je wilt.</p>}</section>
        <section className="card"><div className="capture-heading"><h3>Brede plaatsen</h3><button className="secondary compact" type="button" onClick={() => { const next = { id: null as string | null, label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" }; setBroadPlaceDraft(next); setBroadPlaceInitial(next); setBroadPlaceEditor(true); }}>Brede plaats toevoegen</button></div>{broadPlaces.length ? <div className="saved-moments">{broadPlaces.map((place) => <div className="moment-summary" key={place.id}><strong>{place.label}</strong><span>{[place.region, place.country_code, place.timezone].filter(Boolean).join(" · ") || "Alleen voor deze reis"}</span><button className="secondary compact" type="button" onClick={() => { const next = { id: place.id, label: place.label, countryCode: place.country_code ?? "", region: place.region ?? "", latitude: place.latitude?.toString() ?? "", longitude: place.longitude?.toString() ?? "" }; setBroadPlaceDraft(next); setBroadPlaceInitial(next); setBroadPlaceEditor(true); }}>Bewerken</button></div>)}</div> : <p>Voeg een bewust algemene plaats toe om die eventueel aan een uittreksel te koppelen.</p>}</section>
      </div>
      <BroadPlaceManager trip={selectedTrip} onChange={refreshBroadPlaces} />
      <RecordDialog open={broadPlaceEditor} title={broadPlaceDraft.id ? "Brede plaats bewerken" : "Brede plaats toevoegen"} dirty={JSON.stringify(broadPlaceDraft) !== JSON.stringify(broadPlaceInitial)} onDismiss={() => setBroadPlaceEditor(false)}><p>Gebruik een bewust algemene plaats, zoals een stad of regio. Voeg alleen een zelf gekozen, gegeneraliseerd kaartpunt toe.</p><form className="stack-form" onSubmit={(event) => void saveBroadPlace(event).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "De brede plaats kon niet worden opgeslagen."))}><div className="field-row"><label>Naam<input required maxLength={120} value={broadPlaceDraft.label} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="Bijvoorbeeld: Taipei" /></label><label>Landcode <span className="optional">(optioneel)</span><input maxLength={2} value={broadPlaceDraft.countryCode} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, countryCode: event.target.value }))} placeholder="TW" /></label></div><div className="field-row"><label>Regio <span className="optional">(optioneel)</span><input maxLength={120} value={broadPlaceDraft.region} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, region: event.target.value }))} placeholder="Taipei City" /></label><label>Tijdzone <span className="optional">(optioneel, privé)</span><input list="broad-place-time-zones" maxLength={64} value={broadPlaceDraft.timezone} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, timezone: event.target.value }))} placeholder="Asia/Taipei" /></label></div><datalist id="broad-place-time-zones">{timeZoneOptions().map((zone) => <option key={zone} value={zone} />)}</datalist><p className="help">Met een tijdzone toont het reisoverzicht de lokale tijd ter plaatse, zomertijd inbegrepen.</p><div className="field-row"><label>Brede breedtegraad <span className="optional">(optioneel)</span><input type="number" min={-90} max={90} step="any" value={broadPlaceDraft.latitude} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, latitude: event.target.value }))} /></label><label>Brede lengtegraad <span className="optional">(optioneel)</span><input type="number" min={-180} max={180} step="any" value={broadPlaceDraft.longitude} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, longitude: event.target.value }))} /></label></div><p className="help">Vul beide coördinaten in, of laat beide leeg. Gedeelde kaarten tonen dit punt alleen wanneer je de plaats en coördinaten publiceert.</p><button type="submit">Brede plaats opslaan</button></form></RecordDialog>
      <RouteStageManager trip={selectedTrip} broadPlaces={broadPlaces} onChange={refreshTrips} />
      <TrackManager trip={selectedTrip} onChange={() => setMapRevision((current) => current + 1)} />
      <StayManager trip={selectedTrip} broadPlaces={broadPlaces} onChange={bumpPlan} />
      <TransportLegManager trip={selectedTrip} onChange={bumpPlan} />
      <ItineraryPlanManager trip={selectedTrip} revision={planRevision} onShowOnMap={showOnMap} />
      <TripTaskManager trip={selectedTrip} onChange={bumpPlan} />
      <HighlightManager trip={selectedTrip} onChange={refreshTrips} />
      <section className="card excerpt-editor"><div className="capture-heading"><div><h3>Moment-uittreksels</h3><p>Een uittreksel is afzonderlijk geschreven en blijft privé totdat je het expliciet publiceert.</p></div>{excerptDraft.id && <button className="secondary compact" type="button" onClick={newExcerpt}>Nieuw uittreksel</button>}</div>
        <form className="stack-form" onSubmit={(event) => void saveExcerpt(event).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Het uittreksel kon niet worden opgeslagen."))}>
          <div className="field-row"><label>Bronmoment <span className="optional">(optioneel)</span><select value={excerptDraft.sourceMomentId} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, sourceMomentId: event.target.value }))}><option value="">Geen bronmoment</option>{selectedTrip.moments.map((moment) => <option key={moment.id} value={moment.id}>{moment.title}</option>)}</select></label><label>Datumprecisie<select value={excerptDraft.datePrecision} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, datePrecision: event.target.value as MomentExcerpt["date_precision"] }))}><option value="day">Dag</option><option value="month">Maand</option><option value="year">Jaar</option></select></label></div>
          <div className="field-row"><label>Verhaalsdatum <span className="optional">(optioneel)</span><input type="date" value={excerptDraft.storyDate} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, storyDate: event.target.value }))} /></label><label>Brede plaats <span className="optional">(optioneel)</span><select value={excerptDraft.broadPlaceId} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, broadPlaceId: event.target.value }))}><option value="">Geen plaats</option>{broadPlaces.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label></div>
          <label>Titel<input required maxLength={160} value={excerptDraft.title} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, title: event.target.value }))} /></label><label>Uittreksel<textarea required maxLength={10000} rows={5} value={excerptDraft.body} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, body: event.target.value }))} /></label>
          <button type="submit">{excerptDraft.id ? "Uittreksel opslaan" : "Uittreksel maken"}</button>
        </form>
        {selectedTrip.moment_excerpts.length > 0 && <div className="saved-moments">{selectedTrip.moment_excerpts.map((excerpt) => <article className="excerpt-row" key={excerpt.id}><div><strong>{excerpt.title}</strong><span>{excerpt.date_precision} · {excerpt.broad_place_id ? broadPlaces.find((place) => place.id === excerpt.broad_place_id)?.label ?? "brede plaats" : "geen plaats"}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => editExcerpt(excerpt)}>Bewerken</button><button className="danger compact" type="button" onClick={() => void deleteExcerpt(excerpt).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Het uittreksel kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
      </section>
      <MomentExcerptManager trip={selectedTrip} broadPlaces={broadPlaces} onChange={refreshTrips} />
      <DocumentManager trip={selectedTrip} />
      <LinkedLibraryDocuments tripId={selectedTrip.id} />
      <MediaManager trip={selectedTrip} />
      <PublicationManager trip={selectedTrip} />
    </section>}
  </section>;
}
