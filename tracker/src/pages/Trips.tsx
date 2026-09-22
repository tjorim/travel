import { useEffect, useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../auth-context";
import { EmptyState } from "../tracker-routes";
import { DocumentManager } from "../trips/DocumentManager";
import { RouteStageManager } from "../trips/RouteStageManager";
import { StayManager } from "../trips/StayManager";
import { TrackManager } from "../trips/TrackManager";
import { apiError, apiHeaders, type BroadPlace, type MomentExcerpt, type Trip } from "../tracker-model";

export function Trips() {
  const { session } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tripDraft, setTripDraft] = useState({ title: "", summary: "", visibility: "private" as Trip["visibility"], publicationState: "draft" as Trip["publication_state"] });
  const [excerptDraft, setExcerptDraft] = useState({ id: null as string | null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day" as MomentExcerpt["date_precision"], title: "", body: "" });
  const [broadPlaceDraft, setBroadPlaceDraft] = useState({ label: "", countryCode: "", region: "" });
  const [broadPlaces, setBroadPlaces] = useState<BroadPlace[]>([]);
  const [message, setMessage] = useState("Meld aan om je private reizen te laden.");

  async function loadTrips(selectId?: string | null) {
    if (!session) return;
    const response = await fetch("/api/v1/trips", { headers: apiHeaders(session) });
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
    void fetch(`/api/v1/trips/${selectedId}/places/broad`, { headers: apiHeaders(session) })
      .then((response) => response.ok ? response.json() as Promise<BroadPlace[]> : apiError(response, "De brede plaatsen konden niet worden geladen."))
      .then(setBroadPlaces)
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De brede plaatsen konden niet worden geladen."));
  }, [selectedId, session]);

  function newTrip() {
    setSelectedId(null);
    setTripDraft({ title: "", summary: "", visibility: "private", publicationState: "draft" });
    setExcerptDraft({ id: null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day", title: "", body: "" });
    setBroadPlaceDraft({ label: "", countryCode: "", region: "" });
  }

  function selectTrip(trip: Trip) {
    setSelectedId(trip.id);
    setTripDraft({ title: trip.title, summary: trip.summary ?? "", visibility: trip.visibility, publicationState: trip.publication_state });
    setExcerptDraft({ id: null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day", title: "", body: "" });
    setBroadPlaceDraft({ label: "", countryCode: "", region: "" });
  }

  async function saveTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const isNew = !selectedTrip;
    const payload = isNew
      ? { title: tripDraft.title.trim(), summary: tripDraft.summary.trim() || null }
      : { title: tripDraft.title.trim(), summary: tripDraft.summary.trim() || null, visibility: tripDraft.visibility, publication_state: tripDraft.publicationState };
    setMessage(isNew ? "Reis maken…" : "Reis opslaan…");
    const response = await fetch(isNew ? "/api/v1/trips" : `/api/v1/trips/${selectedTrip.id}`, {
      method: isNew ? "POST" : "PATCH", headers: apiHeaders(session), body: JSON.stringify(payload),
    });
    if (!response.ok) return apiError(response, "De reis kon niet worden opgeslagen.");
    const saved = await response.json() as Trip;
    await loadTrips(saved.id);
    setTripDraft({ title: saved.title, summary: saved.summary ?? "", visibility: saved.visibility, publicationState: saved.publication_state });
    setMessage(isNew ? "Private reis gemaakt." : "Reis opgeslagen.");
  }

  async function deleteTrip() {
    if (!session || !selectedTrip || !window.confirm(`Verwijder ${selectedTrip.title} met alle private inhoud?`)) return;
    const response = await fetch(`/api/v1/trips/${selectedTrip.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De reis kon niet worden verwijderd.");
    await loadTrips(null);
    newTrip();
    setMessage("Reis verwijderd.");
  }

  function editExcerpt(excerpt: MomentExcerpt) {
    setExcerptDraft({ id: excerpt.id, sourceMomentId: excerpt.source_moment_id ?? "", broadPlaceId: excerpt.broad_place_id ?? "", datePrecision: excerpt.date_precision, title: excerpt.title, body: excerpt.body });
  }

  function newExcerpt() {
    setExcerptDraft({ id: null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day", title: "", body: "" });
  }

  async function saveExcerpt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedTrip) return;
    const payload = {
      source_moment_id: excerptDraft.sourceMomentId || null,
      broad_place_id: excerptDraft.broadPlaceId || null,
      date_precision: excerptDraft.datePrecision,
      title: excerptDraft.title.trim(),
      body: excerptDraft.body.trim(),
    };
    setMessage(excerptDraft.id ? "Uittreksel opslaan…" : "Uittreksel maken…");
    const response = await fetch(excerptDraft.id ? `/api/v1/trips/${selectedTrip.id}/moment-excerpts/${excerptDraft.id}` : `/api/v1/trips/${selectedTrip.id}/moment-excerpts`, {
      method: excerptDraft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify(payload),
    });
    if (!response.ok) return apiError(response, "Het uittreksel kon niet worden opgeslagen.");
    await loadTrips(selectedTrip.id);
    newExcerpt();
    setMessage("Uittreksel opgeslagen. Het is nog niet gedeeld.");
  }

  async function deleteExcerpt(excerpt: MomentExcerpt) {
    if (!session || !selectedTrip || !window.confirm(`Verwijder uittreksel “${excerpt.title}”?`)) return;
    const response = await fetch(`/api/v1/trips/${selectedTrip.id}/moment-excerpts/${excerpt.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Het uittreksel kon niet worden verwijderd.");
    await loadTrips(selectedTrip.id);
    newExcerpt();
    setMessage("Uittreksel verwijderd.");
  }

  async function saveBroadPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedTrip) return;
    const countryCode = broadPlaceDraft.countryCode.trim().toUpperCase();
    const response = await fetch(`/api/v1/trips/${selectedTrip.id}/places/broad`, {
      method: "POST",
      headers: apiHeaders(session),
      body: JSON.stringify({
        label: broadPlaceDraft.label.trim(),
        country_code: countryCode || null,
        region: broadPlaceDraft.region.trim() || null,
      }),
    });
    if (!response.ok) return apiError(response, "De brede plaats kon niet worden opgeslagen.");
    const saved = await response.json() as BroadPlace;
    setBroadPlaces((current) => [...current, saved]);
    setBroadPlaceDraft({ label: "", countryCode: "", region: "" });
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
          {selectedTrip && <><label>Zichtbaarheid<select value={tripDraft.visibility} onChange={(event) => setTripDraft((draft) => ({ ...draft, visibility: event.target.value as Trip["visibility"], publicationState: event.target.value === "private" ? "draft" : draft.publicationState }))}><option value="private">Privé</option><option value="unlisted">Verborgen link</option><option value="public">Publiek</option></select></label><label>Publicatie<select value={tripDraft.publicationState} onChange={(event) => setTripDraft((draft) => ({ ...draft, publicationState: event.target.value as Trip["publication_state"] }))}><option value="draft">Concept</option><option value="published" disabled={tripDraft.visibility === "private"}>Gepubliceerd</option></select></label><p className="help">Zichtbaarheid maakt niets automatisch deelbaar: kies aparte publicaties wanneer je klaar bent.</p></>}
          <div className="button-row"><button type="submit">{selectedTrip ? "Reis opslaan" : "Reis maken"}</button>{selectedTrip && <button className="danger compact" type="button" onClick={() => void deleteTrip().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De reis kon niet worden verwijderd."))}>Reis verwijderen</button>}</div>
        </form>
      </section>
    </div>
    {selectedTrip && <section className="trip-detail" aria-labelledby="trip-detail-title">
      <div className="capture-heading"><div><p className="eyebrow">{selectedTrip.title}</p><h3 id="trip-detail-title">Private inhoud</h3></div><NavLink className="action-link" to="/capture">Moment vastleggen</NavLink></div>
      <div className="detail-grid">
        <section className="card"><h3>Momenten</h3>{selectedTrip.moments.length ? <div className="saved-moments">{selectedTrip.moments.slice().reverse().map((moment) => <div className="moment-summary" key={moment.id}><strong>{moment.title}</strong><span>{new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(moment.occurred_at))}{moment.place ? ` · ${moment.place.display_name ?? moment.place.locality ?? "exacte plaats"}` : ""}</span></div>)}</div> : <p>Nog geen momenten. Leg er één vast wanneer je wilt.</p>}</section>
        <section className="card"><h3>Brede plaatsen</h3>{broadPlaces.length ? <div className="saved-moments">{broadPlaces.map((place) => <div className="moment-summary" key={place.id}><strong>{place.label}</strong><span>{[place.region, place.country_code].filter(Boolean).join(" · ") || "Alleen voor deze reis"}</span></div>)}</div> : <p>Voeg hieronder een bewust algemene plaats toe om die eventueel aan een uittreksel te koppelen.</p>}</section>
      </div>
      <section className="card"><h3>Brede plaats toevoegen</h3><p>Gebruik alleen een bewust algemene aanduiding, zoals een stad of regio. Er zijn geen exacte coördinaten in dit formulier.</p><form className="stack-form" onSubmit={(event) => void saveBroadPlace(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De brede plaats kon niet worden opgeslagen."))}><div className="field-row"><label>Naam<input required maxLength={120} value={broadPlaceDraft.label} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="Bijvoorbeeld: Taipei" /></label><label>Landcode <span className="optional">(optioneel)</span><input maxLength={2} value={broadPlaceDraft.countryCode} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, countryCode: event.target.value }))} placeholder="TW" /></label></div><label>Regio <span className="optional">(optioneel)</span><input maxLength={120} value={broadPlaceDraft.region} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, region: event.target.value }))} placeholder="Taipei City" /></label><button type="submit">Brede plaats opslaan</button></form></section>
      <RouteStageManager trip={selectedTrip} broadPlaces={broadPlaces} onChange={() => loadTrips(selectedTrip.id)} />
      <TrackManager trip={selectedTrip} />
      <StayManager trip={selectedTrip} broadPlaces={broadPlaces} />
      <section className="card excerpt-editor"><div className="capture-heading"><div><h3>Moment-uittreksels</h3><p>Een uittreksel is afzonderlijk geschreven en blijft privé totdat je het expliciet publiceert.</p></div>{excerptDraft.id && <button className="secondary compact" type="button" onClick={newExcerpt}>Nieuw uittreksel</button>}</div>
        <form className="stack-form" onSubmit={(event) => void saveExcerpt(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het uittreksel kon niet worden opgeslagen."))}>
          <div className="field-row"><label>Bronmoment <span className="optional">(optioneel)</span><select value={excerptDraft.sourceMomentId} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, sourceMomentId: event.target.value }))}><option value="">Geen bronmoment</option>{selectedTrip.moments.map((moment) => <option key={moment.id} value={moment.id}>{moment.title}</option>)}</select></label><label>Datumprecisie<select value={excerptDraft.datePrecision} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, datePrecision: event.target.value as MomentExcerpt["date_precision"] }))}><option value="day">Dag</option><option value="month">Maand</option><option value="year">Jaar</option></select></label></div>
          <label>Brede plaats <span className="optional">(optioneel)</span><select value={excerptDraft.broadPlaceId} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, broadPlaceId: event.target.value }))}><option value="">Geen plaats</option>{broadPlaces.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label>
          <label>Titel<input required maxLength={160} value={excerptDraft.title} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, title: event.target.value }))} /></label><label>Uittreksel<textarea required maxLength={10000} rows={5} value={excerptDraft.body} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, body: event.target.value }))} /></label>
          <button type="submit">{excerptDraft.id ? "Uittreksel opslaan" : "Uittreksel maken"}</button>
        </form>
        {selectedTrip.moment_excerpts.length > 0 && <div className="saved-moments">{selectedTrip.moment_excerpts.map((excerpt) => <article className="excerpt-row" key={excerpt.id}><div><strong>{excerpt.title}</strong><span>{excerpt.date_precision} · {excerpt.broad_place_id ? broadPlaces.find((place) => place.id === excerpt.broad_place_id)?.label ?? "brede plaats" : "geen plaats"}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => editExcerpt(excerpt)}>Bewerken</button><button className="danger compact" type="button" onClick={() => void deleteExcerpt(excerpt).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het uittreksel kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
      </section>
      <DocumentManager trip={selectedTrip} />
    </section>}
  </section>;
}
