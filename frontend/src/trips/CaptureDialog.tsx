import { useStore } from "@tanstack/react-form";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth-context";
import { AsyncSearchSelect, requiredText, TextField } from "../forms/fields";
import { MarkdownField } from "../forms/MarkdownField";
import { useConfirmation } from "../forms/useConfirmation";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource, useTripSearch, useTripsQuery } from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import {
  clearDraft,
  emptyDraft,
  formatInstant,
  localDateTime,
  readDraft,
  saveDraft,
  type MediaAsset,
  type TravelUpdate,
  type UpdateDraft,
  type PlaceSearchResponse,
  type PlaceSearchResult,
  type TravelUpdateCandidateIntent,
} from "../tracker-model";

const timestamp = formatInstant;
const SAVE_FALLBACK = "De reisupdate kon niet worden opgeslagen. Je lokale concept blijft bewaard.";

export type CaptureDialogProps = {
  open: boolean;
  /** Locks the dialog to one trip — the trip-header action never makes the owner reselect it. Omit for the global entry, which asks. */
  lockedTripId?: string | null;
  /** A travel update candidate handed off from the media review (replaces the earlier `navigate("/capture", { state })`). */
  candidate?: TravelUpdateCandidateIntent | null;
  onCandidateConsumed?: () => void;
  onDismiss: () => void;
};

/** The shared capture form (date/time, title, private notes, media, optional location) as an
 * accessible dialog over the current workspace. Drafts are kept per trip, so opening this for
 * one trip never reads or silently overwrites another trip's unsaved draft. */
export function CaptureDialog({
  open,
  lockedTripId = null,
  candidate = null,
  onCandidateConsumed,
  onDismiss,
}: CaptureDialogProps) {
  const confirmation = useConfirmation();
  const { session } = useAuth();
  const tripsQuery = useTripsQuery();
  const searchTrips = useTripSearch();
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const [connection, setConnection] = useState(navigator.onLine);
  const [draftState, setDraftState] = useState("Concept laden…");
  const [saveState, setSaveState] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<PlaceSearchResponse | null>(null);
  const [placeState, setPlaceState] = useState("");
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  const [candidateGps, setCandidateGps] = useState<{ latitude: number; longitude: number } | null>(null);
  const initialized = useRef(false);

  const saveUpdate = useOwnerMutation<
    { tripId: string; updateId: string | null; payload: Record<string, unknown> },
    TravelUpdate
  >({
    fallback: SAVE_FALLBACK,
    request: ({ tripId, updateId, payload }) => ({
      path: updateId ? tripPath(tripId, `travel-updates/${updateId}`) : tripPath(tripId, "travel-updates"),
      method: updateId ? "PATCH" : "POST",
      body: payload,
    }),
    // A travel update may create a reusable location and its derived area alongside the trip's embedded update list.
    invalidate: (subject, { tripId }) => [
      ownerKeys.trips(subject),
      ownerKeys.tripResource(subject, tripId, "locations"),
      ownerKeys.tripResource(subject, tripId, "areas"),
    ],
  });
  const deleteUpdate = useOwnerMutation<{ tripId: string; updateId: string }>({
    fallback: "De reisupdate kon niet worden verwijderd.",
    request: ({ tripId, updateId }) => ({ path: tripPath(tripId, `travel-updates/${updateId}`), method: "DELETE" }),
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });
  // A search phrase or a photo's coordinates are private: those calls are dropped from the mutation cache once settled.
  const searchPlaces = useOwnerMutation<{ tripId: string; query: string }, PlaceSearchResponse>({
    fallback: "Locaties zoeken is nu niet beschikbaar.",
    request: ({ tripId, query }) => ({ path: tripPath(tripId, "places/search"), method: "POST", body: { query } }),
    invalidate: () => [],
    gcTime: 0,
  });
  const reversePlaces = useOwnerMutation<{ tripId: string; latitude: number; longitude: number }, PlaceSearchResponse>({
    fallback: "Deze fotolocatie kon niet worden opgezocht.",
    request: ({ tripId, latitude, longitude }) => ({
      path: tripPath(tripId, "places/reverse"),
      method: "POST",
      body: { latitude, longitude },
    }),
    invalidate: () => [],
    gcTime: 0,
  });

  const record = useRecordForm<UpdateDraft, TravelUpdate>({
    defaultValues: emptyDraft(lockedTripId ?? candidate?.tripId ?? ""),
    fallback: SAVE_FALLBACK,
    submit: async (values) => {
      if (!session || !values.tripId) throw new Error("Kies eerst een reis en meld aan om op te slaan.");
      if (!connection)
        throw new Error(
          "Je bent offline. Dit concept blijft alleen lokaal bewaard en wordt niet automatisch verstuurd.",
        );
      setSaveState("Opslaan…");
      // A place that already exists on the server is left as it is: sending it again would make a new one and lose its public name.
      const keepsLocation = Boolean((values.location as { id?: string } | null)?.id);
      return saveUpdate.mutateAsync({
        tripId: values.tripId,
        updateId: values.updateId,
        payload: {
          occurred_at: new Date(values.occurredAt).toISOString(),
          title: values.title.trim(),
          private_notes: values.notes.trim() || null,
          ...(keepsLocation ? {} : { location: values.location }),
          media_asset_ids: values.mediaAssetIds,
        },
      });
    },
    onSuccess: (_saved, values) => {
      clearDraft(values.tripId);
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
  const lockedTrip = useMemo(
    () => (lockedTripId ? (trips.find((trip) => trip.id === lockedTripId) ?? null) : null),
    [lockedTripId, trips],
  );
  // The dialog stays mounted (closed) over its workspace, so media is only fetched once it is actually open.
  const mediaQuery = useTripResource(open && selectedTrip ? selectedTrip.id : null, "media");
  const media = useMemo(
    () => (mediaQuery.data ?? []).filter((asset) => asset.media_kind === "photo"),
    [mediaQuery.data],
  );
  const attachedMedia = useMemo(
    () =>
      draft.mediaAssetIds
        .map((id) => media.find((asset) => asset.id === id))
        .filter((asset): asset is MediaAsset => Boolean(asset)),
    [draft.mediaAssetIds, media],
  );
  const mediaState = !selectedTrip
    ? ""
    : mediaQuery.error
      ? errorMessage(mediaQuery.error, "Je media konden niet worden geladen.")
      : mediaQuery.isPending
        ? "Media laden…"
        : mediaQuery.data?.length
          ? "Kies privéfoto’s om aan deze reisupdate te koppelen."
          : "Nog geen foto’s in deze reis.";

  useEffect(() => {
    const updateConnection = () => setConnection(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  // Loads the right trip's draft (or the candidate handed off from media review) exactly once trips are known —
  // never before, so an empty baseline is never mistaken for "no draft" and saved over a real one.
  useEffect(() => {
    if (initialized.current || trips.length === 0) return;
    const tripId = lockedTripId ?? candidate?.tripId ?? trips[0].id;
    if (!trips.some((trip) => trip.id === tripId)) return;
    initialized.current = true;
    if (candidate && candidate.tripId === tripId) {
      record.load({
        ...emptyDraft(tripId),
        occurredAt: candidate.occurredAt ? localDateTime(new Date(candidate.occurredAt)) : localDateTime(),
        mediaAssetIds: candidate.mediaAssetIds,
      });
      setCandidateGps(candidate.gps ?? null);
      setDraftState("Kandidaat overgenomen als lokaal concept. Kies zelf een locatie en sla pas op wanneer je wilt.");
      onCandidateConsumed?.();
      return;
    }
    const stored = readDraft(tripId);
    record.load(stored ?? emptyDraft(tripId));
    setDraftState(stored ? "Lokaal concept hersteld." : "Nieuw concept.");
    // `record.load` is a stable identity from `useRecordForm`; only the inputs that decide *which* draft to load matter here.
  }, [lockedTripId, candidate, trips, onCandidateConsumed]);

  useEffect(() => {
    if (!initialized.current || !draft.tripId) return;
    if (!draft.updateId && !draft.title && !draft.notes) {
      clearDraft(draft.tripId);
      return;
    }
    saveDraft(draft);
    setDraftState("Concept lokaal bewaard — nog niet naar je reis gestuurd.");
  }, [draft]);

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

  function selectTrip(tripId: string) {
    const stored = readDraft(tripId);
    record.load(stored ?? emptyDraft(tripId));
    setDraftState(stored ? "Lokaal concept hersteld." : "Nieuw concept.");
    resetPlaceSearch();
    setSaveState("");
  }

  function startNew() {
    record.load(emptyDraft(selectedTrip?.id ?? lockedTripId ?? trips[0]?.id ?? ""));
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
      location: update.location,
      mediaAssetIds: update.media_asset_ids,
    });
    resetPlaceSearch();
    setSaveState("Je bewerkt een opgeslagen reisupdate.");
  }

  function toggleMedia(assetId: string) {
    updateDraft({
      mediaAssetIds: draft.mediaAssetIds.includes(assetId)
        ? draft.mediaAssetIds.filter((id) => id !== assetId)
        : [...draft.mediaAssetIds, assetId],
    });
    setDismissedSuggestions((current) => current.filter((id) => id !== assetId));
  }

  function selectPlace(result: PlaceSearchResult) {
    updateDraft({ location: result });
    setPlaceState("Locatie geselecteerd. Hij wordt pas gemaakt wanneer je de reisupdate opslaat.");
    setPlaceResults(null);
  }

  function searchPlace() {
    if (!session || !selectedTrip || placeQuery.trim().length < 2) {
      setPlaceState("Vul minstens twee tekens in om een locatie te zoeken.");
      return;
    }
    setPlaceState("Locaties zoeken…");
    searchPlaces.mutateAsync({ tripId: selectedTrip.id, query: placeQuery.trim() }).then(
      (result) => {
        setPlaceResults(result);
        setPlaceState(
          result.results.length ? "Kies een resultaat. Er wordt nog niets opgeslagen." : "Geen locaties gevonden.",
        );
      },
      (error: unknown) => setPlaceState(errorMessage(error, "Locaties zoeken is mislukt.")),
    );
  }

  function reverseGeocode(gps: { latitude: number; longitude: number }) {
    if (!session || !selectedTrip) return;
    setPlaceState("De fotolocatie wordt alleen voor jou opgezocht…");
    reversePlaces.mutateAsync({ tripId: selectedTrip.id, ...gps }).then(
      (result) => {
        setPlaceResults(result);
        setPlaceState(
          result.results.length
            ? "Kies de voorgestelde locatie. Er wordt nog niets opgeslagen."
            : "Voor deze fotolocatie is geen plaats gevonden.",
        );
      },
      (error: unknown) => setPlaceState(errorMessage(error, "Deze fotolocatie kon niet worden opgezocht.")),
    );
  }

  function removeUpdate() {
    const { updateId } = draft;
    if (!selectedTrip || !updateId) return;
    confirmation.ask({
      title: `Reisupdate “${draft.title}” verwijderen?`,
      onConfirm: () => performRemoveUpdate(selectedTrip.id, updateId),
    });
  }

  function performRemoveUpdate(tripId: string, updateId: string) {
    setSaveState("Reisupdate verwijderen…");
    deleteUpdate.mutateAsync({ tripId, updateId }).then(
      () => {
        clearDraft(tripId);
        startNew();
        setDraftState("Reisupdate verwijderd.");
      },
      (error: unknown) => setSaveState(errorMessage(error, "De reisupdate kon niet worden verwijderd.")),
    );
  }

  const clearSaveState = { onChange: () => setSaveState("") };
  const dialogTitle = lockedTrip
    ? `Moment vastleggen — ${lockedTrip.title}`
    : draft.updateId
      ? "Reisupdate bewerken"
      : "Nieuwe reisupdate";

  return (
    <RecordDialog open={open} title={dialogTitle} dirty={initialized.current && record.dirty} onDismiss={onDismiss}>
      {!session && (
        <p>Meld aan om een concept lokaal te bewaren of een reisupdate aan een private reis toe te voegen.</p>
      )}
      {session && tripsQuery.isPending && (
        <p>{connection ? "Je reizen laden…" : "Je bent offline. Je reizen laden zodra je opnieuw verbinding hebt."}</p>
      )}
      {session && tripsQuery.isError && (
        <p>{errorMessage(tripsQuery.error, "Je reizen konden niet worden geladen.")}</p>
      )}
      {session && !tripsQuery.isPending && !tripsQuery.isError && trips.length === 0 && (
        <p>Maak eerst een private reis aan; daarna kun je hier een reisupdate aan toevoegen.</p>
      )}
      {session && trips.length > 0 && (
        <>
          {draft.updateId && (
            <div className="capture-heading">
              <p className="eyebrow">Mobiel vastleggen</p>
              <div className="button-row">
                <button className="secondary compact" type="button" onClick={startNew}>
                  Nieuwe reisupdate
                </button>
                <button className="danger compact" type="button" onClick={removeUpdate}>
                  Verwijderen
                </button>
              </div>
            </div>
          )}
          <p className={`connection ${connection ? "online" : "offline"}`} role="status">
            {connection
              ? "Verbonden — je kiest zelf wanneer je opslaat."
              : "Offline — concepten blijven lokaal; er is geen automatische synchronisatie."}
          </p>
          <form
            ref={record.formRef}
            className="capture-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            {lockedTrip ? (
              <p className="capture-trip-context">
                Reis: <strong>{lockedTrip.title}</strong>
              </p>
            ) : (
              <label>
                Reis
                <AsyncSearchSelect
                  ariaLabel="Reis"
                  value={draft.tripId}
                  selectedOption={selectedTrip ? { value: selectedTrip.id, label: selectedTrip.title } : null}
                  defaultOptions={trips.slice(0, 50).map((trip) => ({ value: trip.id, label: trip.title }))}
                  onChange={selectTrip}
                  loadOptions={async (q) =>
                    (await searchTrips(q)).map((trip) => ({ value: trip.id, label: trip.title }))
                  }
                />
              </label>
            )}
            {selectedTrip && (
              <aside className="publication" aria-label="Delen van deze reisupdate">
                <strong>Voor je opslaat</strong>
                <span>
                  Een nieuwe reisupdate is privé. Je notities, locatie en foto’s worden nooit gedeeld; de tekst voor
                  bezoekers schrijf je later bij Verhaal.
                </span>
              </aside>
            )}
            <div className="field-row">
              <form.Field
                name="occurredAt"
                listeners={clearSaveState}
                validators={{
                  onChange: requiredText("Geef de datum en tijd op."),
                  onSubmit: requiredText("Geef de datum en tijd op."),
                }}
              >
                {(field) => <TextField field={field} label="Datum en tijd" required type="datetime-local" />}
              </form.Field>
              <form.Field
                name="title"
                listeners={clearSaveState}
                validators={{
                  onChange: requiredText("Geef de reisupdate een titel."),
                  onSubmit: requiredText("Geef de reisupdate een titel."),
                }}
              >
                {(field) => (
                  <TextField
                    field={field}
                    label="Titel"
                    required
                    maxLength={160}
                    placeholder="Bijvoorbeeld: eerste avond"
                  />
                )}
              </form.Field>
            </div>
            <form.Field name="notes" listeners={clearSaveState}>
              {(field) => (
                <MarkdownField
                  field={field}
                  label="Privénotitie"
                  optional
                  maxLength={10000}
                  rows={6}
                  placeholder="Wat wil je onthouden? Dit deel je nooit."
                />
              )}
            </form.Field>
            <fieldset className="location">
              <legend>Privéfoto’s koppelen</legend>
              <p>
                Een koppeling is privé. EXIF wordt alleen hieronder als voorstel gebruikt; geen datum of plaats
                verandert zonder jouw keuze.
              </p>
              <p className="help" role="status">
                {mediaState}
              </p>
              {media.map((asset) => (
                <label className="media-choice" key={asset.id}>
                  <input
                    type="checkbox"
                    checked={draft.mediaAssetIds.includes(asset.id)}
                    onChange={() => toggleMedia(asset.id)}
                  />
                  {asset.original_filename ?? "Naamloze foto"}
                  {asset.captured_at ? ` · ${timestamp(asset.captured_at)}` : ""}
                </label>
              ))}
              {attachedMedia.map(
                (asset) =>
                  !dismissedSuggestions.includes(asset.id) &&
                  (asset.captured_at || asset.gps) && (
                    <aside className="exif-suggestion" key={`suggestion-${asset.id}`}>
                      <strong>Voorstel uit {asset.original_filename ?? "deze foto"}</strong>
                      {asset.captured_at && <span>Opname: {timestamp(asset.captured_at)}.</span>}
                      <div className="button-row">
                        {asset.captured_at && (
                          <button
                            className="secondary compact"
                            type="button"
                            onClick={() => {
                              updateDraft({ occurredAt: localDateTime(new Date(asset.captured_at!)) });
                              setSaveState("Opnamedatum als voorstel overgenomen — pas hem gerust aan.");
                            }}
                          >
                            Gebruik opnamedatum
                          </button>
                        )}
                        {asset.gps && (
                          <button
                            className="secondary compact"
                            type="button"
                            onClick={() => reverseGeocode(asset.gps!)}
                          >
                            Zoek plaats bij foto
                          </button>
                        )}
                        <button
                          className="secondary compact"
                          type="button"
                          onClick={() => setDismissedSuggestions((current) => [...current, asset.id])}
                        >
                          Voorstel negeren
                        </button>
                      </div>
                    </aside>
                  ),
              )}
              {attachedMedia.filter((asset) => asset.captured_at || asset.gps).length > 1 && (
                <p className="help">
                  Foto’s kunnen verschillen. Elk voorstel blijft afzonderlijk zichtbaar; jij kiest er hoogstens één en
                  kunt die altijd weer aanpassen.
                </p>
              )}
            </fieldset>
            <fieldset className="location">
              <legend>Locatie — volledig optioneel</legend>
              <p>
                Zoek en kies een locatie. Deze wordt pas samen met jouw opgeslagen reisupdate als privélocatie gemaakt.
              </p>
              {candidateGps && (
                <aside className="exif-suggestion">
                  <strong>Gekozen locatie uit kandidaat</strong>
                  <span>Deze EXIF-coördinaat blijft privé en is nog niet opgezocht of opgeslagen.</span>
                  <div className="button-row">
                    <button className="secondary compact" type="button" onClick={() => reverseGeocode(candidateGps)}>
                      Zoek deze kandidaatplaats
                    </button>
                    <button className="secondary compact" type="button" onClick={() => setCandidateGps(null)}>
                      Locatie negeren
                    </button>
                  </div>
                </aside>
              )}
              <div className="field-row">
                <label>
                  Zoek locatie
                  <input
                    value={placeQuery}
                    onChange={(event) => setPlaceQuery(event.target.value)}
                    placeholder="Bijvoorbeeld: Taipei Main Station"
                  />
                </label>
                <div className="button-field">
                  <button className="secondary" type="button" onClick={searchPlace}>
                    Zoeken
                  </button>
                </div>
              </div>
              {draft.location && (
                <p className="selected-place">
                  <strong>Gekozen locatie:</strong>{" "}
                  {draft.location.display_name ?? draft.location.locality ?? "Naamloze locatie"}{" "}
                  <button className="secondary compact" type="button" onClick={() => updateDraft({ location: null })}>
                    Verwijderen
                  </button>
                </p>
              )}
              {placeState && (
                <p className="help" role="status">
                  {placeState}
                </p>
              )}
              {placeResults && (
                <div className="place-results">
                  {placeResults.results.map((result) => (
                    <button
                      className="place-result"
                      type="button"
                      key={`${result.osm_element_type}-${result.osm_element_id}`}
                      onClick={() => selectPlace(result)}
                    >
                      {result.display_name}
                    </button>
                  ))}
                  <p className="help">
                    Zoekresultaten:{" "}
                    <a href={placeResults.attribution_url} target="_blank" rel="noreferrer">
                      {placeResults.attribution}
                    </a>
                  </p>
                </div>
              )}
            </fieldset>
            <div className="save-row">
              <button type="submit" disabled={record.pending}>
                {draft.updateId ? "Wijzigingen opslaan" : "Reisupdate opslaan"}
              </button>
              <span aria-live="polite">{record.serverError ?? (saveState || draftState)}</span>
            </div>
          </form>
          {selectedTrip && selectedTrip.travel_updates.length > 0 && (
            <section className="saved-records">
              <h3>Opgeslagen reisupdates</h3>
              {selectedTrip.travel_updates
                .slice()
                .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
                .map((update) => (
                  <button className="update-row" type="button" key={update.id} onClick={() => editUpdate(update)}>
                    <strong>{update.title}</strong>
                    <span>
                      {timestamp(update.occurred_at)}
                      {update.location ? ` · ${update.location.display_name}` : " · zonder locatie"}
                    </span>
                  </button>
                ))}
            </section>
          )}
        </>
      )}
      {confirmation.dialog}
    </RecordDialog>
  );
}
