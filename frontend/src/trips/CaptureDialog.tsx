import { m } from "../paraglide/messages.js";
import { errorNotice, useFeedback } from "../query/feedback";
import { TravelCheckbox } from "../ui/TravelCheckbox";
import { Input } from "@base-ui/react/input";
import { Button } from "@base-ui/react/button";
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
import { Field, FieldLabel, FieldSet, FieldLegend } from "../ui/field";

const timestamp = formatInstant;
const SAVE_FALLBACK = m.api_capture_save;

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
  const [saveState, setSaveState] = useFeedback<string>("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<PlaceSearchResponse | null>(null);
  const [placeState, setPlaceState] = useFeedback<string>("");
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
    // A candidate is a deliberate handoff, so it is taken even when the dialog — mounted closed over the trip
    // workspace — has already loaded a stored draft; only the stored-draft path runs once.
    if ((initialized.current && !candidate) || trips.length === 0) return;
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
      (error: unknown) => setPlaceState(errorNotice(error, "Locaties zoeken is mislukt.")),
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
      (error: unknown) => setPlaceState(errorNotice(error, "Deze fotolocatie kon niet worden opgezocht.")),
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
      (error: unknown) => setSaveState(errorNotice(error, "De reisupdate kon niet worden verwijderd.")),
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
              <p className="travel-eyebrow">Mobiel vastleggen</p>
              <div className="button-row">
                <Button className="secondary compact" type="button" onClick={startNew}>
                  Nieuwe reisupdate
                </Button>
                <Button className="danger compact" type="button" onClick={removeUpdate}>
                  Verwijderen
                </Button>
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
            className="grid gap-4.5 rounded-travel-card border border-travel-card-border bg-travel-surface p-5 shadow-travel-card"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            {lockedTrip ? (
              <p className="m-0 font-bold text-travel-forest">
                Reis: <strong>{lockedTrip.title}</strong>
              </p>
            ) : (
              <Field>
                <FieldLabel>Reis</FieldLabel>
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
              </Field>
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
            <FieldSet className="location">
              <FieldLegend>Privéfoto’s koppelen</FieldLegend>
              <p>
                Een koppeling is privé. EXIF wordt alleen hieronder als voorstel gebruikt; geen datum of plaats
                verandert zonder jouw keuze.
              </p>
              <p className="help" role="status">
                {mediaState}
              </p>
              {media.map((asset) => (
                <Field className="contents" key={asset.id}>
                  <FieldLabel className="flex items-center gap-2 rounded-lg border border-travel-divider bg-travel-surface px-2.75 py-2.5 font-semibold">
                    <TravelCheckbox
                      checked={draft.mediaAssetIds.includes(asset.id)}
                      onCheckedChange={() => toggleMedia(asset.id)}
                    />
                    {asset.original_filename ?? "Naamloze foto"}
                    {asset.captured_at ? ` · ${timestamp(asset.captured_at)}` : ""}
                  </FieldLabel>
                </Field>
              ))}
              {attachedMedia.map(
                (asset) =>
                  !dismissedSuggestions.includes(asset.id) &&
                  (asset.captured_at || asset.gps) && (
                    <aside
                      className="grid gap-2 rounded-travel-media border border-travel-warning-border bg-travel-warning-surface p-3.25 text-sm leading-normal text-travel-warning-ink [&_span]:text-travel-warning-muted"
                      key={`suggestion-${asset.id}`}
                    >
                      <strong>Voorstel uit {asset.original_filename ?? "deze foto"}</strong>
                      {asset.captured_at && <span>Opname: {timestamp(asset.captured_at)}.</span>}
                      <div className="button-row">
                        {asset.captured_at && (
                          <Button
                            className="secondary compact"
                            type="button"
                            onClick={() => {
                              updateDraft({ occurredAt: localDateTime(new Date(asset.captured_at!)) });
                              setSaveState("Opnamedatum als voorstel overgenomen — pas hem gerust aan.");
                            }}
                          >
                            Gebruik opnamedatum
                          </Button>
                        )}
                        {asset.gps && (
                          <Button
                            className="secondary compact"
                            type="button"
                            onClick={() => reverseGeocode(asset.gps!)}
                          >
                            Zoek plaats bij foto
                          </Button>
                        )}
                        <Button
                          className="secondary compact"
                          type="button"
                          onClick={() => setDismissedSuggestions((current) => [...current, asset.id])}
                        >
                          Voorstel negeren
                        </Button>
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
            </FieldSet>
            <FieldSet className="location">
              <FieldLegend>Locatie — volledig optioneel</FieldLegend>
              <p>
                Zoek en kies een locatie. Deze wordt pas samen met jouw opgeslagen reisupdate als privélocatie gemaakt.
              </p>
              {candidateGps && (
                <aside className="grid gap-2 rounded-travel-media border border-travel-warning-border bg-travel-warning-surface p-3.25 text-sm leading-normal text-travel-warning-ink [&_span]:text-travel-warning-muted">
                  <strong>Gekozen locatie uit kandidaat</strong>
                  <span>Deze EXIF-coördinaat blijft privé en is nog niet opgezocht of opgeslagen.</span>
                  <div className="button-row">
                    <Button className="secondary compact" type="button" onClick={() => reverseGeocode(candidateGps)}>
                      Zoek deze kandidaatplaats
                    </Button>
                    <Button className="secondary compact" type="button" onClick={() => setCandidateGps(null)}>
                      Locatie negeren
                    </Button>
                  </div>
                </aside>
              )}
              <div className="field-row">
                <Field className="contents">
                  <FieldLabel>
                    Zoek locatie
                    <Input
                      value={placeQuery}
                      onChange={(event) => setPlaceQuery(event.target.value)}
                      placeholder="Bijvoorbeeld: Taipei Main Station"
                    />
                  </FieldLabel>
                </Field>
                <div className="flex items-end">
                  <Button className="secondary" type="button" onClick={searchPlace}>
                    Zoeken
                  </Button>
                </div>
              </div>
              {draft.location && (
                <p className="flex flex-wrap items-center gap-2">
                  <strong>Gekozen locatie:</strong>{" "}
                  {draft.location.display_name ?? draft.location.locality ?? "Naamloze locatie"}{" "}
                  <Button className="secondary compact" type="button" onClick={() => updateDraft({ location: null })}>
                    Verwijderen
                  </Button>
                </p>
              )}
              {placeState && (
                <p className="help" role="status">
                  {placeState}
                </p>
              )}
              {placeResults && (
                <div className="grid gap-1.75">
                  {placeResults.results.map((result) => (
                    <Button
                      className="w-full border border-travel-border bg-travel-surface text-left font-semibold text-travel-ink"
                      type="button"
                      key={`${result.osm_element_type}-${result.osm_element_id}`}
                      onClick={() => selectPlace(result)}
                    >
                      {result.display_name}
                    </Button>
                  ))}
                  <p className="help">
                    Zoekresultaten:{" "}
                    <a href={placeResults.attribution_url} target="_blank" rel="noreferrer">
                      {placeResults.attribution}
                    </a>
                  </p>
                </div>
              )}
            </FieldSet>
            <div className="flex flex-wrap items-center gap-3 [&_span]:text-sm [&_span]:leading-normal [&_span]:text-travel-muted">
              <Button type="submit" disabled={record.pending}>
                {draft.updateId ? "Wijzigingen opslaan" : "Reisupdate opslaan"}
              </Button>
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
                  <Button
                    className="grid w-full gap-0.75 border border-travel-card-border bg-travel-surface p-3.5 text-left text-travel-ink shadow-sm [&_span]:text-sm [&_span]:font-medium [&_span]:text-travel-muted"
                    type="button"
                    key={update.id}
                    onClick={() => editUpdate(update)}
                  >
                    <strong>{update.title}</strong>
                    <span>
                      {timestamp(update.occurred_at)}
                      {update.location ? ` · ${update.location.display_name}` : " · zonder locatie"}
                    </span>
                  </Button>
                ))}
            </section>
          )}
        </>
      )}
      {confirmation.dialog}
    </RecordDialog>
  );
}
