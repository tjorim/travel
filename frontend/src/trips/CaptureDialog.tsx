import { Button } from "@base-ui/react/button";
import { useStore } from "@tanstack/react-form";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth-context";
import { requiredText, TextField } from "../forms/fields";
import { DateTimeField } from "../forms/DateTimeFields";
import { MarkdownField } from "../forms/MarkdownField";
import { blockUnreadableEntries } from "../forms/unreadable-entry";
import { useConfirmation } from "../forms/useConfirmation";
import { useRecordForm } from "../forms/useRecordForm";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorMessage } from "../query/api";
import { errorNotice, FeedbackError, textNotice, useFeedback } from "../query/feedback";
import { useTripSearch, useTripsQuery } from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import {
  captureInputValue,
  clearDraft,
  emptyDraft,
  localDateTime,
  readDraft,
  saveDraft,
  type MediaAsset,
  type PlaceSearchResult,
  type TravelUpdate,
  type TravelUpdateCandidateIntent,
  type UpdateDraft,
} from "../tracker-model";
import { LocationSearch } from "./capture/LocationSearch";
import { PhotoLinks } from "./capture/PhotoLinks";
import { SavedUpdates } from "./capture/SavedUpdates";
import { TripChoice } from "./capture/TripChoice";
import { useCaptureMedia } from "./capture/use-capture-media";
import { SAVE_FALLBACK, useCaptureMutations } from "./capture/use-capture-mutations";
import { usePlaceSearch } from "./capture/use-place-search";

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
  useLocale();
  const confirmation = useConfirmation();
  const { session } = useAuth();
  const tripsQuery = useTripsQuery();
  const searchTrips = useTripSearch();
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const [connection, setConnection] = useState(navigator.onLine);
  const [draftState, setDraftState] = useFeedback<string>(
    textNotice(() => m.owner_loading_draft()),
  );
  const [saveState, setSaveState] = useFeedback<string>("");
  const initialized = useRef(false);

  const { saveUpdate, deleteUpdate } = useCaptureMutations();

  const record = useRecordForm<UpdateDraft, TravelUpdate>({
    defaultValues: emptyDraft(lockedTripId ?? candidate?.tripId ?? ""),
    fallback: SAVE_FALLBACK,
    submit: async (values) => {
      if (!session || !values.tripId)
        throw new FeedbackError(() => m.owner_choose_a_trip_and_sign_in_first_to_save());
      if (!connection)
        throw new FeedbackError(() =>
          m.owner_you_are_offline_this_draft_stays_on_this_device_and_is_not_sent_automati(),
        );
      setSaveState(textNotice(() => m.owner_saving()));
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
      setDraftState(textNotice(() => m.owner_saved_to_your_private_trip()));
      setSaveState(textNotice(() => m.owner_travel_update_saved()));
      record.load(emptyDraft(values.tripId));
      places.reset();
    },
  });
  const draft = record.values;
  const { form } = record;
  const draftTripId = useStore(form.store, (state) => state.values.tripId);
  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === draftTripId) ?? null,
    [draftTripId, trips],
  );
  const lockedTrip = useMemo(
    () => (lockedTripId ? (trips.find((trip) => trip.id === lockedTripId) ?? null) : null),
    [lockedTripId, trips],
  );
  const { media, attachedMedia, mediaState } = useCaptureMedia(
    selectedTrip?.id ?? null,
    open,
    draft.mediaAssetIds,
  );
  const places = usePlaceSearch(selectedTrip?.id ?? null, Boolean(session));

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
        occurredAt: candidate.occurredAt
          ? captureInputValue(candidate.occurredAt, candidate.occurredAtLocal ?? false)
          : localDateTime(),
        mediaAssetIds: candidate.mediaAssetIds,
      });
      places.setCandidateGps(candidate.gps ?? null);
      setDraftState(
        textNotice(() =>
          m.owner_candidate_copied_into_a_local_draft_choose_a_location_yourself_and_save(),
        ),
      );
      onCandidateConsumed?.();
      return;
    }
    const stored = readDraft(tripId);
    record.load(stored ?? emptyDraft(tripId));
    setDraftState(
      textNotice(() => (stored ? m.owner_local_draft_restored() : m.owner_new_draft())),
    );
    // `record.load` is a stable identity from `useRecordForm`; only the inputs that decide *which* draft to load matter here.
  }, [lockedTripId, candidate, trips, onCandidateConsumed]);

  useEffect(() => {
    if (!initialized.current || !draft.tripId) return;
    if (!draft.updateId && !draft.title && !draft.notes) {
      clearDraft(draft.tripId);
      return;
    }
    saveDraft(draft);
    setDraftState(textNotice(() => m.owner_draft_saved_locally_not_sent_to_your_trip_yet()));
  }, [draft]);

  function updateDraft(values: Partial<UpdateDraft>) {
    for (const [name, value] of Object.entries(values))
      form.setFieldValue(name as keyof UpdateDraft, value as never);
    setSaveState("");
  }

  function selectTrip(tripId: string) {
    const stored = readDraft(tripId);
    record.load(stored ?? emptyDraft(tripId));
    setDraftState(
      textNotice(() => (stored ? m.owner_local_draft_restored() : m.owner_new_draft())),
    );
    places.reset();
    setSaveState("");
  }

  function startNew() {
    record.load(emptyDraft(selectedTrip?.id ?? lockedTripId ?? trips[0]?.id ?? ""));
    places.reset();
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
    places.reset();
    setSaveState(textNotice(() => m.owner_you_are_editing_a_saved_travel_update()));
  }

  function toggleMedia(assetId: string) {
    updateDraft({
      mediaAssetIds: draft.mediaAssetIds.includes(assetId)
        ? draft.mediaAssetIds.filter((id) => id !== assetId)
        : [...draft.mediaAssetIds, assetId],
    });
    places.setDismissedSuggestions((current) => current.filter((id) => id !== assetId));
  }

  function adoptCaptureDate(asset: MediaAsset) {
    updateDraft({ occurredAt: captureInputValue(asset.captured_at!, asset.captured_local) });
    setSaveState(
      textNotice(() => m.owner_capture_date_used_as_a_suggestion_feel_free_to_change_it()),
    );
  }

  function selectPlace(result: PlaceSearchResult) {
    updateDraft({ location: result });
    places.chosen();
  }

  function removeUpdate() {
    const { updateId } = draft;
    if (!selectedTrip || !updateId) return;
    confirmation.ask({
      title: () => m.owner_delete_travel_update({ p0: draft.title }),
      onConfirm: () => performRemoveUpdate(selectedTrip.id, updateId),
    });
  }

  function performRemoveUpdate(tripId: string, updateId: string) {
    setSaveState(textNotice(() => m.owner_deleting_travel_update()));
    deleteUpdate.mutateAsync({ tripId, updateId }).then(
      () => {
        clearDraft(tripId);
        startNew();
        setDraftState(textNotice(() => m.owner_travel_update_deleted()));
      },
      (error: unknown) =>
        setSaveState(errorNotice(error, m.owner_the_travel_update_could_not_be_deleted)),
    );
  }

  const clearSaveState = { onChange: () => setSaveState("") };
  const dialogTitle = lockedTrip
    ? m.owner_capture_a_moment_2({ p0: lockedTrip.title })
    : draft.updateId
      ? m.owner_edit_travel_update()
      : m.owner_new_travel_update();

  return (
    <RecordDialog
      open={open}
      title={dialogTitle}
      dirty={initialized.current && record.dirty}
      onDismiss={onDismiss}
    >
      {!session && (
        <p>{m.owner_sign_in_to_save_a_draft_locally_or_add_a_travel_update_to_a_private_trip()}</p>
      )}
      {session && tripsQuery.isPending && (
        <p>
          {connection
            ? m.owner_loading_your_trips()
            : m.owner_you_are_offline_your_trips_will_load_once_you_reconnect()}
        </p>
      )}
      {session && tripsQuery.isError && (
        <p>{errorMessage(tripsQuery.error, m.owner_your_trips_could_not_be_loaded)}</p>
      )}
      {session && !tripsQuery.isPending && !tripsQuery.isError && trips.length === 0 && (
        <p>{m.owner_create_a_private_trip_first_then_you_can_add_a_travel_update_here()}</p>
      )}
      {session && trips.length > 0 && (
        <>
          {draft.updateId && (
            <div className="capture-heading">
              <p className="travel-eyebrow">{m.owner_mobile_capture()}</p>
              <div className="button-row">
                <Button className="secondary compact" type="button" onClick={startNew}>
                  {m.owner_new_travel_update()}
                </Button>
                <Button className="danger compact" type="button" onClick={removeUpdate}>
                  {m.owner_delete()}
                </Button>
              </div>
            </div>
          )}
          <p className={`connection ${connection ? "online" : "offline"}`} role="status">
            {connection
              ? m.owner_connected_you_choose_when_to_save()
              : m.owner_offline_drafts_stay_local_there_is_no_automatic_synchronisation()}
          </p>
          <form
            ref={record.formRef}
            className="grid gap-4.5 rounded-travel-card border border-travel-card-border bg-travel-surface p-5 shadow-travel-card"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (blockUnreadableEntries(record.formRef.current)) return;
              void form.handleSubmit();
            }}
          >
            <TripChoice
              lockedTrip={lockedTrip}
              selectedTrip={selectedTrip}
              draftTripId={draft.tripId}
              trips={trips}
              search={searchTrips}
              onSelect={selectTrip}
            />
            {selectedTrip && (
              <aside className="publication" aria-label={m.owner_sharing_this_travel_update()}>
                <strong>{m.owner_before_saving()}</strong>
                <span>
                  {m.owner_a_new_travel_update_is_private_your_notes_location_and_photos_are_never()}
                </span>
              </aside>
            )}
            <div className="field-row">
              <form.Field
                name="occurredAt"
                listeners={clearSaveState}
                validators={{
                  onChange: requiredText(m.owner_enter_the_date_and_time),
                  onSubmit: requiredText(m.owner_enter_the_date_and_time),
                }}
              >
                {(field) => (
                  <DateTimeField field={field} label={m.owner_date_and_time()} required />
                )}
              </form.Field>
              <form.Field
                name="title"
                listeners={clearSaveState}
                validators={{
                  onChange: requiredText(m.owner_give_the_travel_update_a_title),
                  onSubmit: requiredText(m.owner_give_the_travel_update_a_title),
                }}
              >
                {(field) => (
                  <TextField
                    field={field}
                    label={m.owner_title()}
                    required
                    maxLength={160}
                    placeholder={m.owner_for_example_first_evening()}
                  />
                )}
              </form.Field>
            </div>
            <form.Field name="notes" listeners={clearSaveState}>
              {(field) => (
                <MarkdownField
                  field={field}
                  label={m.owner_private_note()}
                  optional
                  maxLength={10000}
                  rows={6}
                  placeholder={m.owner_what_do_you_want_to_remember_you_never_share_this()}
                />
              )}
            </form.Field>
            <PhotoLinks
              mediaState={mediaState}
              media={media}
              attachedMedia={attachedMedia}
              selectedIds={draft.mediaAssetIds}
              dismissedSuggestions={places.dismissedSuggestions}
              onToggle={toggleMedia}
              onUseCaptureDate={adoptCaptureDate}
              onFindPlace={places.reverseGeocode}
              onDismiss={(assetId) =>
                places.setDismissedSuggestions((current) => [...current, assetId])
              }
            />
            <LocationSearch
              candidateGps={places.candidateGps}
              query={places.query}
              location={draft.location}
              state={places.state}
              results={places.results}
              onQueryChange={places.setQuery}
              onSearch={places.search}
              onSelect={selectPlace}
              onClear={() => updateDraft({ location: null })}
              onFindPlace={places.reverseGeocode}
              onDismissCandidate={() => places.setCandidateGps(null)}
            />
            <div className="flex flex-wrap items-center gap-3 [&_span]:text-sm [&_span]:leading-normal [&_span]:text-travel-muted">
              <Button type="submit" disabled={record.pending}>
                {draft.updateId ? m.owner_save_changes() : m.owner_save_travel_update()}
              </Button>
              <span aria-live="polite">{record.serverError ?? (saveState || draftState)}</span>
            </div>
          </form>
          {selectedTrip && selectedTrip.travel_updates.length > 0 && (
            <SavedUpdates updates={selectedTrip.travel_updates} onEdit={editUpdate} />
          )}
        </>
      )}
      {confirmation.dialog}
    </RecordDialog>
  );
}
