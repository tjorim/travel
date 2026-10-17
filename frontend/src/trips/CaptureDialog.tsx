import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { textNotice, FeedbackError, errorNotice, useFeedback } from "../query/feedback";
import { TravelCheckbox } from "../ui/TravelCheckbox";
import { Input } from "@base-ui/react/input";
import { Button } from "@base-ui/react/button";
import { useStore } from "@tanstack/react-form";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth-context";
import { AsyncSearchSelect, requiredText, TextField } from "../forms/fields";
import { DateTimeField } from "../forms/DateTimeFields";
import { MarkdownField } from "../forms/MarkdownField";
import { blockUnreadableEntries } from "../forms/unreadable-entry";
import { useConfirmation } from "../forms/useConfirmation";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import {
  tripPath,
  useOwnerMutation,
  useTripResource,
  useTripSearch,
  useTripsQuery,
} from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import {
  clearDraft,
  emptyDraft,
  captureInputValue,
  formatCapture,
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
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<PlaceSearchResponse | null>(null);
  const [placeState, setPlaceState] = useFeedback<string>("");
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  const [candidateGps, setCandidateGps] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );
  const initialized = useRef(false);

  const saveUpdate = useOwnerMutation<
    { tripId: string; updateId: string | null; payload: Record<string, unknown> },
    TravelUpdate
  >({
    fallback: SAVE_FALLBACK,
    request: ({ tripId, updateId, payload }) => ({
      path: updateId
        ? tripPath(tripId, `travel-updates/${updateId}`)
        : tripPath(tripId, "travel-updates"),
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
    fallback: m.owner_the_travel_update_could_not_be_deleted,
    request: ({ tripId, updateId }) => ({
      path: tripPath(tripId, `travel-updates/${updateId}`),
      method: "DELETE",
    }),
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });
  // A search phrase or a photo's coordinates are private: those calls are dropped from the mutation cache once settled.
  const searchPlaces = useOwnerMutation<{ tripId: string; query: string }, PlaceSearchResponse>({
    fallback: m.owner_location_search_is_currently_unavailable,
    request: ({ tripId, query }) => ({
      path: tripPath(tripId, "places/search"),
      method: "POST",
      body: { query },
    }),
    invalidate: () => [],
    gcTime: 0,
  });
  const reversePlaces = useOwnerMutation<
    { tripId: string; latitude: number; longitude: number },
    PlaceSearchResponse
  >({
    fallback: m.owner_this_photo_s_location_could_not_be_looked_up,
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
      resetPlaceSearch();
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
      ? errorMessage(mediaQuery.error, m.owner_your_media_could_not_be_loaded)
      : mediaQuery.isPending
        ? m.owner_loading_media()
        : mediaQuery.data?.length
          ? m.owner_choose_private_photos_to_link_to_this_travel_update()
          : m.owner_no_photos_in_this_trip_yet();

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
      setCandidateGps(candidate.gps ?? null);
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
    setDraftState(
      textNotice(() => (stored ? m.owner_local_draft_restored() : m.owner_new_draft())),
    );
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
    setSaveState(textNotice(() => m.owner_you_are_editing_a_saved_travel_update()));
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
    setPlaceState(
      textNotice(() =>
        m.owner_location_selected_it_will_only_be_created_when_you_save_the_travel_updat(),
      ),
    );
    setPlaceResults(null);
  }

  function searchPlace() {
    if (!session || !selectedTrip || placeQuery.trim().length < 2) {
      setPlaceState(
        textNotice(() => m.owner_enter_at_least_two_characters_to_search_for_a_location()),
      );
      return;
    }
    setPlaceState(textNotice(() => m.owner_searching_locations()));
    searchPlaces.mutateAsync({ tripId: selectedTrip.id, query: placeQuery.trim() }).then(
      (result) => {
        setPlaceResults(result);
        setPlaceState(
          textNotice(() =>
            result.results.length
              ? m.owner_choose_a_result_nothing_is_saved_yet()
              : m.owner_no_locations_found(),
          ),
        );
      },
      (error: unknown) => setPlaceState(errorNotice(error, m.owner_location_search_failed)),
    );
  }

  function reverseGeocode(gps: { latitude: number; longitude: number }) {
    if (!session || !selectedTrip) return;
    setPlaceState(textNotice(() => m.owner_looking_up_the_photo_location_only_for_you()));
    reversePlaces.mutateAsync({ tripId: selectedTrip.id, ...gps }).then(
      (result) => {
        setPlaceResults(result);
        setPlaceState(
          textNotice(() =>
            result.results.length
              ? m.owner_choose_the_suggested_location_nothing_is_saved_yet()
              : m.owner_no_place_found_for_this_photo_location(),
          ),
        );
      },
      (error: unknown) =>
        setPlaceState(errorNotice(error, m.owner_this_photo_s_location_could_not_be_looked_up)),
    );
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
            {lockedTrip ? (
              <p className="m-0 font-bold text-travel-forest">
                {m.owner_trip()} <strong>{lockedTrip.title}</strong>
              </p>
            ) : (
              <Field>
                <FieldLabel>{m.owner_trip_2()}</FieldLabel>
                <AsyncSearchSelect
                  ariaLabel={m.owner_trip()}
                  value={draft.tripId}
                  selectedOption={
                    selectedTrip ? { value: selectedTrip.id, label: selectedTrip.title } : null
                  }
                  defaultOptions={trips
                    .slice(0, 50)
                    .map((trip) => ({ value: trip.id, label: trip.title }))}
                  onChange={selectTrip}
                  loadOptions={async (q) =>
                    (await searchTrips(q)).map((trip) => ({ value: trip.id, label: trip.title }))
                  }
                />
              </Field>
            )}
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
            <FieldSet className="location">
              <FieldLegend>{m.owner_link_private_photos()}</FieldLegend>
              <p>
                {m.owner_a_link_is_private_exif_is_only_used_below_as_a_suggestion_no_date_or_pla()}
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
                    {asset.original_filename ?? m.owner_unnamed_photo()}
                    {asset.captured_at
                      ? ` · ${formatCapture(asset.captured_at, asset.captured_local)}`
                      : ""}
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
                      <strong>
                        {m.owner_suggestion_from()}{" "}
                        {asset.original_filename ?? m.owner_this_photo()}
                      </strong>
                      {asset.captured_at && (
                        <span>
                          {m.owner_captured_2()}{" "}
                          {formatCapture(asset.captured_at, asset.captured_local)}.
                        </span>
                      )}
                      <div className="button-row">
                        {asset.captured_at && (
                          <Button
                            className="secondary compact"
                            type="button"
                            onClick={() => {
                              updateDraft({
                                occurredAt: captureInputValue(
                                  asset.captured_at!,
                                  asset.captured_local,
                                ),
                              });
                              setSaveState(
                                textNotice(() =>
                                  m.owner_capture_date_used_as_a_suggestion_feel_free_to_change_it(),
                                ),
                              );
                            }}
                          >
                            {m.owner_use_capture_date()}
                          </Button>
                        )}
                        {asset.gps && (
                          <Button
                            className="secondary compact"
                            type="button"
                            onClick={() => reverseGeocode(asset.gps!)}
                          >
                            {m.owner_find_place_for_photo()}
                          </Button>
                        )}
                        <Button
                          className="secondary compact"
                          type="button"
                          onClick={() =>
                            setDismissedSuggestions((current) => [...current, asset.id])
                          }
                        >
                          {m.owner_dismiss_suggestion()}
                        </Button>
                      </div>
                    </aside>
                  ),
              )}
              {attachedMedia.filter((asset) => asset.captured_at || asset.gps).length > 1 && (
                <p className="help">
                  {m.owner_photos_can_differ_each_suggestion_remains_visible_separately_choose_at_m()}
                </p>
              )}
            </FieldSet>
            <FieldSet className="location">
              <FieldLegend>{m.owner_location_entirely_optional()}</FieldLegend>
              <p>
                {m.owner_search_for_and_choose_a_location_it_is_only_created_as_a_private_locatio()}
              </p>
              {candidateGps && (
                <aside className="grid gap-2 rounded-travel-media border border-travel-warning-border bg-travel-warning-surface p-3.25 text-sm leading-normal text-travel-warning-ink [&_span]:text-travel-warning-muted">
                  <strong>{m.owner_selected_location_from_candidate()}</strong>
                  <span>
                    {m.owner_this_exif_coordinate_stays_private_and_has_not_been_looked_up_or_saved_y()}
                  </span>
                  <div className="button-row">
                    <Button
                      className="secondary compact"
                      type="button"
                      onClick={() => reverseGeocode(candidateGps)}
                    >
                      {m.owner_search_this_candidate_place()}
                    </Button>
                    <Button
                      className="secondary compact"
                      type="button"
                      onClick={() => setCandidateGps(null)}
                    >
                      {m.owner_dismiss_location()}
                    </Button>
                  </div>
                </aside>
              )}
              <div className="field-row">
                <Field className="contents">
                  <FieldLabel>
                    {m.owner_search_for_a_location()}
                    <Input
                      value={placeQuery}
                      onChange={(event) => setPlaceQuery(event.target.value)}
                      placeholder={m.owner_for_example_taipei_main_station()}
                    />
                  </FieldLabel>
                </Field>
                <div className="flex items-end">
                  <Button className="secondary" type="button" onClick={searchPlace}>
                    {m.owner_search()}
                  </Button>
                </div>
              </div>
              {draft.location && (
                <p className="flex flex-wrap items-center gap-2">
                  <strong>{m.owner_selected_location()}</strong>{" "}
                  {draft.location.display_name ??
                    draft.location.locality ??
                    m.owner_unnamed_location()}{" "}
                  <Button
                    className="secondary compact"
                    type="button"
                    onClick={() => updateDraft({ location: null })}
                  >
                    {m.owner_delete()}
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
                    {m.owner_search_results()}{" "}
                    <a href={placeResults.attribution_url} target="_blank" rel="noreferrer">
                      {placeResults.attribution}
                    </a>
                  </p>
                </div>
              )}
            </FieldSet>
            <div className="flex flex-wrap items-center gap-3 [&_span]:text-sm [&_span]:leading-normal [&_span]:text-travel-muted">
              <Button type="submit" disabled={record.pending}>
                {draft.updateId ? m.owner_save_changes() : m.owner_save_travel_update()}
              </Button>
              <span aria-live="polite">{record.serverError ?? (saveState || draftState)}</span>
            </div>
          </form>
          {selectedTrip && selectedTrip.travel_updates.length > 0 && (
            <section className="saved-records">
              <h3>{m.owner_saved_travel_updates()}</h3>
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
                      {update.location
                        ? ` · ${update.location.display_name}`
                        : m.owner_without_location()}
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
