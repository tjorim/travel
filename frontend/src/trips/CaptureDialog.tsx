import { Button } from "@/ui/button";
import { Collapsible } from "@/ui/collapsible";
import { useStore } from "@tanstack/react-form";
import { ChevronDownIcon, LockIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { decodeSubject } from "../auth";
import { useAuth } from "../auth-context";
import { requiredText, TextField } from "../forms/fields";
import { DateTimeField } from "../forms/DateTimeFields";
import { MarkdownField } from "../forms/MarkdownField";
import { blockUnreadableEntries, UNREADABLE_ENTRY } from "../forms/unreadable-entry";
import { useConfirmation } from "../forms/useConfirmation";
import { useRecordForm } from "../forms/useRecordForm";
import { LocaleControl, useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorMessage } from "../query/api";
import { errorNotice, FeedbackError, textNotice, useFeedback } from "../query/feedback";
import { useTripSearch, useTripUpdates, useTripsQuery } from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import {
  DRAFT_FENCE,
  clearDraft,
  emptyDraft,
  draftIsCurrent,
  readDraft,
  saveDraft,
  type TravelUpdateCandidateIntent,
  type UpdateDraft,
} from "../capture-draft";
import { captureInputValue, localDateTime, updateWallClock, zoneName } from "../dates";
import {
  type MediaAsset,
  type LocationInput,
  type TravelUpdate,
  type TripSummary,
} from "../api-types";
import { CapturePhotos } from "./capture/CapturePhotos";
import { captureTripOrder } from "./capture/default-trip";
import { LocationSearch } from "./capture/LocationSearch";
import { PhotoLinks } from "./capture/PhotoLinks";
import { SavedUpdates } from "./capture/SavedUpdates";
import { TripChoice } from "./capture/TripChoice";
import { useCaptureMedia } from "./capture/use-capture-media";
import { SAVE_FALLBACK, useCaptureMutations } from "./capture/use-capture-mutations";
import { useCaptureUploads } from "./capture/use-capture-uploads";
import { usePlaceSearch } from "./capture/use-place-search";
import { useVisualViewportFit } from "./capture/use-visual-viewport";
import { today } from "./trip-state";

export type CaptureDialogProps = {
  open: boolean;
  /** Locks the dialog to one trip — the trip-header action never makes the owner reselect it. Omit for the global entry, which asks. */
  lockedTripId?: string | null;
  /** A travel update candidate handed off from the media review (replaces the earlier `navigate("/capture", { state })`). */
  candidate?: TravelUpdateCandidateIntent | null;
  onCandidateConsumed?: () => void;
  onDismiss: () => void;
};

/** The shared capture form as an accessible dialog over the current workspace. It is photo-first: choose or take
 * photos, write one line and save, on the trip underway and the time now. The date and time, private note, linked
 * library photos, location, language and connection status fold under "More". Drafts are kept per trip, so opening this for
 * one trip never reads or silently overwrites another trip's unsaved draft. */
export function CaptureDialog(props: CaptureDialogProps) {
  const { session } = useAuth();
  const owner = session ? decodeSubject(session.accessToken) : null;
  return <OwnerCaptureDialog key={owner ?? "signed-out"} {...props} />;
}

/**
 * What `occurred_at` carries: the wall clock typed, which the server reads in the place's own zone (the area's, else
 * the trip's nearest stay or visit), never the browser's. A photo's exact instant is the exception while the owner
 * leaves the time it seeded alone, because the photo's place and zone are not known here.
 */
function occurredAtToSend(draft: UpdateDraft): string {
  if (draft.occurredInstant && draft.occurredAt === captureInputValue(draft.occurredInstant, false))
    return draft.occurredInstant;
  return draft.occurredAt;
}

function OwnerCaptureDialog({
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
    textNotice(() => m.capture_loading_draft()),
  );
  const [saveState, setSaveState] = useFeedback<string>("");
  const initialized = useRef(false);
  const [loadedTrip, setLoadedTrip] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const submittedDraft = useRef<UpdateDraft | null>(null);
  // The submit handler is created before the photo uploads it must wait for, so it reads their state from here.
  const uploadState = useRef({ failed: false });

  const { saveUpdate, deleteUpdate } = useCaptureMutations();

  const record = useRecordForm<UpdateDraft, TravelUpdate>({
    defaultValues: emptyDraft(lockedTripId ?? candidate?.tripId ?? ""),
    fallback: SAVE_FALLBACK,
    submit: async (values) => {
      if (!session || !values.tripId || !draftIsCurrent(values))
        throw new FeedbackError(() => m.capture_choose_a_trip_and_sign_in_first_to_save());
      if (!connection) throw new FeedbackError(() => m.capture_offline_draft_notice());
      if (uploadState.current.failed) throw new FeedbackError(() => m.capture_photo_blocks_save());
      submittedDraft.current = {
        ...values,
        [DRAFT_FENCE]: values[DRAFT_FENCE] ? { ...values[DRAFT_FENCE] } : undefined,
      };
      setSaveState(textNotice(() => m.common_saving()));
      // A place that already exists on the server is left as it is: sending it again would make a new one and lose its public name.
      const keepsLocation = Boolean((values.location as { id?: string } | null)?.id);
      return saveUpdate.mutateAsync({
        tripId: values.tripId,
        updateId: values.updateId,
        payload: {
          occurred_at: occurredAtToSend(values),
          title: values.title.trim(),
          private_notes: values.notes.trim() || null,
          ...(keepsLocation ? {} : { location: values.location }),
          media_asset_ids: values.mediaAssetIds,
        },
      });
    },
    onSuccess: async (_saved, values) => {
      const result = await clearDraft(submittedDraft.current ?? values);
      if (!draftIsCurrent(values)) return;
      if (result !== "saved") {
        setSaveState(textNotice(() => m.capture_trip_saved_draft_kept()));
        setDraftState(
          textNotice(() =>
            result === "conflict"
              ? m.capture_draft_changed_in_another_tab()
              : m.capture_draft_not_saved_locally(),
          ),
        );
        return;
      }
      setDraftState(textNotice(() => m.capture_saved_to_your_private_trip()));
      setSaveState(textNotice(() => m.updates_travel_update_saved()));
      record.load(emptyDraft(values.tripId));
      places.reset();
      uploads.reset();
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
  const savedUpdates = useTripUpdates(selectedTrip?.id ?? null).data;
  // The zone a saved update's time is read in; a new update's depends on the place chosen, known once saved.
  const editedZone = draft.updateId
    ? savedUpdates?.find((item) => item.id === draft.updateId)?.timezone
    : undefined;
  const uploads = useCaptureUploads(selectedTrip?.id ?? null, (asset) => {
    form.setFieldValue("mediaAssetIds", (current: string[]) =>
      current.includes(asset.id) ? current : [...current, asset.id],
    );
    setSaveState(
      textNotice(() =>
        m.capture_photo_added({ name: asset.original_filename ?? m.capture_unnamed_photo() }),
      ),
    );
  });
  uploadState.current.failed = uploads.failed;
  const { media, attachedMedia, mediaState } = useCaptureMedia(
    selectedTrip?.id ?? null,
    open,
    draft.mediaAssetIds,
    uploads.uploaded,
  );
  const places = usePlaceSearch(selectedTrip?.id ?? null, Boolean(session));
  const keyboardFit = useVisualViewportFit(open);

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
    const tripId = lockedTripId ?? candidate?.tripId ?? startingTripId(trips);
    if (!trips.some((trip) => trip.id === tripId)) return;
    initialized.current = true;
    setLoadedTrip(tripId);
    if (candidate && candidate.tripId === tripId) {
      record.load({
        ...emptyDraft(tripId),
        occurredAt: candidate.occurredAt
          ? captureInputValue(candidate.occurredAt, candidate.occurredAtLocal ?? false)
          : localDateTime(),
        ...(candidate.occurredAt && !candidate.occurredAtLocal
          ? { occurredInstant: candidate.occurredAt }
          : {}),
        mediaAssetIds: candidate.mediaAssetIds,
      });
      places.setCandidateGps(candidate.gps ?? null);
      setDraftState(textNotice(() => m.capture_candidate_copied_notice()));
      onCandidateConsumed?.();
      return;
    }
    const stored = readDraft(tripId);
    record.load(stored ?? emptyDraft(tripId));
    setDraftState(
      textNotice(() => (stored ? m.capture_local_draft_restored() : m.capture_new_draft())),
    );
    // `record.load` is a stable identity from `useRecordForm`; only the inputs that decide *which* draft to load matter here.
  }, [lockedTripId, candidate, trips, onCandidateConsumed]);

  useEffect(() => {
    if (!initialized.current || !draft.tripId || loadedTrip !== draft.tripId) return;
    let current = true;
    const empty =
      !draft.updateId &&
      !draft.title &&
      !draft.notes &&
      !draft.location &&
      !draft.mediaAssetIds.length;
    void (empty ? clearDraft(draft) : saveDraft(draft)).then((result) => {
      if (!current || (empty && result === "saved")) return;
      setDraftState(
        textNotice(() =>
          result === "saved"
            ? m.capture_draft_saved_locally_not_sent_to_your_trip_yet()
            : result === "conflict"
              ? m.capture_draft_changed_in_another_tab()
              : m.capture_draft_not_saved_locally(),
        ),
      );
    });
    return () => {
      current = false;
    };
  }, [draft, loadedTrip]);

  /** The trip a new capture starts on: one with an unsent draft wins, then underway, upcoming and last used. */
  function startingTripId(list: TripSummary[]): string {
    const ordered = captureTripOrder(list, today());
    return (ordered.find((trip) => readDraft(trip.id)) ?? ordered[0]).id;
  }

  // A reopened dialog that holds nothing yet starts again on the trip underway and the time now.
  const wasOpen = useRef(open);
  useEffect(() => {
    const reopened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!reopened || !initialized.current || candidate || lockedTripId || trips.length === 0)
      return;
    const blank =
      !draft.updateId &&
      !draft.title &&
      !draft.notes &&
      !draft.location &&
      !draft.mediaAssetIds.length;
    if (!blank) return;
    const tripId = startingTripId(trips);
    if (tripId === draft.tripId) {
      record.load(emptyDraft(tripId));
      return;
    }
    selectTrip(tripId);
    // `selectTrip` and the draft are read at the moment of reopening only.
  }, [open]);

  function updateDraft(values: Partial<UpdateDraft>) {
    for (const [name, value] of Object.entries(values))
      form.setFieldValue(name as Extract<keyof UpdateDraft, string>, value as never);
    setSaveState("");
  }

  function selectTrip(tripId: string) {
    setLoadedTrip(tripId);
    const stored = readDraft(tripId);
    record.load(stored ?? emptyDraft(tripId));
    setDraftState(
      textNotice(() => (stored ? m.capture_local_draft_restored() : m.capture_new_draft())),
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
      ...emptyDraft(selectedTrip?.id ?? ""),
      tripId: selectedTrip?.id ?? "",
      updateId: update.id,
      occurredAt: updateWallClock(update),
      title: update.title,
      notes: update.private_notes ?? "",
      location: update.location,
      mediaAssetIds: update.media_asset_ids,
    });
    places.reset();
    // A saved update's note and place live under "More"; editing it should show them.
    setMoreOpen(true);
    setSaveState(textNotice(() => m.capture_you_are_editing_a_saved_travel_update()));
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
    updateDraft({
      occurredAt: captureInputValue(asset.captured_at!, asset.captured_local),
      occurredInstant: asset.captured_local ? undefined : asset.captured_at!,
    });
    setSaveState(textNotice(() => m.capture_date_suggestion_hint()));
  }

  function selectPlace(result: LocationInput) {
    updateDraft({ location: result });
    places.chosen();
  }

  function removeUpdate() {
    const { updateId } = draft;
    if (!selectedTrip || !updateId) return;
    confirmation.ask({
      title: () => m.updates_delete_travel_update({ title: draft.title }),
      onConfirm: () => performRemoveUpdate(selectedTrip.id, updateId),
    });
  }

  function performRemoveUpdate(tripId: string, updateId: string) {
    const deletingDraft = {
      ...draft,
      [DRAFT_FENCE]: draft[DRAFT_FENCE] ? { ...draft[DRAFT_FENCE] } : undefined,
    };
    setSaveState(textNotice(() => m.capture_deleting_travel_update()));
    deleteUpdate.mutateAsync({ tripId, updateId }).then(
      async () => {
        const result = await clearDraft(deletingDraft);
        if (!draftIsCurrent(draft)) return;
        if (result !== "saved") {
          setSaveState("");
          setDraftState(
            textNotice(() =>
              result === "conflict"
                ? m.capture_draft_changed_in_another_tab()
                : m.capture_draft_not_saved_locally(),
            ),
          );
          return;
        }
        startNew();
        setDraftState(textNotice(() => m.updates_travel_update_deleted()));
      },
      (error: unknown) =>
        setSaveState(errorNotice(error, m.updates_the_travel_update_could_not_be_deleted)),
    );
  }

  const clearSaveState = { onChange: () => setSaveState("") };
  const dialogTitle = lockedTrip
    ? m.capture_title_in_trip({ trip: lockedTrip.title })
    : draft.updateId
      ? m.updates_edit_travel_update()
      : m.capture_new_travel_update();
  const status = record.serverError ?? (saveState || draftState);

  function submitForm() {
    // Fields under "More" cannot show their error while it is folded, so open it when one of them is the problem.
    if (!moreOpen && record.formRef.current?.querySelector(`[${UNREADABLE_ENTRY}]`))
      flushSync(() => setMoreOpen(true));
    if (blockUnreadableEntries(record.formRef.current)) return;
    void form.handleSubmit().then(() => {
      if (form.getFieldMeta("occurredAt")?.errors.length) setMoreOpen(true);
    });
  }

  return (
    <RecordDialog
      open={open}
      className="scroll-pb-40 [&_button]:min-h-11 [&_button]:min-w-11"
      keyboardFit={keyboardFit}
      localeControl={false}
      title={dialogTitle}
      dirty={initialized.current && (record.dirty || uploads.items.length > 0)}
      onDismiss={onDismiss}
    >
      {!session && <p>{m.capture_sign_in_hint()}</p>}
      {session && tripsQuery.isPending && (
        <p>{connection ? m.trips_loading() : m.capture_offline_trips_notice()}</p>
      )}
      {session && tripsQuery.isError && <p>{errorMessage(tripsQuery.error, m.trips_load_error)}</p>}
      {session && !tripsQuery.isPending && !tripsQuery.isError && trips.length === 0 && (
        <p>{m.capture_no_trip_hint()}</p>
      )}
      {session && trips.length > 0 && (
        <>
          <form
            ref={record.formRef}
            className="grid gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submitForm();
            }}
          >
            {draft.updateId && (
              <div className="capture-heading">
                <p className="travel-eyebrow m-0">{m.capture_mobile_capture()}</p>
                <div className="button-row">
                  <Button className="secondary compact" type="button" onClick={startNew}>
                    {m.capture_new_travel_update()}
                  </Button>
                  <Button className="danger compact" type="button" onClick={removeUpdate}>
                    {m.common_delete()}
                  </Button>
                </div>
              </div>
            )}
            {!connection && <ConnectionStatus connection={connection} />}
            <TripChoice
              lockedTrip={lockedTrip}
              selectedTrip={selectedTrip}
              draftTripId={draft.tripId}
              trips={trips}
              search={searchTrips}
              onSelect={selectTrip}
            />
            <CapturePhotos
              photoIds={draft.mediaAssetIds}
              assets={attachedMedia}
              uploads={uploads.items}
              online={connection && Boolean(selectedTrip)}
              onAdd={uploads.add}
              onRemove={toggleMedia}
              onRetry={uploads.retry}
              onDropUpload={uploads.drop}
            />
            <form.Field
              name="title"
              listeners={clearSaveState}
              validators={{
                onChange: requiredText(m.updates_give_the_travel_update_a_title),
                onSubmit: requiredText(m.updates_give_the_travel_update_a_title),
              }}
            >
              {(field) => (
                <TextField
                  field={field}
                  label={m.common_title()}
                  required
                  maxLength={160}
                  enterKeyHint="done"
                  placeholder={m.capture_for_example_first_evening()}
                />
              )}
            </form.Field>
            <Collapsible.Root open={moreOpen} onOpenChange={setMoreOpen} className="grid gap-4">
              <Collapsible.Trigger className="group flex min-h-11 w-full items-center gap-2 rounded-xl border border-travel-card-border bg-travel-surface px-3.5 py-2 text-left font-bold text-travel-ink">
                <ChevronDownIcon
                  className="size-4 shrink-0 text-travel-muted transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden="true"
                />
                <span className="grid min-w-0 gap-0.5">
                  {m.capture_more()}
                  <span className="text-sm font-medium text-travel-muted">
                    {m.capture_more_hint()}
                  </span>
                </span>
              </Collapsible.Trigger>
              <Collapsible.Panel keepMounted className="grid gap-4">
                <LocaleControl />
                {connection && <ConnectionStatus connection={connection} />}
                {selectedTrip && (
                  <aside
                    className="publication"
                    aria-label={m.capture_sharing_this_travel_update()}
                  >
                    <strong>{m.capture_before_saving()}</strong>
                    <span>{m.capture_privacy_hint()}</span>
                  </aside>
                )}
                <form.Field
                  name="occurredAt"
                  listeners={clearSaveState}
                  validators={{
                    onChange: requiredText(m.updates_enter_the_date_and_time),
                    onSubmit: requiredText(m.updates_enter_the_date_and_time),
                  }}
                >
                  {(field) => (
                    <DateTimeField
                      field={field}
                      label={m.updates_date_and_time()}
                      required
                      stacked
                    />
                  )}
                </form.Field>
                <p className="help">
                  {editedZone
                    ? m.updates_update_time_local_in_zone({ zone: zoneName(editedZone) })
                    : m.updates_update_time_local()}
                </p>
                <form.Field name="notes" listeners={clearSaveState}>
                  {(field) => (
                    <MarkdownField
                      field={field}
                      label={m.updates_private_note()}
                      optional
                      maxLength={10000}
                      rows={6}
                      placeholder={m.capture_what_do_you_want_to_remember_you_never_share_this()}
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
              </Collapsible.Panel>
            </Collapsible.Root>
            <div className="sticky bottom-0 z-10 -mx-4.5 grid gap-2 border-t border-travel-divider bg-travel-surface px-4.5 pt-3 pb-3 min-[621px]:-mx-5.5 min-[621px]:px-5.5">
              <p className="m-0 flex items-center gap-1.5 text-sm leading-normal text-travel-muted">
                <LockIcon className="size-3.5 shrink-0" aria-hidden="true" />
                {m.capture_private_short()}
              </p>
              <div className="grid gap-1.5 min-[621px]:flex min-[621px]:items-center min-[621px]:gap-3 [&_span]:text-sm [&_span]:leading-normal [&_span]:text-travel-muted">
                <Button
                  className="w-full shrink-0 whitespace-nowrap min-[621px]:w-auto"
                  type="submit"
                  disabled={record.pending || uploads.busy}
                >
                  {draft.updateId ? m.capture_save_changes() : m.updates_save_travel_update()}
                </Button>
                <span className="min-w-0 empty:hidden" aria-live="polite">
                  {uploads.busy ? m.capture_photos_uploading() : status}
                </span>
              </div>
            </div>
          </form>
          {selectedTrip && savedUpdates && savedUpdates.length > 0 && (
            <SavedUpdates updates={savedUpdates} onEdit={editUpdate} />
          )}
        </>
      )}
      {confirmation.dialog}
    </RecordDialog>
  );
}

function ConnectionStatus({ connection }: { connection: boolean }) {
  useLocale();
  return (
    <p className={`connection ${connection ? "online" : "offline"}`} role="status">
      {connection ? m.capture_connected_you_choose_when_to_save() : m.capture_offline_banner()}
    </p>
  );
}
