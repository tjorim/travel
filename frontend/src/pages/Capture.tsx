import { useStore } from "@tanstack/react-form";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth-context";
import { requiredText, TextAreaField, TextField } from "../forms/fields";
import { useConfirmation } from "../forms/useConfirmation";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource, useTripsQuery } from "../query/owner-queries";
import { EmptyState } from "../tracker-routes";
import {
  clearDraft,
  emptyDraft,
  localDateTime,
  readDraft,
  saveDraft,
  type MediaAsset,
  type TravelUpdate,
  type UpdateDraft,
  type PlaceSearchResponse,
  type PlaceSearchResult,
  type VisitCandidateIntent,
} from "../tracker-model";

const timestamp = (value: string) => new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const SAVE_FALLBACK = "De reisupdate kon niet worden opgeslagen. Je lokale concept blijft bewaard.";

export function Capture() {
  const confirmation = useConfirmation();
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const tripsQuery = useTripsQuery();
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const [connection, setConnection] = useState(navigator.onLine);
  const restored = useRef(readDraft());
  const [draftState, setDraftState] = useState(restored.current ? "Lokaal concept hersteld." : "Nieuw concept.");
  const [saveState, setSaveState] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<PlaceSearchResponse | null>(null);
  const [placeState, setPlaceState] = useState("");
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  const [candidateGps, setCandidateGps] = useState<{ latitude: number; longitude: number } | null>(null);
  const candidateIntent = (location.state as { candidate?: VisitCandidateIntent } | null)?.candidate;

  const saveUpdate = useOwnerMutation<{ tripId: string; updateId: string | null; payload: Record<string, unknown> }, TravelUpdate>({
    fallback: SAVE_FALLBACK,
    request: ({ tripId, updateId, payload }) => ({ path: updateId ? tripPath(tripId, `travel-updates/${updateId}`) : tripPath(tripId, "travel-updates"), method: updateId ? "PATCH" : "POST", body: payload }),
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });
  const deleteUpdate = useOwnerMutation<{ tripId: string; updateId: string }>({
    fallback: "De reisupdate kon niet worden verwijderd.",
    request: ({ tripId, updateId }) => ({ path: tripPath(tripId, `travel-updates/${updateId}`), method: "DELETE" }),
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });
  // A search phrase or a photo's coordinates are private: those calls are dropped from the mutation cache once settled.
  const searchPlaces = useOwnerMutation<{ tripId: string; query: string }, PlaceSearchResponse>({
    fallback: "Plaatsen zoeken is nu niet beschikbaar.",
    request: ({ tripId, query }) => ({ path: tripPath(tripId, "places/search"), method: "POST", body: { query } }),
    invalidate: () => [],
    gcTime: 0,
  });
  const reversePlaces = useOwnerMutation<{ tripId: string; latitude: number; longitude: number }, PlaceSearchResponse>({
    fallback: "Deze fotolocatie kon niet worden opgezocht.",
    request: ({ tripId, latitude, longitude }) => ({ path: tripPath(tripId, "places/reverse"), method: "POST", body: { latitude, longitude } }),
    invalidate: () => [],
    gcTime: 0,
  });

  const record = useRecordForm<UpdateDraft, TravelUpdate>({
    defaultValues: restored.current ?? emptyDraft(),
    fallback: SAVE_FALLBACK,
    submit: async (values) => {
      if (!session || !values.tripId) throw new Error("Kies eerst een reis en meld aan om op te slaan.");
      if (!connection) throw new Error("Je bent offline. Dit concept blijft alleen lokaal bewaard en wordt niet automatisch verstuurd.");
      setSaveState("Opslaan…");
      // A place that already exists on the server is left as it is: sending it again would make a new one and lose its public name.
      const keepsPlace = Boolean((values.place as { id?: string } | null)?.id);
      return saveUpdate.mutateAsync({
        tripId: values.tripId,
        updateId: values.updateId,
        payload: { occurred_at: new Date(values.occurredAt).toISOString(), title: values.title.trim(), private_notes: values.notes.trim() || null, ...(keepsPlace ? {} : { place: values.place }), media_asset_ids: values.mediaAssetIds },
      });
    },
    onSuccess: (_saved, values) => {
      clearDraft();
      setDraftState("Opgeslagen in je private reis.");
      setSaveState("Reisupdate opgeslagen.");
      record.load(emptyDraft(values.tripId));
      resetPlaceSearch();
    },
  });
  const draft = record.values;
  const { form } = record;
  const draftTripId = useStore(form.store, (state) => state.values.tripId);
  const selectedTrip = useMemo(() => trips.find((trip) => trip.id === draftTripId) ?? null, [draftTripId, trips]);
  const mediaQuery = useTripResource(selectedTrip?.id ?? null, "media");
  const media = useMemo(() => (mediaQuery.data ?? []).filter((asset) => asset.media_kind === "photo"), [mediaQuery.data]);
  const attachedMedia = useMemo(
    () => draft.mediaAssetIds.map((id) => media.find((asset) => asset.id === id)).filter((asset): asset is MediaAsset => Boolean(asset)),
    [draft.mediaAssetIds, media],
  );
  const mediaState = !selectedTrip ? "" : mediaQuery.error ? errorMessage(mediaQuery.error, "Je media konden niet worden geladen.") : mediaQuery.isPending ? "Media laden…" : mediaQuery.data?.length ? "Kies privéfoto’s om aan deze reisupdate te koppelen." : "Nog geen foto’s in deze reis.";

  useEffect(() => {
    const updateConnection = () => setConnection(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  // A draft without a trip follows the first trip once the list is known.
  useEffect(() => {
    if (trips.length > 0 && !form.getFieldValue("tripId")) form.setFieldValue("tripId", trips[0].id);
  }, [form, trips]);

  useEffect(() => {
    if (!draft.updateId && !draft.title && !draft.notes) {
      clearDraft();
      return;
    }
    saveDraft(draft);
    setDraftState("Concept lokaal bewaard — nog niet naar je reis gestuurd.");
  }, [draft]);

  useEffect(() => {
    if (!candidateIntent || !trips.some((trip) => trip.id === candidateIntent.tripId)) return;
    record.load({
      ...emptyDraft(candidateIntent.tripId),
      occurredAt: candidateIntent.occurredAt ? localDateTime(new Date(candidateIntent.occurredAt)) : localDateTime(),
      mediaAssetIds: candidateIntent.mediaAssetIds,
    });
    setCandidateGps(candidateIntent.gps ?? null);
    setSaveState("Kandidaat overgenomen als lokaal concept. Kies zelf een plaats en sla pas op wanneer je wilt.");
    navigate("/capture", { replace: true, state: null });
    // `record.load` is stable; the intent is consumed once and cleared from the location state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateIntent, navigate, trips]);

  function updateDraft(values: Partial<UpdateDraft>) {
    for (const [name, value] of Object.entries(values)) form.setFieldValue(name as keyof UpdateDraft, value as never);
    setSaveState("");
  }

  function resetPlaceSearch() {
    setPlaceQuery("");
    setPlaceResults(null);
    setPlaceState("");
    setDismissedSuggestions([]);
    setCandidateGps(null);
  }

  function startNew() {
    record.load(emptyDraft(selectedTrip?.id ?? trips[0]?.id ?? ""));
    resetPlaceSearch();
    setSaveState("");
  }

  function editUpdate(update: TravelUpdate) {
    record.load({
      tripId: selectedTrip?.id ?? "",
      updateId: update.id,
      occurredAt: localDateTime(new Date(update.occurred_at)),
      title: update.title,
      notes: update.private_notes ?? "",
      place: update.place,
      mediaAssetIds: update.media_asset_ids,
    });
    resetPlaceSearch();
    setSaveState("Je bewerkt een opgeslagen reisupdate.");
  }

  function toggleMedia(assetId: string) {
    updateDraft({ mediaAssetIds: draft.mediaAssetIds.includes(assetId) ? draft.mediaAssetIds.filter((id) => id !== assetId) : [...draft.mediaAssetIds, assetId] });
    setDismissedSuggestions((current) => current.filter((id) => id !== assetId));
  }

  function selectPlace(result: PlaceSearchResult) {
    updateDraft({ place: result });
    setPlaceState("Plaats geselecteerd. Hij wordt pas gemaakt wanneer je de reisupdate opslaat.");
    setPlaceResults(null);
  }

  function searchPlace() {
    if (!session || !selectedTrip || placeQuery.trim().length < 2) {
      setPlaceState("Vul minstens twee tekens in om een plaats te zoeken.");
      return;
    }
    setPlaceState("Plaatsen zoeken…");
    searchPlaces.mutateAsync({ tripId: selectedTrip.id, query: placeQuery.trim() }).then((result) => {
      setPlaceResults(result);
      setPlaceState(result.results.length ? "Kies een resultaat. Er wordt nog niets opgeslagen." : "Geen plaatsen gevonden.");
    }, (error: unknown) => setPlaceState(errorMessage(error, "Plaatsen zoeken is mislukt.")));
  }

  function reverseGeocode(gps: { latitude: number; longitude: number }) {
    if (!session || !selectedTrip) return;
    setPlaceState("De fotolocatie wordt alleen voor jou opgezocht…");
    reversePlaces.mutateAsync({ tripId: selectedTrip.id, ...gps }).then((result) => {
      setPlaceResults(result);
      setPlaceState(result.results.length ? "Kies de voorgestelde plaats. Er wordt nog niets opgeslagen." : "Voor deze fotolocatie is geen plaats gevonden.");
    }, (error: unknown) => setPlaceState(errorMessage(error, "Deze fotolocatie kon niet worden opgezocht.")));
  }

  function removeUpdate() {
    const { updateId } = draft;
    if (!selectedTrip || !updateId) return;
    confirmation.ask({ title: `Reisupdate “${draft.title}” verwijderen?`, onConfirm: () => performRemoveUpdate(selectedTrip.id, updateId) });
  }

  function performRemoveUpdate(tripId: string, updateId: string) {
    setSaveState("Reisupdate verwijderen…");
    deleteUpdate.mutateAsync({ tripId, updateId }).then(() => {
      clearDraft();
      startNew();
      setDraftState("Reisupdate verwijderd.");
    }, (error: unknown) => setSaveState(errorMessage(error, "De reisupdate kon niet worden verwijderd.")));
  }

  if (!session) return <EmptyState title="Reisupdate vastleggen">Meld aan om een concept lokaal te bewaren of een reisupdate aan een private reis toe te voegen.</EmptyState>;
  if (tripsQuery.isPending) return <EmptyState title="Reisupdate vastleggen">{connection ? "Je reizen laden…" : "Je bent offline. Je reizen laden zodra je opnieuw verbinding hebt."}</EmptyState>;
  if (tripsQuery.isError) return <EmptyState title="Reisupdate vastleggen">{errorMessage(tripsQuery.error, "Je reizen konden niet worden geladen.")}</EmptyState>;
  if (trips.length === 0) return <EmptyState title="Reisupdate vastleggen">Maak eerst een private reis aan; daarna kun je hier een reisupdate aan toevoegen.</EmptyState>;

  const clearSaveState = { onChange: () => setSaveState("") };

  return (
    <section className="capture" aria-labelledby="capture-title">
      <div className="capture-heading">
        <div><p className="eyebrow">Mobiel vastleggen</p><h2 id="capture-title">{draft.updateId ? "Reisupdate bewerken" : "Nieuwe reisupdate"}</h2></div>
        {draft.updateId && <div className="button-row"><button className="secondary compact" type="button" onClick={startNew}>Nieuwe reisupdate</button><button className="danger compact" type="button" onClick={removeUpdate}>Verwijderen</button></div>}
      </div>
      <p className={`connection ${connection ? "online" : "offline"}`} role="status">{connection ? "Verbonden — je kiest zelf wanneer je opslaat." : "Offline — concepten blijven lokaal; er is geen automatische synchronisatie."}</p>
      <form ref={record.formRef} className="capture-form" noValidate onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
        <label>Reis<select value={draft.tripId} onChange={(event) => updateDraft({ tripId: event.target.value, updateId: null, place: null, mediaAssetIds: [] })}>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}</select></label>
        {selectedTrip && <aside className="publication" aria-label="Delen van deze reisupdate"><strong>Voor je opslaat</strong><span>Een nieuwe reisupdate is privé. Je notities, exacte plaats en foto’s worden nooit gedeeld; de tekst voor bezoekers schrijf je later bij Verhaal.</span></aside>}
        <div className="field-row">
          <form.Field name="occurredAt" listeners={clearSaveState} validators={{ onChange: requiredText("Geef de datum en tijd op."), onSubmit: requiredText("Geef de datum en tijd op.") }}>{(field) => <TextField field={field} label="Datum en tijd" required type="datetime-local" />}</form.Field>
          <form.Field name="title" listeners={clearSaveState} validators={{ onChange: requiredText("Geef de reisupdate een titel."), onSubmit: requiredText("Geef de reisupdate een titel.") }}>{(field) => <TextField field={field} label="Titel" required maxLength={160} placeholder="Bijvoorbeeld: eerste avond" />}</form.Field>
        </div>
        <form.Field name="notes" listeners={clearSaveState}>{(field) => <TextAreaField field={field} label="Privénotitie" optional maxLength={10000} rows={6} placeholder="Wat wil je onthouden? Dit deel je nooit." />}</form.Field>
        <fieldset className="location"><legend>Privéfoto’s koppelen</legend><p>Een koppeling is privé. EXIF wordt alleen hieronder als voorstel gebruikt; geen datum of plaats verandert zonder jouw keuze.</p>
          <p className="help" role="status">{mediaState}</p>
          {media.map((asset) => <label className="media-choice" key={asset.id}><input type="checkbox" checked={draft.mediaAssetIds.includes(asset.id)} onChange={() => toggleMedia(asset.id)} />{asset.original_filename ?? "Naamloze foto"}{asset.captured_at ? ` · ${timestamp(asset.captured_at)}` : ""}</label>)}
          {attachedMedia.map((asset) => !dismissedSuggestions.includes(asset.id) && (asset.captured_at || asset.gps) && <aside className="exif-suggestion" key={`suggestion-${asset.id}`}><strong>Voorstel uit {asset.original_filename ?? "deze foto"}</strong>
            {asset.captured_at && <span>Opname: {timestamp(asset.captured_at)}.</span>}
            <div className="button-row">{asset.captured_at && <button className="secondary compact" type="button" onClick={() => { updateDraft({ occurredAt: localDateTime(new Date(asset.captured_at!)) }); setSaveState("Opnamedatum als voorstel overgenomen — pas hem gerust aan."); }}>Gebruik opnamedatum</button>}{asset.gps && <button className="secondary compact" type="button" onClick={() => reverseGeocode(asset.gps!)}>Zoek plaats bij foto</button>}<button className="secondary compact" type="button" onClick={() => setDismissedSuggestions((current) => [...current, asset.id])}>Voorstel negeren</button></div>
          </aside>)}
          {attachedMedia.filter((asset) => asset.captured_at || asset.gps).length > 1 && <p className="help">Foto’s kunnen verschillen. Elk voorstel blijft afzonderlijk zichtbaar; jij kiest er hoogstens één en kunt die altijd weer aanpassen.</p>}
        </fieldset>
        <fieldset className="location"><legend>Exacte plaats — volledig optioneel</legend><p>Zoek en kies een plaats. Deze wordt pas samen met jouw opgeslagen reisupdate als private plaats gemaakt.</p>
          {candidateGps && <aside className="exif-suggestion"><strong>Gekozen locatie uit kandidaat</strong><span>Deze EXIF-coördinaat blijft privé en is nog niet opgezocht of opgeslagen.</span><div className="button-row"><button className="secondary compact" type="button" onClick={() => reverseGeocode(candidateGps)}>Zoek deze kandidaatplaats</button><button className="secondary compact" type="button" onClick={() => setCandidateGps(null)}>Locatie negeren</button></div></aside>}
          <div className="field-row"><label>Zoek plaats<input value={placeQuery} onChange={(event) => setPlaceQuery(event.target.value)} placeholder="Bijvoorbeeld: Taipei Main Station" /></label><div className="button-field"><button className="secondary" type="button" onClick={searchPlace}>Zoeken</button></div></div>
          {draft.place && <p className="selected-place"><strong>Gekozen plaats:</strong> {draft.place.display_name ?? draft.place.locality ?? "Naamloze plaats"} <button className="secondary compact" type="button" onClick={() => updateDraft({ place: null })}>Verwijderen</button></p>}
          {placeState && <p className="help" role="status">{placeState}</p>}
          {placeResults && <div className="place-results">{placeResults.results.map((result) => <button className="place-result" type="button" key={`${result.osm_element_type}-${result.osm_element_id}`} onClick={() => selectPlace(result)}>{result.display_name}</button>)}<p className="help">Zoekresultaten: <a href={placeResults.attribution_url} target="_blank" rel="noreferrer">{placeResults.attribution}</a></p></div>}
        </fieldset>
        <div className="save-row"><button type="submit" disabled={record.pending}>{draft.updateId ? "Wijzigingen opslaan" : "Reisupdate opslaan"}</button><span aria-live="polite">{record.serverError ?? (saveState || draftState)}</span></div>
      </form>
      {selectedTrip && selectedTrip.travel_updates.length > 0 && <section className="saved-moments"><h3>Opgeslagen reisupdates</h3>{selectedTrip.travel_updates.slice().sort((left, right) => right.occurred_at.localeCompare(left.occurred_at)).map((update) => <button className="moment-row" type="button" key={update.id} onClick={() => editUpdate(update)}><strong>{update.title}</strong><span>{timestamp(update.occurred_at)}{update.place ? ` · ${update.place.display_name}` : " · zonder locatie"}</span></button>)}</section>}
      {confirmation.dialog}
    </section>
  );
}
