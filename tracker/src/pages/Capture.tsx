import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth-context";
import { EmptyState } from "../tracker-routes";
import {
  apiError,
  clearDraft,
  emptyDraft,
  localDateTime,
  publicationDescription,
  readDraft,
  saveDraft,
  type MediaAsset,
  type Moment,
  type MomentDraft,
  type PlaceSearchResponse,
  type PlaceSearchResult,
  type Trip,
  type VisitCandidateIntent,
} from "../tracker-model";

export function Capture() {
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState(navigator.onLine);
  const [draft, setDraft] = useState<MomentDraft>(() => readDraft() ?? emptyDraft());
  const [draftState, setDraftState] = useState(readDraft() ? "Lokaal concept hersteld." : "Nieuw concept.");
  const [saveState, setSaveState] = useState("");
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [mediaState, setMediaState] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<PlaceSearchResponse | null>(null);
  const [placeState, setPlaceState] = useState("");
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  const [candidateGps, setCandidateGps] = useState<{ latitude: number; longitude: number } | null>(null);
  const candidateIntent = (location.state as { candidate?: VisitCandidateIntent } | null)?.candidate;

  useEffect(() => {
    const updateConnection = () => setConnection(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetch("/api/v1/trips", { headers: { Authorization: `Bearer ${session.accessToken}` } })
      .then((response) => response.ok ? response.json() as Promise<Trip[]> : Promise.reject(new Error("Je sessie is niet meer geldig.")))
      .then((loadedTrips) => {
        setTrips(loadedTrips);
        setDraft((current) => current.tripId || loadedTrips.length === 0 ? current : { ...current, tripId: loadedTrips[0].id });
      })
      .catch((error: unknown) => setSaveState(error instanceof Error ? error.message : "Je reizen konden niet worden geladen."))
      .finally(() => setLoading(false));
  }, [session]);

  useEffect(() => {
    if (!draft.momentId && !draft.title && !draft.story) {
      clearDraft();
      return;
    }
    saveDraft(draft);
    setDraftState("Concept lokaal bewaard — nog niet naar je reis gestuurd.");
  }, [draft]);

  const selectedTrip = useMemo(() => trips.find((trip) => trip.id === draft.tripId) ?? null, [draft.tripId, trips]);
  const attachedMedia = useMemo(
    () => draft.mediaAssetIds.map((id) => media.find((asset) => asset.id === id)).filter((asset): asset is MediaAsset => Boolean(asset)),
    [draft.mediaAssetIds, media],
  );

  useEffect(() => {
    if (!session || !selectedTrip) {
      setMedia([]);
      return;
    }
    setMediaState("Media laden…");
    void fetch(`/api/v1/trips/${selectedTrip.id}/media`, { headers: { Authorization: `Bearer ${session.accessToken}` } })
      .then((response) => response.ok ? response.json() as Promise<MediaAsset[]> : Promise.reject(new Error("Je media konden niet worden geladen.")))
      .then((assets) => {
        setMedia(assets.filter((asset) => asset.media_kind === "photo"));
        setMediaState(assets.length ? "Kies privéfoto’s om aan dit moment te koppelen." : "Nog geen foto’s in deze reis.");
      })
      .catch((error: unknown) => setMediaState(error instanceof Error ? error.message : "Je media konden niet worden geladen."));
  }, [selectedTrip, session]);

  useEffect(() => {
    if (!candidateIntent || !trips.some((trip) => trip.id === candidateIntent.tripId)) return;
    setDraft({
      ...emptyDraft(candidateIntent.tripId),
      occurredAt: candidateIntent.occurredAt ? localDateTime(new Date(candidateIntent.occurredAt)) : localDateTime(),
      mediaAssetIds: candidateIntent.mediaAssetIds,
    });
    setCandidateGps(candidateIntent.gps ?? null);
    setSaveState("Kandidaat overgenomen als lokaal concept. Kies zelf een plaats en sla pas op wanneer je wilt.");
    navigate("/capture", { replace: true, state: null });
  }, [candidateIntent, navigate, trips]);

  function updateDraft(values: Partial<MomentDraft>) {
    setDraft((current) => ({ ...current, ...values }));
    setSaveState("");
  }

  function startNew() {
    const next = emptyDraft(selectedTrip?.id ?? trips[0]?.id ?? "");
    setDraft(next);
    setPlaceQuery("");
    setPlaceResults(null);
    setPlaceState("");
    setDismissedSuggestions([]);
    setCandidateGps(null);
    setSaveState("");
  }

  function editMoment(moment: Moment) {
    const occurred = new Date(moment.occurred_at);
    setDraft({
      tripId: selectedTrip?.id ?? "",
      momentId: moment.id,
      occurredAt: localDateTime(occurred),
      title: moment.title,
      story: moment.story,
      place: moment.place,
      mediaAssetIds: moment.media_asset_ids,
    });
    setPlaceQuery("");
    setPlaceResults(null);
    setPlaceState("");
    setDismissedSuggestions([]);
    setCandidateGps(null);
    setSaveState("Je bewerkt een opgeslagen moment.");
  }

  function toggleMedia(assetId: string) {
    updateDraft({ mediaAssetIds: draft.mediaAssetIds.includes(assetId) ? draft.mediaAssetIds.filter((id) => id !== assetId) : [...draft.mediaAssetIds, assetId] });
    setDismissedSuggestions((current) => current.filter((id) => id !== assetId));
  }

  function selectPlace(result: PlaceSearchResult) {
    updateDraft({ place: result });
    setPlaceState("Plaats geselecteerd. Hij wordt pas gemaakt wanneer je het moment opslaat.");
    setPlaceResults(null);
  }

  async function searchPlace() {
    if (!session || !selectedTrip || placeQuery.trim().length < 2) {
      setPlaceState("Vul minstens twee tekens in om een plaats te zoeken.");
      return;
    }
    setPlaceState("Plaatsen zoeken…");
    try {
      const response = await fetch(`/api/v1/trips/${selectedTrip.id}/places/search`, {
        method: "POST", headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: placeQuery.trim() }),
      });
      if (!response.ok) throw new Error("Plaatsen zoeken is nu niet beschikbaar.");
      const result = await response.json() as PlaceSearchResponse;
      setPlaceResults(result);
      setPlaceState(result.results.length ? "Kies een resultaat. Er wordt nog niets opgeslagen." : "Geen plaatsen gevonden.");
    } catch (error) {
      setPlaceState(error instanceof Error ? error.message : "Plaatsen zoeken is mislukt.");
    }
  }

  async function reverseGeocode(gps: { latitude: number; longitude: number }) {
    if (!session || !selectedTrip) return;
    setPlaceState("De fotolocatie wordt alleen voor jou opgezocht…");
    try {
      const response = await fetch(`/api/v1/trips/${selectedTrip.id}/places/reverse`, {
        method: "POST", headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(gps),
      });
      if (!response.ok) throw new Error("Deze fotolocatie kon niet worden opgezocht.");
      const result = await response.json() as PlaceSearchResponse;
      setPlaceResults(result);
      setPlaceState(result.results.length ? "Kies de voorgestelde plaats. Er wordt nog niets opgeslagen." : "Voor deze fotolocatie is geen plaats gevonden.");
    } catch (error) {
      setPlaceState(error instanceof Error ? error.message : "Deze fotolocatie kon niet worden opgezocht.");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedTrip) {
      setSaveState("Kies eerst een reis en meld aan om op te slaan.");
      return;
    }
    if (!connection) {
      setSaveState("Je bent offline. Dit concept blijft alleen lokaal bewaard en wordt niet automatisch verstuurd.");
      return;
    }
    const payload = {
      occurred_at: new Date(draft.occurredAt).toISOString(),
      title: draft.title.trim(),
      story: draft.story.trim(),
      place: draft.place,
      media_asset_ids: draft.mediaAssetIds,
    };
    setSaveState("Opslaan…");
    try {
      const endpoint = draft.momentId ? `/api/v1/trips/${selectedTrip.id}/moments/${draft.momentId}` : `/api/v1/trips/${selectedTrip.id}/moments`;
      const response = await fetch(endpoint, {
        method: draft.momentId ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Het moment kon niet worden opgeslagen. Je lokale concept blijft bewaard.");
      const saved = await response.json() as Moment;
      setTrips((current) => current.map((trip) => trip.id !== selectedTrip.id ? trip : {
        ...trip,
        moments: draft.momentId ? trip.moments.map((item) => item.id === saved.id ? saved : item) : [...trip.moments, saved],
      }));
      clearDraft();
      setDraftState("Opgeslagen in je private reis.");
      setSaveState("Moment opgeslagen.");
      setDraft(emptyDraft(selectedTrip.id));
      setPlaceQuery("");
      setPlaceResults(null);
      setPlaceState("");
      setDismissedSuggestions([]);
      setCandidateGps(null);
    } catch (error) {
      setSaveState(error instanceof Error ? error.message : "Het moment kon niet worden opgeslagen. Je lokale concept blijft bewaard.");
    }
  }

  async function deleteMoment() {
    if (!session || !selectedTrip || !draft.momentId || !window.confirm(`Verwijder moment “${draft.title}”?`)) return;
    setSaveState("Moment verwijderen…");
    try {
      const response = await fetch(`/api/v1/trips/${selectedTrip.id}/moments/${draft.momentId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!response.ok) await apiError(response, "Het moment kon niet worden verwijderd.");
      setTrips((current) => current.map((trip) => trip.id === selectedTrip.id ? { ...trip, moments: trip.moments.filter((moment) => moment.id !== draft.momentId) } : trip));
      clearDraft();
      startNew();
      setDraftState("Moment verwijderd.");
    } catch (error) {
      setSaveState(error instanceof Error ? error.message : "Het moment kon niet worden verwijderd.");
    }
  }

  if (!session) return <EmptyState title="Moment vastleggen">Meld aan om een concept lokaal te bewaren of een moment aan een private reis toe te voegen.</EmptyState>;
  if (loading) return <EmptyState title="Moment vastleggen">Je reizen laden…</EmptyState>;
  if (trips.length === 0) return <EmptyState title="Moment vastleggen">Maak eerst een private reis aan; daarna kun je hier een moment aan toevoegen.</EmptyState>;

  return (
    <section className="capture" aria-labelledby="capture-title">
      <div className="capture-heading">
        <div><p className="eyebrow">Mobiel vastleggen</p><h2 id="capture-title">{draft.momentId ? "Moment bewerken" : "Nieuw moment"}</h2></div>
        {draft.momentId && <div className="button-row"><button className="secondary compact" type="button" onClick={startNew}>Nieuw moment</button><button className="danger compact" type="button" onClick={() => void deleteMoment()}>Verwijderen</button></div>}
      </div>
      <p className={`connection ${connection ? "online" : "offline"}`} role="status">{connection ? "Verbonden — je kiest zelf wanneer je opslaat." : "Offline — concepten blijven lokaal; er is geen automatische synchronisatie."}</p>
      <form className="capture-form" onSubmit={save}>
        <label>Reis<select value={draft.tripId} onChange={(event) => updateDraft({ tripId: event.target.value, momentId: null, place: null, mediaAssetIds: [] })}>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}</select></label>
        {selectedTrip && <aside className="publication" aria-label="Zichtbaarheid van dit moment"><strong>Voor je opslaat</strong><span>{publicationDescription(selectedTrip)}</span></aside>}
        <div className="field-row"><label>Datum en tijd<input required type="datetime-local" value={draft.occurredAt} onChange={(event) => updateDraft({ occurredAt: event.target.value })} /></label><label>Titel<input required maxLength={160} value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="Bijvoorbeeld: eerste avond" /></label></div>
        <label>Je moment<textarea required maxLength={10000} rows={6} value={draft.story} onChange={(event) => updateDraft({ story: event.target.value })} placeholder="Wat wil je onthouden?" /></label>
        <fieldset className="location"><legend>Privéfoto’s koppelen</legend><p>Een koppeling is privé. EXIF wordt alleen hieronder als voorstel gebruikt; geen datum of plaats verandert zonder jouw keuze.</p>
          <p className="help" role="status">{mediaState}</p>
          {media.map((asset) => <label className="media-choice" key={asset.id}><input type="checkbox" checked={draft.mediaAssetIds.includes(asset.id)} onChange={() => toggleMedia(asset.id)} />{asset.original_filename ?? "Naamloze foto"}{asset.captured_at ? ` · ${new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(asset.captured_at))}` : ""}</label>)}
          {attachedMedia.map((asset) => !dismissedSuggestions.includes(asset.id) && (asset.captured_at || asset.gps) && <aside className="exif-suggestion" key={`suggestion-${asset.id}`}><strong>Voorstel uit {asset.original_filename ?? "deze foto"}</strong>
            {asset.captured_at && <span>Opname: {new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(asset.captured_at))}.</span>}
            <div className="button-row">{asset.captured_at && <button className="secondary compact" type="button" onClick={() => { updateDraft({ occurredAt: localDateTime(new Date(asset.captured_at!)) }); setSaveState("Opnamedatum als voorstel overgenomen — pas hem gerust aan."); }}>Gebruik opnamedatum</button>}{asset.gps && <button className="secondary compact" type="button" onClick={() => void reverseGeocode(asset.gps!)}>Zoek plaats bij foto</button>}<button className="secondary compact" type="button" onClick={() => setDismissedSuggestions((current) => [...current, asset.id])}>Voorstel negeren</button></div>
          </aside>)}
          {attachedMedia.filter((asset) => asset.captured_at || asset.gps).length > 1 && <p className="help">Foto’s kunnen verschillen. Elk voorstel blijft afzonderlijk zichtbaar; jij kiest er hoogstens één en kunt die altijd weer aanpassen.</p>}
        </fieldset>
        <fieldset className="location"><legend>Exacte plaats — volledig optioneel</legend><p>Zoek en kies een plaats. Deze wordt pas samen met jouw opgeslagen moment als private plaats gemaakt.</p>
          {candidateGps && <aside className="exif-suggestion"><strong>Gekozen locatie uit kandidaat</strong><span>Deze EXIF-coördinaat blijft privé en is nog niet opgezocht of opgeslagen.</span><div className="button-row"><button className="secondary compact" type="button" onClick={() => void reverseGeocode(candidateGps)}>Zoek deze kandidaatplaats</button><button className="secondary compact" type="button" onClick={() => setCandidateGps(null)}>Locatie negeren</button></div></aside>}
          <div className="field-row"><label>Zoek plaats<input value={placeQuery} onChange={(event) => setPlaceQuery(event.target.value)} placeholder="Bijvoorbeeld: Taipei Main Station" /></label><div className="button-field"><button className="secondary" type="button" onClick={() => void searchPlace()}>Zoeken</button></div></div>
          {draft.place && <p className="selected-place"><strong>Gekozen plaats:</strong> {draft.place.display_name ?? draft.place.locality ?? "Naamloze plaats"} <button className="secondary compact" type="button" onClick={() => updateDraft({ place: null })}>Verwijderen</button></p>}
          {placeState && <p className="help" role="status">{placeState}</p>}
          {placeResults && <div className="place-results">{placeResults.results.map((result) => <button className="place-result" type="button" key={`${result.osm_element_type}-${result.osm_element_id}`} onClick={() => selectPlace(result)}>{result.display_name}</button>)}<p className="help">Zoekresultaten: <a href={placeResults.attribution_url} target="_blank" rel="noreferrer">{placeResults.attribution}</a></p></div>}
        </fieldset>
        <div className="save-row"><button type="submit">{draft.momentId ? "Wijzigingen opslaan" : "Moment opslaan"}</button><span aria-live="polite">{saveState || draftState}</span></div>
      </form>
      {selectedTrip && selectedTrip.moments.length > 0 && <section className="saved-moments"><h3>Opgeslagen momenten</h3>{selectedTrip.moments.slice().reverse().map((moment) => <button className="moment-row" type="button" key={moment.id} onClick={() => editMoment(moment)}><strong>{moment.title}</strong><span>{new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(moment.occurred_at))}{moment.place ? ` · ${moment.place.display_name}` : " · zonder locatie"}</span></button>)}</section>}
    </section>
  );
}
