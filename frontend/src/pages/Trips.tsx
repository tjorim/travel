import { useEffect, useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../auth-context";
import { EmptyState } from "../tracker-routes";
import { DocumentManager } from "../trips/DocumentManager";
import { LinkedLibraryDocuments } from "../library/LinkedLibraryDocuments";
import { ItineraryPlanManager } from "../trips/ItineraryPlanManager";
import { HighlightManager } from "../trips/HighlightManager";
import { MediaManager } from "../trips/MediaManager";
import { OwnerTripMap } from "../trips/OwnerTripMap";
import { PublicationManager } from "../trips/PublicationManager";
import { RouteStageManager } from "../trips/RouteStageManager";
import { StayManager } from "../trips/StayManager";
import { TrackManager } from "../trips/TrackManager";
import { TransportLegManager } from "../trips/TransportLegManager";
import { TripOverview } from "../trips/TripOverview";
import { TripTaskManager } from "../trips/TripTaskManager";
import { apiError, apiHeaders, timeZoneOptions, type BroadPlace, type MomentExcerpt, type Trip } from "../tracker-model";

export function Trips() {
  const { session } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tripDraft, setTripDraft] = useState({ title: "", summary: "", startsOn: "", endsOn: "", visibility: "private" as Trip["visibility"], publicationState: "draft" as Trip["publication_state"] });
  const [excerptDraft, setExcerptDraft] = useState({ id: null as string | null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day" as MomentExcerpt["date_precision"], storyDate: "", title: "", body: "" });
  const [broadPlaceDraft, setBroadPlaceDraft] = useState({ id: null as string | null, label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" });
  const [broadPlaces, setBroadPlaces] = useState<BroadPlace[]>([]);
  const [message, setMessage] = useState("Meld aan om je private reizen te laden.");
  const [mapRevision, setMapRevision] = useState(0);
  const [planRevision, setPlanRevision] = useState(0);
  const [mapFocus, setMapFocus] = useState<{ id: string; request: number } | null>(null);
  const bumpPlan = () => setPlanRevision((current) => current + 1);

  function showOnMap(pointId: string) {
    setMapFocus((current) => ({ id: pointId, request: (current?.request ?? 0) + 1 }));
    document.querySelector(".trip-detail .trip-map")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  async function loadTrips(selectId?: string | null) {
    if (!session) return;
    const response = await fetch("/api/trips", { headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Je reizen konden niet worden geladen.");
    const loaded = await response.json() as Trip[];
    setTrips(loaded);
    setSelectedId((current) => selectId === null ? null : loaded.some((trip) => trip.id === (selectId ?? current)) ? (selectId ?? current) : loaded[0]?.id ?? null);
    setMessage(loaded.length ? "Kies een reis om de private details te beheren." : "Nog geen reizen. Maak je eerste private reis aan.");
  }

  useEffect(() => {
    if (!session) return;
    void loadTrips()
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je reizen konden niet worden geladen."));
  }, [session]);

  const selectedTrip = trips.find((trip) => trip.id === selectedId) ?? null;

  useEffect(() => {
    if (!session || !selectedId) {
      setBroadPlaces([]);
      return;
    }
    void fetch(`/api/trips/${selectedId}/places/broad`, { headers: apiHeaders(session) })
      .then((response) => response.ok ? response.json() as Promise<BroadPlace[]> : apiError(response, "De brede plaatsen konden niet worden geladen."))
      .then(setBroadPlaces)
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De brede plaatsen konden niet worden geladen."));
  }, [selectedId, session]);

  function newTrip() {
    setSelectedId(null);
    setTripDraft({ title: "", summary: "", startsOn: "", endsOn: "", visibility: "private", publicationState: "draft" });
    setExcerptDraft({ id: null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day", storyDate: "", title: "", body: "" });
    setBroadPlaceDraft({ id: null, label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" });
  }

  function selectTrip(trip: Trip) {
    setSelectedId(trip.id);
    setTripDraft({ title: trip.title, summary: trip.summary ?? "", startsOn: trip.starts_on ?? "", endsOn: trip.ends_on ?? "", visibility: trip.visibility, publicationState: trip.publication_state });
    setExcerptDraft({ id: null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day", storyDate: "", title: "", body: "" });
    setBroadPlaceDraft({ id: null, label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" });
  }

  async function saveTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const isNew = !selectedTrip;
    const details = { title: tripDraft.title.trim(), summary: tripDraft.summary.trim() || null, starts_on: tripDraft.startsOn || null, ends_on: tripDraft.endsOn || null };
    const payload = isNew ? details : { ...details, visibility: tripDraft.visibility, publication_state: tripDraft.publicationState };
    setMessage(isNew ? "Reis maken…" : "Reis opslaan…");
    const response = await fetch(isNew ? "/api/trips" : `/api/trips/${selectedTrip.id}`, {
      method: isNew ? "POST" : "PATCH", headers: apiHeaders(session), body: JSON.stringify(payload),
    });
    if (!response.ok) return apiError(response, "De reis kon niet worden opgeslagen.");
    const saved = await response.json() as Trip;
    await loadTrips(saved.id);
    setTripDraft({ title: saved.title, summary: saved.summary ?? "", startsOn: saved.starts_on ?? "", endsOn: saved.ends_on ?? "", visibility: saved.visibility, publicationState: saved.publication_state });
    setMessage(isNew ? "Private reis gemaakt." : "Reis opgeslagen.");
  }

  async function deleteTrip() {
    if (!session || !selectedTrip || !window.confirm(`Verwijder ${selectedTrip.title} met alle private inhoud?`)) return;
    const response = await fetch(`/api/trips/${selectedTrip.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De reis kon niet worden verwijderd.");
    await loadTrips(null);
    newTrip();
    setMessage("Reis verwijderd.");
  }

  function editExcerpt(excerpt: MomentExcerpt) {
    setExcerptDraft({ id: excerpt.id, sourceMomentId: excerpt.source_moment_id ?? "", broadPlaceId: excerpt.broad_place_id ?? "", datePrecision: excerpt.date_precision, storyDate: excerpt.story_date ?? "", title: excerpt.title, body: excerpt.body });
  }

  function newExcerpt() {
    setExcerptDraft({ id: null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day", storyDate: "", title: "", body: "" });
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
    setMessage(excerptDraft.id ? "Uittreksel opslaan…" : "Uittreksel maken…");
    const response = await fetch(excerptDraft.id ? `/api/trips/${selectedTrip.id}/moment-excerpts/${excerptDraft.id}` : `/api/trips/${selectedTrip.id}/moment-excerpts`, {
      method: excerptDraft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify(payload),
    });
    if (!response.ok) return apiError(response, "Het uittreksel kon niet worden opgeslagen.");
    await loadTrips(selectedTrip.id);
    newExcerpt();
    setMessage("Uittreksel opgeslagen. Het is nog niet gedeeld.");
  }

  async function deleteExcerpt(excerpt: MomentExcerpt) {
    if (!session || !selectedTrip || !window.confirm(`Verwijder uittreksel “${excerpt.title}”?`)) return;
    const response = await fetch(`/api/trips/${selectedTrip.id}/moment-excerpts/${excerpt.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Het uittreksel kon niet worden verwijderd.");
    await loadTrips(selectedTrip.id);
    newExcerpt();
    setMessage("Uittreksel verwijderd.");
  }

  async function saveBroadPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedTrip) return;
    if ((broadPlaceDraft.latitude === "") !== (broadPlaceDraft.longitude === "")) throw new Error("Vul beide brede coördinaten in of laat beide leeg.");
    const countryCode = broadPlaceDraft.countryCode.trim().toUpperCase();
    const response = await fetch(broadPlaceDraft.id ? `/api/trips/${selectedTrip.id}/places/broad/${broadPlaceDraft.id}` : `/api/trips/${selectedTrip.id}/places/broad`, {
      method: broadPlaceDraft.id ? "PATCH" : "POST",
      headers: apiHeaders(session),
      body: JSON.stringify({
        label: broadPlaceDraft.label.trim(),
        country_code: countryCode || null,
        region: broadPlaceDraft.region.trim() || null,
        latitude: broadPlaceDraft.latitude === "" ? null : Number(broadPlaceDraft.latitude),
        longitude: broadPlaceDraft.longitude === "" ? null : Number(broadPlaceDraft.longitude),
        timezone: broadPlaceDraft.timezone.trim() || null,
      }),
    });
    if (!response.ok) return apiError(response, "De brede plaats kon niet worden opgeslagen.");
    const saved = await response.json() as BroadPlace;
    setBroadPlaces((current) => broadPlaceDraft.id ? current.map((place) => place.id === saved.id ? saved : place) : [...current, saved]);
    setBroadPlaceDraft({ id: null, label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" });
    setMessage("Brede plaats opgeslagen. Je kunt hem nu bewust aan een uittreksel koppelen.");
  }

  if (!session) return <EmptyState title="Reizen">{message}</EmptyState>;

  return <section className="trips" aria-labelledby="trips-title">
    <div className="capture-heading"><div><p className="eyebrow">Private reisbeheer</p><h2 id="trips-title">Reizen</h2></div><button className="secondary compact" type="button" onClick={newTrip}>Nieuwe reis</button></div>
    <p className="help" role="status">{message}</p>
    <div className="trip-layout">
      <section className="trip-list" aria-label="Jouw reizen">
        {trips.map((trip) => <button className={`trip-row ${trip.id === selectedId ? "selected" : ""}`} type="button" key={trip.id} onClick={() => selectTrip(trip)}><strong>{trip.title}</strong><span>{trip.visibility === "private" ? "Privé" : trip.visibility === "public" ? "Publiek" : "Verborgen link"} · {trip.moments.length} momenten</span></button>)}
        {!trips.length && <p>Je eerste reis begint privé en als concept.</p>}
      </section>
      <section className="card">
        <h3>{selectedTrip ? "Reis bewerken" : "Nieuwe reis"}</h3>
        <form className="stack-form" onSubmit={(event) => void saveTrip(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De reis kon niet worden opgeslagen."))}>
          <label>Titel<input required maxLength={160} value={tripDraft.title} onChange={(event) => setTripDraft((draft) => ({ ...draft, title: event.target.value }))} /></label>
          <label>Samenvatting <span className="optional">(optioneel)</span><textarea maxLength={4000} rows={4} value={tripDraft.summary} onChange={(event) => setTripDraft((draft) => ({ ...draft, summary: event.target.value }))} /></label>
          <div className="field-row"><label>Eerste reisdag <span className="optional">(optioneel)</span><input type="date" value={tripDraft.startsOn} onChange={(event) => setTripDraft((draft) => ({ ...draft, startsOn: event.target.value }))} /></label><label>Laatste reisdag <span className="optional">(optioneel)</span><input type="date" min={tripDraft.startsOn || undefined} value={tripDraft.endsOn} onChange={(event) => setTripDraft((draft) => ({ ...draft, endsOn: event.target.value }))} /></label></div>
          {selectedTrip && <><label>Zichtbaarheid<select value={tripDraft.visibility} onChange={(event) => setTripDraft((draft) => ({ ...draft, visibility: event.target.value as Trip["visibility"], publicationState: event.target.value === "private" ? "draft" : draft.publicationState }))}><option value="private">Privé</option><option value="unlisted">Verborgen link</option><option value="public">Publiek</option></select></label><label>Publicatie<select value={tripDraft.publicationState} onChange={(event) => setTripDraft((draft) => ({ ...draft, publicationState: event.target.value as Trip["publication_state"] }))}><option value="draft">Concept</option><option value="published" disabled={tripDraft.visibility === "private"}>Gepubliceerd</option></select></label><p className="help">Zichtbaarheid maakt niets automatisch deelbaar: kies aparte publicaties wanneer je klaar bent.</p></>}
          <div className="button-row"><button type="submit">{selectedTrip ? "Reis opslaan" : "Reis maken"}</button>{selectedTrip && <button className="danger compact" type="button" onClick={() => void deleteTrip().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De reis kon niet worden verwijderd."))}>Reis verwijderen</button>}</div>
        </form>
      </section>
    </div>
    {selectedTrip && <section className="trip-detail" aria-labelledby="trip-detail-title">
      <div className="capture-heading"><div><p className="eyebrow">{selectedTrip.title}</p><h3 id="trip-detail-title">Private inhoud</h3></div><div className="button-row"><NavLink className="action-link" to={`/trips/${encodeURIComponent(selectedTrip.id)}`}>Reis bekijken</NavLink><NavLink className="action-link" to="/capture">Moment vastleggen</NavLink></div></div>
      <TripOverview trip={selectedTrip} revision={planRevision} />
      <OwnerTripMap trip={selectedTrip} broadPlaces={broadPlaces} revision={mapRevision} focus={mapFocus} />
      <div className="detail-grid">
        <section className="card"><h3 id="moments-title">Momenten</h3>{selectedTrip.moments.length ? <div className="saved-moments">{selectedTrip.moments.slice().reverse().map((moment) => <div className="moment-summary" key={moment.id}><strong>{moment.title}</strong><span>{new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(moment.occurred_at))}{moment.place ? ` · ${moment.place.display_name ?? moment.place.locality ?? "exacte plaats"}` : ""}</span></div>)}</div> : <p>Nog geen momenten. Leg er één vast wanneer je wilt.</p>}</section>
        <section className="card"><h3>Brede plaatsen</h3>{broadPlaces.length ? <div className="saved-moments">{broadPlaces.map((place) => <div className="moment-summary" key={place.id}><strong>{place.label}</strong><span>{[place.region, place.country_code, place.timezone].filter(Boolean).join(" · ") || "Alleen voor deze reis"}</span><button className="secondary compact" type="button" onClick={() => setBroadPlaceDraft({ id: place.id, label: place.label, countryCode: place.country_code ?? "", region: place.region ?? "", latitude: place.latitude?.toString() ?? "", longitude: place.longitude?.toString() ?? "", timezone: place.timezone ?? "" })}>Bewerken</button></div>)}</div> : <p>Voeg hieronder een bewust algemene plaats toe om die eventueel aan een uittreksel te koppelen.</p>}</section>
      </div>
      <section className="card"><h3>{broadPlaceDraft.id ? "Brede plaats bewerken" : "Brede plaats toevoegen"}</h3><p>Gebruik een bewust algemene plaats, zoals een stad of regio. Voeg alleen een zelf gekozen, gegeneraliseerd kaartpunt toe.</p><form className="stack-form" onSubmit={(event) => void saveBroadPlace(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De brede plaats kon niet worden opgeslagen."))}><div className="field-row"><label>Naam<input required maxLength={120} value={broadPlaceDraft.label} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="Bijvoorbeeld: Taipei" /></label><label>Landcode <span className="optional">(optioneel)</span><input maxLength={2} value={broadPlaceDraft.countryCode} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, countryCode: event.target.value }))} placeholder="TW" /></label></div><div className="field-row"><label>Regio <span className="optional">(optioneel)</span><input maxLength={120} value={broadPlaceDraft.region} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, region: event.target.value }))} placeholder="Taipei City" /></label><label>Tijdzone <span className="optional">(optioneel, privé)</span><input list="broad-place-time-zones" maxLength={64} value={broadPlaceDraft.timezone} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, timezone: event.target.value }))} placeholder="Asia/Taipei" /></label></div><datalist id="broad-place-time-zones">{timeZoneOptions().map((zone) => <option key={zone} value={zone} />)}</datalist><p className="help">Met een tijdzone toont het reisoverzicht de lokale tijd ter plaatse, zomertijd inbegrepen.</p><div className="field-row"><label>Brede breedtegraad <span className="optional">(optioneel)</span><input type="number" min={-90} max={90} step="any" value={broadPlaceDraft.latitude} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, latitude: event.target.value }))} /></label><label>Brede lengtegraad <span className="optional">(optioneel)</span><input type="number" min={-180} max={180} step="any" value={broadPlaceDraft.longitude} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, longitude: event.target.value }))} /></label></div><p className="help">Vul beide coördinaten in, of laat beide leeg. Gedeelde kaarten tonen dit punt alleen wanneer je de plaats en coördinaten publiceert.</p><div className="button-row"><button type="submit">Brede plaats opslaan</button>{broadPlaceDraft.id && <button className="secondary compact" type="button" onClick={() => setBroadPlaceDraft({ id: null, label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" })}>Annuleren</button>}</div></form></section>
      <RouteStageManager trip={selectedTrip} broadPlaces={broadPlaces} onChange={() => loadTrips(selectedTrip.id)} />
      <TrackManager trip={selectedTrip} onChange={() => setMapRevision((current) => current + 1)} />
      <StayManager trip={selectedTrip} broadPlaces={broadPlaces} onChange={bumpPlan} />
      <TransportLegManager trip={selectedTrip} onChange={bumpPlan} />
      <ItineraryPlanManager trip={selectedTrip} revision={planRevision} onShowOnMap={showOnMap} />
      <TripTaskManager trip={selectedTrip} onChange={bumpPlan} />
      <HighlightManager trip={selectedTrip} onChange={() => loadTrips(selectedTrip.id)} />
      <section className="card excerpt-editor"><div className="capture-heading"><div><h3>Moment-uittreksels</h3><p>Een uittreksel is afzonderlijk geschreven en blijft privé totdat je het expliciet publiceert.</p></div>{excerptDraft.id && <button className="secondary compact" type="button" onClick={newExcerpt}>Nieuw uittreksel</button>}</div>
        <form className="stack-form" onSubmit={(event) => void saveExcerpt(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het uittreksel kon niet worden opgeslagen."))}>
          <div className="field-row"><label>Bronmoment <span className="optional">(optioneel)</span><select value={excerptDraft.sourceMomentId} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, sourceMomentId: event.target.value }))}><option value="">Geen bronmoment</option>{selectedTrip.moments.map((moment) => <option key={moment.id} value={moment.id}>{moment.title}</option>)}</select></label><label>Datumprecisie<select value={excerptDraft.datePrecision} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, datePrecision: event.target.value as MomentExcerpt["date_precision"] }))}><option value="day">Dag</option><option value="month">Maand</option><option value="year">Jaar</option></select></label></div>
          <div className="field-row"><label>Verhaalsdatum <span className="optional">(optioneel)</span><input type="date" value={excerptDraft.storyDate} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, storyDate: event.target.value }))} /></label><label>Brede plaats <span className="optional">(optioneel)</span><select value={excerptDraft.broadPlaceId} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, broadPlaceId: event.target.value }))}><option value="">Geen plaats</option>{broadPlaces.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label></div>
          <label>Titel<input required maxLength={160} value={excerptDraft.title} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, title: event.target.value }))} /></label><label>Uittreksel<textarea required maxLength={10000} rows={5} value={excerptDraft.body} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, body: event.target.value }))} /></label>
          <button type="submit">{excerptDraft.id ? "Uittreksel opslaan" : "Uittreksel maken"}</button>
        </form>
        {selectedTrip.moment_excerpts.length > 0 && <div className="saved-moments">{selectedTrip.moment_excerpts.map((excerpt) => <article className="excerpt-row" key={excerpt.id}><div><strong>{excerpt.title}</strong><span>{excerpt.date_precision} · {excerpt.broad_place_id ? broadPlaces.find((place) => place.id === excerpt.broad_place_id)?.label ?? "brede plaats" : "geen plaats"}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => editExcerpt(excerpt)}>Bewerken</button><button className="danger compact" type="button" onClick={() => void deleteExcerpt(excerpt).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het uittreksel kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
      </section>
      <DocumentManager trip={selectedTrip} />
      <LinkedLibraryDocuments tripId={selectedTrip.id} />
      <MediaManager trip={selectedTrip} />
      <PublicationManager trip={selectedTrip} />
    </section>}
  </section>;
}
