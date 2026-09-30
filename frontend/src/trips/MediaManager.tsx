import type { ErrorFallback } from "../query/api";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorNotice, useFeedback, textNotice } from "../query/feedback";
import { TravelCheckbox } from "../ui/TravelCheckbox";
import { Input } from "@base-ui/react/input";
import { Button } from "@base-ui/react/button";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";

import type { TrackerSession } from "../auth";
import { AsyncSearchSelect, RecordForm, SearchSelect, SelectField, TextField } from "../forms/fields";
import { MarkdownField } from "../forms/MarkdownField";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage, openOwnerFile, ownerFile } from "../query/api";
import { ownerKeys } from "../query/keys";
import {
  tripPath,
  useDerivatives,
  useOwner,
  useOwnerMutation,
  useProviderConnections,
  useTravelUpdateSearch,
  useTripResource,
} from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { VisibilityControl } from "./visibility";
import { dayjs } from "../dayjs";
import {
  bytesLabel,
  formatInstant,
  visitTitle,
  type AreaSuggestion,
  type ImportCompleteResult,
  type ImportSession,
  type MediaAsset,
  type MediaDerivative,
  type TravelUpdate,
  type Trip,
  type TravelUpdateCandidate,
  type TravelUpdateCandidatesResponse,
  type TravelUpdateCandidateIntent,
} from "../tracker-model";
import { Field, FieldLabel } from "../ui/field";

export const MEDIA_KIND_LABELS: Record<MediaAsset["media_kind"], string> = {
  get photo() {
    return m.assets_photo();
  },
  get video() {
    return m.assets_video();
  },
};

const providerLabel = {
  google_photos_picker: "Google Photos",
  gopro_cloud: "GoPro Cloud",
} as const;

const purposeLabel = {
  get share() {
    return m.owner_sharing();
  },
  get static_export() {
    return m.assets_static_archive();
  },
  get owner_preview() {
    return m.assets_private_preview();
  },
} as const;

/** Fetches a private, authenticated image as a blob and renders it inline, revoking the object URL on cleanup. */
export function OwnerImage({
  session,
  url,
  alt,
  className,
}: {
  session: TrackerSession;
  url: string;
  alt: string;
  className?: string;
}) {
  useLocale();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setSrc(null);
    ownerFile(session, url, m.assets_the_preview_could_not_be_loaded, { cache: "no-store", signal: controller.signal })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        /* No inline preview; the explicit open/download actions still work. */
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, url]);
  if (!src) return <span className={`${className ?? ""} media-thumbnail-placeholder`} aria-hidden="true" />;
  return <img className={className} src={src} alt={alt} />;
}

type DerivativeValues = { purpose: MediaDerivative["purpose"]; maxDimension: string; removeAudio: boolean };
const blankDerivative = (): DerivativeValues => ({ purpose: "share", maxDimension: "1600", removeAudio: false });
const dimensionInRange = ({ value }: { value: string }) => {
  const size = Number(value);
  return value.trim() && Number.isInteger(size) && size >= 64 && size <= 4000
    ? undefined
    : m.assets_choose_a_maximum_side_between_64_and_4000_px;
};

type PresentationValues = { travelUpdateId: string; caption: string; altText: string; focalX: string; focalY: string };
const blankPresentation = (): PresentationValues => ({
  travelUpdateId: "",
  caption: "",
  altText: "",
  focalX: "",
  focalY: "",
});
const fromDerivative = (derivative: MediaDerivative): PresentationValues => ({
  travelUpdateId: derivative.travel_update_id ?? "",
  caption: derivative.caption ?? "",
  altText: derivative.alt_text ?? "",
  focalX: derivative.focal_x?.toString() ?? "",
  focalY: derivative.focal_y?.toString() ?? "",
});
const percentage = ({ value }: { value: string }) =>
  value === "" || (Number(value) >= 0 && Number(value) <= 100) ? undefined : m.assets_choose_a_value_between_0_and_100;

/** The copy's presentation fields, with a live focal-point preview when the copy can be shown inline. */
function PresentationFields({
  record,
  tripId,
  updates,
  previewUrl,
  session,
}: {
  record: ReturnType<typeof useRecordForm<PresentationValues>>;
  tripId: string;
  updates: TravelUpdate[];
  previewUrl: string | null;
  session: TrackerSession | null;
}) {
  useLocale();
  const focalX = record.values.focalX === "" ? 50 : Number(record.values.focalX);
  const focalY = record.values.focalY === "" ? 50 : Number(record.values.focalY);
  const searchUpdates = useTravelUpdateSearch(tripId);
  const [foundTitles, setFoundTitles] = useState<Record<string, string>>({});
  return (
    <>
      {previewUrl && session && (
        <div className="relative mb-2.5 inline-block max-w-55">
          <OwnerImage
            session={session}
            url={previewUrl}
            alt={m.assets_preview_of_the_copy()}
            className="block max-h-55 w-full rounded-travel-media bg-travel-media-bg object-contain"
          />
          <span
            data-focal-point-marker=""
            className="pointer-events-none absolute -mt-2.25 -ml-2.25 size-4.5 rounded-full border-2 border-travel-surface bg-travel-focal-marker shadow-md"
            style={{ left: `${focalX}%`, top: `${focalY}%` }}
            aria-hidden="true"
          />
        </div>
      )}
      <record.form.Field name="travelUpdateId">
        {(field) => (
          <Field>
            <FieldLabel>{m.assets_with_travel_update()}</FieldLabel>
            <AsyncSearchSelect
              ariaLabel={m.assets_with_travel_update()}
              value={field.state.value}
              selectedOption={
                field.state.value
                  ? {
                      value: field.state.value,
                      label:
                        foundTitles[field.state.value] ??
                        updates.find((update) => update.id === field.state.value)?.title ??
                        field.state.value,
                    }
                  : null
              }
              defaultOptions={[
                { value: "", label: m.assets_standalone_gallery_photo() },
                ...updates.slice(0, 50).map((update) => ({ value: update.id, label: update.title })),
              ]}
              onChange={field.handleChange}
              loadOptions={async (q) => {
                const matches = await searchUpdates(q);
                setFoundTitles((current) => ({
                  ...current,
                  ...Object.fromEntries(matches.map((update) => [update.id, update.title])),
                }));
                return [
                  { value: "", label: m.assets_standalone_gallery_photo() },
                  ...matches.map((update) => ({ value: update.id, label: update.title })),
                ];
              }}
            />
          </Field>
        )}
      </record.form.Field>
      <record.form.Field name="caption">
        {(field) => <MarkdownField field={field} format="inline" label={m.assets_caption()} maxLength={500} rows={2} />}
      </record.form.Field>
      <record.form.Field name="altText">
        {(field) => <TextField field={field} label={m.assets_alternative_text()} maxLength={300} />}
      </record.form.Field>
      <div className="field-row">
        <record.form.Field name="focalX" validators={{ onChange: percentage, onSubmit: percentage }}>
          {(field) => <TextField field={field} label={m.assets_horizontal_focus()} type="number" min="0" max="100" />}
        </record.form.Field>
        <record.form.Field name="focalY" validators={{ onChange: percentage, onSubmit: percentage }}>
          {(field) => <TextField field={field} label={m.assets_vertical_focus()} type="number" min="0" max="100" />}
        </record.form.Field>
      </div>
    </>
  );
}

/** Which part of the asset dialog is showing: the asset with its copies, a new copy's form, or one copy's detail/edit. */
type CopyView = { kind: "asset" } | { kind: "create" } | { kind: "copy"; id: string; edit: boolean };

export function MediaManager({
  trip,
  onStartCaptureFromCandidate,
  focusId,
}: {
  trip: Trip;
  onStartCaptureFromCandidate: (candidate: TravelUpdateCandidateIntent) => void;
  focusId?: DialogFocusRequest | null;
}) {
  useLocale();
  const owner = useOwner();
  const offline = useOfflineCopies();
  const mediaQuery = useTripResource(trip.id, "media");
  const searchUpdates = useTravelUpdateSearch(trip.id);
  const visits = useTripResource(trip.id, "visits").data ?? [];
  const assets = mediaQuery.data ?? [];
  const assetDialog = useRecordDialog(assets);
  useDialogFocus(focusId, assetDialog.inspect);
  const selected = assetDialog.selected;
  const [view, setView] = useState<CopyView>({ kind: "asset" });
  const [confirmDeleteAsset, setConfirmDeleteAsset] = useState(false);
  const [confirmDeleteCopy, setConfirmDeleteCopy] = useState(false);
  // The asset being deleted stops being read, so the refresh after the delete does not ask for the copies of a
  // medium that no longer exists (a 404 for every deletion).
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const derivativesQuery = useDerivatives(
    trip.id,
    "media",
    selected && selected.id !== deletingId ? selected.id : null,
  );
  const derivatives = derivativesQuery.data ?? [];
  const selectedDerivative = view.kind === "copy" ? (derivatives.find((item) => item.id === view.id) ?? null) : null;
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useFeedback<string | null>(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [importSession, setImportSession] = useState<ImportSession | null>(null);
  // Only providers this server offers are shown; one the owner has not connected yet is disabled.
  const providers = (useProviderConnections().data ?? []).filter((item) => item.available);
  const [selection, setSelection] = useState<string[]>([]);
  const reviewSelection = selection.filter((id) => assets.some((asset) => asset.id === id));
  const [candidateReview, setCandidateReview] = useState<TravelUpdateCandidatesResponse | null>(null);
  const [candidateTimes, setCandidateTimes] = useState<Record<string, string>>({});
  const [candidateLocations, setCandidateLocations] = useState<Record<string, string>>({});
  const [candidateAttachments, setCandidateAttachments] = useState<Record<string, string>>({});
  const [foundUpdates, setFoundUpdates] = useState<Record<string, TravelUpdate>>({});
  const [candidateAreas, setCandidateAreas] = useState<Record<string, AreaSuggestion>>({});
  const [notice, setNotice] = useFeedback<string | null>(null);
  const mediaPath = tripPath(trip.id, "media");
  const refreshMedia = (subject: string) => [ownerKeys.tripResource(subject, trip.id, "media")];
  const refreshDerivatives = (subject: string, { assetId }: { assetId: string }) => [
    ownerKeys.derivatives(subject, trip.id, "media", assetId),
  ];

  const upload = useOwnerMutation<FormData, MediaAsset>({
    fallback: m.assets_the_media_could_not_be_uploaded,
    request: (body) => ({ path: `${mediaPath}/uploads`, method: "POST", body }),
    invalidate: refreshMedia,
  });
  const remove = useOwnerMutation<MediaAsset>({
    fallback: m.assets_the_media_could_not_be_deleted,
    request: (asset) => ({ path: `${mediaPath}/${asset.id}`, method: "DELETE" }),
    // The server also drops the deleted asset from the reisupdates that used it.
    invalidate: (subject) => [...refreshMedia(subject), ownerKeys.trips(subject)],
  });
  const requestDerivative = useOwnerMutation<
    { assetId: string; purpose: MediaDerivative["purpose"]; maxDimension: number; removeAudio: boolean },
    MediaDerivative
  >({
    fallback: m.assets_the_copy_could_not_be_created,
    request: ({ assetId, purpose, maxDimension, removeAudio }) => ({
      path: `${mediaPath}/${assetId}/derivatives`,
      method: "POST",
      body: {
        purpose,
        max_dimension: maxDimension,
        ...(selected?.media_kind === "video" ? { remove_audio: removeAudio } : {}),
      },
    }),
    invalidate: refreshDerivatives,
  });
  const approve = useOwnerMutation<{ assetId: string; derivative: MediaDerivative }, MediaDerivative>({
    fallback: m.assets_the_copy_could_not_be_approved,
    request: ({ assetId, derivative }) => ({
      path: `${mediaPath}/${assetId}/derivatives/${derivative.id}/approve`,
      method: "POST",
    }),
    invalidate: refreshDerivatives,
  });
  const retry = useOwnerMutation<{ assetId: string; derivative: MediaDerivative }, MediaDerivative>({
    fallback: m.assets_the_video_could_not_be_processed_again,
    request: ({ assetId, derivative }) => ({
      path: `${mediaPath}/${assetId}/derivatives/${derivative.id}/retry`,
      method: "POST",
    }),
    invalidate: refreshDerivatives,
  });
  const presentation = useOwnerMutation<
    { assetId: string; derivative: MediaDerivative; values: Record<string, unknown> },
    MediaDerivative
  >({
    fallback: m.assets_the_presentation_could_not_be_saved,
    request: ({ assetId, derivative, values }) => ({
      path: `${mediaPath}/${assetId}/derivatives/${derivative.id}/presentation`,
      method: "PATCH",
      body: values,
    }),
    invalidate: refreshDerivatives,
  });
  const removeDerivative = useOwnerMutation<{ assetId: string; derivative: MediaDerivative }>({
    fallback: m.assets_the_copy_could_not_be_deleted,
    request: ({ assetId, derivative }) => ({
      path: `${mediaPath}/${assetId}/derivatives/${derivative.id}`,
      method: "DELETE",
    }),
    invalidate: refreshDerivatives,
  });
  const startImport = useOwnerMutation<ImportSession["provider"], ImportSession>({
    fallback: m.assets_the_import_session_could_not_be_started,
    request: (provider) => ({ path: `${mediaPath}/imports/${provider}/sessions`, method: "POST" }),
    invalidate: () => [],
  });
  const completeImport = useOwnerMutation<ImportSession, ImportCompleteResult>({
    fallback: m.assets_the_import_session_could_not_be_completed,
    request: (session) => ({
      path: `${mediaPath}/imports/${session.provider}/sessions/${session.id}/complete`,
      method: "POST",
    }),
    invalidate: (subject, _session, result) => (result?.ready ? refreshMedia(subject) : []),
  });
  const reviewCandidates = useOwnerMutation<string[], TravelUpdateCandidatesResponse>({
    fallback: m.assets_the_possible_travel_updates_could_not_be_calculated,
    request: (mediaAssetIds) => ({
      path: `${mediaPath}/travel-update-candidates`,
      method: "POST",
      body: { media_asset_ids: mediaAssetIds },
    }),
    // A review is computed for this screen only; nothing is stored.
    invalidate: () => [],
  });
  const suggestArea = useOwnerMutation<{ latitude: number; longitude: number }, AreaSuggestion>({
    fallback: m.owner_an_area_could_not_be_suggested,
    request: (body) => ({ path: tripPath(trip.id, "areas/suggest"), method: "POST", body }),
    invalidate: () => [],
    gcTime: 0,
  });
  const attach = useOwnerMutation<{ updateId: string; mediaAssetIds: string[] }>({
    fallback: m.assets_the_private_media_could_not_be_linked_to_the_travel_update,
    request: ({ updateId, mediaAssetIds }) => ({
      path: tripPath(trip.id, `travel-updates/${updateId}`),
      method: "PATCH",
      body: { media_asset_ids: mediaAssetIds },
    }),
    invalidate: (subject) => [ownerKeys.trips(subject), [...ownerKeys.trip(subject, trip.id), "travel-updates"]],
  });

  const derivativeRecord = useRecordForm<DerivativeValues>({
    defaultValues: blankDerivative(),
    fallback: m.assets_the_copy_could_not_be_created,
    serverFields: { purpose: "purpose", max_dimension: "maxDimension" },
    submit: async (values) => {
      if (selected)
        await requestDerivative.mutateAsync({
          assetId: selected.id,
          purpose: values.purpose,
          maxDimension: Number(values.maxDimension),
          removeAudio: values.removeAudio,
        });
    },
    onSuccess: () => {
      setView({ kind: "asset" });
      setNotice(textNotice(() => m.assets_copy_started_check_the_copy_and_then_explicitly_approve_it()));
    },
  });
  const presentationRecord = useRecordForm<PresentationValues>({
    defaultValues: blankPresentation(),
    fallback: m.assets_the_presentation_could_not_be_saved,
    serverFields: {
      travel_update_id: "travelUpdateId",
      caption: "caption",
      alt_text: "altText",
      focal_x: "focalX",
      focal_y: "focalY",
    },
    submit: async (values) => {
      if (!selected || !selectedDerivative) return;
      await presentation.mutateAsync({
        assetId: selected.id,
        derivative: selectedDerivative,
        values: {
          travel_update_id: values.travelUpdateId || null,
          caption: values.caption || null,
          alt_text: values.altText || null,
          focal_x: values.focalX === "" ? null : Number(values.focalX),
          focal_y: values.focalY === "" ? null : Number(values.focalY),
        },
      });
    },
    onSuccess: () => {
      setView({ kind: "asset" });
      setNotice(textNotice(() => m.assets_presentation_saved_only_fields_selected_in_a_sharing_scope_become_visibl()));
    },
  });

  useEffect(() => {
    if (!derivatives.some((item) => item.processing_state === "processing")) return;
    const timer = window.setInterval(() => {
      void derivativesQuery.refetch();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [derivatives, derivativesQuery]);

  const fail = (fallback: ErrorFallback) => (error: unknown) => setNotice(errorNotice(error, fallback));
  const failInDialog = (fallback: ErrorFallback) => (error: unknown) => {
    setConfirmDeleteAsset(false);
    setConfirmDeleteCopy(false);
    assetDialog.setError(errorNotice(error, fallback));
  };
  const timestamp = formatInstant;

  function openUpload() {
    setUploadError(null);
    setUploadFile(null);
    setUploadKey((current) => current + 1);
    setUploading(true);
  }
  function closeUpload() {
    setUploadError(null);
    setUploading(false);
    setUploadFile(null);
    setUploadKey((current) => current + 1);
  }

  function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadFile) {
      setUploadError(textNotice(() => m.assets_choose_a_photo_or_video_first()));
      return;
    }
    setUploadError(null);
    const data = new FormData();
    data.set("file", uploadFile);
    setNotice(textNotice(() => m.assets_uploading_private_media()));
    upload.mutateAsync(data).then(
      (saved) => {
        closeUpload();
        inspectAsset(saved.id);
        setNotice(textNotice(() => m.assets_private_media_uploaded_you_can_now_link_them_to_a_travel_update()));
      },
      (error: unknown) => {
        setNotice("");
        setUploadError(errorNotice(error, m.assets_the_media_could_not_be_uploaded));
      },
    );
  }

  function inspectAsset(id: string) {
    assetDialog.inspect(id);
    setView({ kind: "asset" });
    setConfirmDeleteAsset(false);
    setConfirmDeleteCopy(false);
  }

  function closeAsset() {
    assetDialog.close();
    setView({ kind: "asset" });
    setConfirmDeleteAsset(false);
    setConfirmDeleteCopy(false);
    derivativeRecord.load(blankDerivative());
    presentationRecord.load(blankPresentation());
  }

  function backToAsset() {
    setView({ kind: "asset" });
    setConfirmDeleteCopy(false);
    derivativeRecord.load(blankDerivative());
    presentationRecord.load(blankPresentation());
  }

  function startCreateCopy() {
    derivativeRecord.load(blankDerivative());
    setView({ kind: "create" });
  }

  function viewCopy(id: string) {
    setConfirmDeleteCopy(false);
    setView({ kind: "copy", id, edit: false });
  }

  function editCopy(derivative: MediaDerivative) {
    presentationRecord.load(fromDerivative(derivative));
    setView({ kind: "copy", id: derivative.id, edit: true });
  }

  function performEraseAsset(asset: MediaAsset) {
    setDeletingId(asset.id);
    remove.mutateAsync(asset).then(
      async () => {
        await offline.removeByResource("media_asset", asset.id);
        closeAsset();
        setDeletingId(null);
        setNotice(textNotice(() => m.assets_private_media_deleted_links_to_travel_updates_have_also_been_removed()));
      },
      (error: unknown) => {
        setDeletingId(null);
        failInDialog(m.assets_the_media_could_not_be_deleted)(error);
      },
    );
  }

  async function toggleOffline(asset: MediaAsset) {
    if (!owner) return;
    if (offline.isPinned("media_asset", asset.id)) {
      await offline.removeByResource("media_asset", asset.id);
      setNotice(
        textNotice(() =>
          m.owner_is_no_longer_available_offline({ p0: asset.original_filename ?? m.assets_this_media_item() }),
        ),
      );
      return;
    }
    const blob = await ownerFile(
      owner.session,
      asset.file_url,
      m.assets_the_private_media_item_could_not_be_saved_offline,
      {
        cache: "no-store",
      },
    );
    await offline.pin({
      resourceKind: "media_asset",
      resourceId: asset.id,
      metadataUrl: `${mediaPath}/${asset.id}`,
      title: asset.original_filename ?? m.owner_unnamed_media_item(),
      contentType: asset.content_type,
      bytes: await blob.arrayBuffer(),
    });
    setNotice(
      textNotice(() =>
        m.owner_is_saved_offline_on_this_device({ p0: asset.original_filename ?? m.assets_this_media_item() }),
      ),
    );
  }

  function open(url: string, fallback: ErrorFallback) {
    if (owner) openOwnerFile(owner.session, url, fallback).catch(fail(fallback));
  }

  async function toggleDerivativeOffline(derivative: MediaDerivative) {
    if (!owner || !selected) return;
    if (offline.isPinned("media_derivative", derivative.id)) {
      await offline.removeByResource("media_derivative", derivative.id);
      setNotice(textNotice(() => m.assets_the_offline_copy_has_been_removed()));
      return;
    }
    const blob = await ownerFile(owner.session, derivative.file_url, m.assets_the_copy_could_not_be_saved_offline, {
      cache: "no-store",
    });
    await offline.pin({
      resourceKind: "media_derivative",
      resourceId: derivative.id,
      metadataUrl: `${mediaPath}/${selected.id}/derivatives/${derivative.id}`,
      title: selected.original_filename ?? m.assets_media_copy(),
      contentType: blob.type,
      bytes: await blob.arrayBuffer(),
    });
    setNotice(textNotice(() => m.assets_the_copy_has_been_saved_offline_on_this_device()));
  }

  function performEraseDerivative(asset: MediaAsset, derivative: MediaDerivative) {
    removeDerivative.mutateAsync({ assetId: asset.id, derivative }).then(async () => {
      await offline.removeByResource("media_derivative", derivative.id);
      backToAsset();
      setNotice(textNotice(() => m.assets_copy_deleted_and_removed_from_any_sharing_scopes()));
    }, failInDialog(m.assets_the_copy_could_not_be_deleted));
  }

  function startProvider(provider: ImportSession["provider"]) {
    setNotice(textNotice(() => m.assets_starting_selection({ p0: providerLabel[provider] })));
    startImport.mutateAsync(provider).then((created) => {
      setImportSession(created);
      setNotice(
        textNotice(() =>
          m.assets_choose_media_in_then_return_here_to_import_your_selection({ p0: providerLabel[provider] }),
        ),
      );
    }, fail(m.assets_the_import_session_could_not_be_started));
  }

  function finishImport() {
    if (!importSession) return;
    setNotice(textNotice(() => m.assets_safely_copying_selected_media_to_your_private_trip()));
    completeImport.mutateAsync(importSession).then((outcome) => {
      if (!outcome.ready) {
        setNotice(
          textNotice(() => m.assets_your_selection_is_not_ready_at_the_provider_yet_try_again_when_you_are_d()),
        );
        return;
      }
      if (outcome.imported[0]) inspectAsset(outcome.imported[0].id);
      setNotice(
        textNotice(
          () =>
            m.assets_imported_count({ count: outcome.imported.length }) +
            (outcome.failed.length ? m.assets_import_failed_count({ count: outcome.failed.length }) : "."),
        ),
      );
    }, fail(m.assets_the_import_session_could_not_be_completed));
  }

  function toggleReviewSelection(assetId: string) {
    setSelection(() =>
      reviewSelection.includes(assetId)
        ? reviewSelection.filter((id) => id !== assetId)
        : [...reviewSelection, assetId],
    );
  }

  function review() {
    if (reviewSelection.length === 0) {
      setNotice(textNotice(() => m.assets_choose_private_media_first_to_review_possible_travel_updates()));
      return;
    }
    reviewCandidates.mutateAsync(reviewSelection).then((result) => {
      setCandidateReview(result);
      setCandidateTimes({});
      setCandidateLocations({});
      setCandidateAttachments({});
      setCandidateAreas({});
      setNotice(
        textNotice(() =>
          result.candidates.length
            ? m.assets_candidates_were_calculated_for_this_private_review_only_nothing_has_been()
            : m.assets_this_selection_has_no_usable_capture_or_location_data(),
        ),
      );
    }, fail(m.assets_the_possible_travel_updates_could_not_be_calculated));
  }

  function candidateAssetNames(candidate: TravelUpdateCandidate) {
    return candidate.media_asset_ids
      .map((id) => assets.find((asset) => asset.id === id)?.original_filename ?? m.assets_unnamed_media_item())
      .join(", ");
  }

  function suggestCandidateArea(candidate: TravelUpdateCandidate) {
    const locationIndex = candidateLocations[candidate.id];
    if (candidate.location_options.length > 1 && locationIndex === undefined) {
      setNotice(textNotice(() => m.assets_choose_a_gps_option_first()));
      return;
    }
    const location = candidate.location_options[locationIndex === undefined ? 0 : Number(locationIndex)];
    if (!location) return;
    suggestArea
      .mutateAsync({ latitude: location.latitude, longitude: location.longitude })
      .then(
        (suggestion) => setCandidateAreas((current) => ({ ...current, [candidate.id]: suggestion })),
        fail(m.owner_an_area_could_not_be_suggested),
      );
  }

  function startCandidateUpdate(candidate: TravelUpdateCandidate) {
    const time =
      candidateTimes[candidate.id] ||
      (candidate.time_options.length === 1 ? candidate.time_options[0].captured_at : "");
    const locationIndex = candidateLocations[candidate.id];
    if (candidate.time_options.length > 1 && !time) {
      setNotice(textNotice(() => m.assets_choose_which_capture_time_to_use_for_this_candidate_visit_first()));
      return;
    }
    if (candidate.location_options.length > 1 && locationIndex === undefined) {
      setNotice(textNotice(() => m.assets_the_gps_metadata_differs_choose_a_location_option_yourself_first_or_igno()));
      return;
    }
    const selectedLocation =
      locationIndex === ""
        ? undefined
        : candidate.location_options[locationIndex === undefined ? 0 : Number(locationIndex)];
    onStartCaptureFromCandidate({
      tripId: trip.id,
      mediaAssetIds: candidate.media_asset_ids,
      occurredAt: time || undefined,
      gps: selectedLocation && { latitude: selectedLocation.latitude, longitude: selectedLocation.longitude },
    });
  }

  function attachCandidate(candidate: TravelUpdateCandidate) {
    const update = foundUpdates[candidateAttachments[candidate.id]];
    if (!update) {
      setNotice(textNotice(() => m.assets_choose_an_existing_travel_update_to_link_the_private_media_to_first()));
      return;
    }
    const mediaAssetIds = [...new Set([...update.media_asset_ids, ...candidate.media_asset_ids])];
    attach.mutateAsync({ updateId: update.id, mediaAssetIds }).then(() => {
      setFoundUpdates((current) => ({ ...current, [update.id]: { ...update, media_asset_ids: mediaAssetIds } }));
      setNotice(
        textNotice(() =>
          m.assets_private_media_linked_to_no_location_or_shareable_content_was_created({ p0: update.title }),
        ),
      );
    }, fail(m.assets_the_private_media_could_not_be_linked_to_the_travel_update));
  }

  const readError = mediaQuery.error ?? derivativesQuery.error;
  const message =
    notice ??
    (readError
      ? errorMessage(readError, m.owner_your_media_could_not_be_loaded)
      : mediaQuery.isPending
        ? m.assets_loading_your_private_media()
        : assets.length
          ? m.assets_originals_exif_and_links_stay_in_your_private_tracker()
          : m.assets_upload_photos_or_videos_from_this_device_or_import_your_selected_media());

  const dialogOpen = selected !== null;
  const dialogTitle =
    view.kind === "create"
      ? m.assets_create_a_copy_to_share()
      : view.kind === "copy"
        ? view.edit
          ? m.assets_edit_presentation()
          : m.assets_copy()
        : (selected?.original_filename ?? m.owner_unnamed_media_item());
  const dialogDirty =
    view.kind === "create"
      ? derivativeRecord.dirty
      : view.kind === "copy" && view.edit
        ? presentationRecord.dirty
        : false;
  const cancelAction = (
    <Button className="secondary" type="button" onClick={backToAsset}>
      {m.assets_back_to_the_media_item()}
    </Button>
  );

  return (
    <section className="travel-card manager" aria-labelledby="media-title">
      <div className="capture-heading">
        <div>
          <h3 id="media-title">{m.assets_media_library()}</h3>
          <p>{m.assets_originals_and_metadata_stay_private_only_a_separate_metadatafree_and_app()}</p>
        </div>
        <Button className="secondary compact" type="button" onClick={openUpload}>
          {m.assets_upload_media()}
        </Button>
      </div>
      <p className="help" role="status">
        {message}
      </p>
      <RecordDialog
        open={uploading}
        title={m.assets_upload_media()}
        dirty={uploading && uploadFile !== null}
        error={uploadError}
        onDismiss={closeUpload}
      >
        {uploading && (
          <form className="stack-form" onSubmit={submitUpload}>
            <Field className="contents">
              <FieldLabel>
                {m.assets_photo_or_video_from_this_device()}
                <Input
                  key={uploadKey}
                  required
                  type="file"
                  accept="image/*,video/*"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                />
              </FieldLabel>
            </Field>
            <Button type="submit" disabled={upload.isPending}>
              {m.assets_upload_private_media()}
            </Button>
          </form>
        )}
      </RecordDialog>
      {assets.length > 0 && (
        <div className="saved-records mt-0.5">
          {assets.map((asset) => (
            <article className="excerpt-row" data-selected={asset.id === selected?.id ? "" : undefined} key={asset.id}>
              <Button
                className="document-select flex items-center gap-3"
                type="button"
                onClick={() => inspectAsset(asset.id)}
                aria-label={m.assets_view_2({ p0: asset.original_filename ?? m.owner_unnamed_media_item() })}
              >
                {asset.thumbnail_url && owner ? (
                  <OwnerImage
                    session={owner.session}
                    url={asset.thumbnail_url}
                    alt=""
                    className="size-13 shrink-0 rounded-lg bg-travel-media-bg object-cover"
                  />
                ) : (
                  <span
                    className="size-13 shrink-0 rounded-lg bg-travel-media-bg object-cover media-thumbnail-placeholder"
                    aria-hidden="true"
                  >
                    {asset.media_kind === "video" ? "🎞" : "🖼"}
                  </span>
                )}
                <div className="min-w-0">
                  <strong>{asset.original_filename ?? m.owner_unnamed_media_item()}</strong>
                  <span>
                    {asset.media_kind === "photo" ? m.assets_photo() : m.assets_video()} · {bytesLabel(asset.byte_size)}
                    {asset.captured_at ? ` · ${timestamp(asset.captured_at)}` : ""}
                  </span>
                </div>
              </Button>
              <div className="button-row">
                <Field className="contents">
                  <FieldLabel className="scope-choice">
                    <TravelCheckbox
                      checked={reviewSelection.includes(asset.id)}
                      onCheckedChange={() => toggleReviewSelection(asset.id)}
                    />
                    {m.assets_review_travel_updates()}
                  </FieldLabel>
                </Field>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="manager-subsection">
        <div className="capture-heading">
          <div>
            <h3>{m.assets_import()}</h3>
            <p>
              {providers.length > 0 ? (
                <>
                  {m.assets_provider_settings()} <Link to="/settings">{m.settings()}</Link>
                </>
              ) : (
                m.assets_provider_import_is_not_available_on_this_server_yet_you_can_upload_media()
              )}
            </p>
          </div>
        </div>
        {providers.length > 0 && (
          <div className="button-row">
            {providers.map((item) => (
              <Button
                key={item.provider}
                className="secondary"
                type="button"
                disabled={!item.connected}
                title={item.connected ? undefined : m.assets_connect_in_settings_first()}
                onClick={() => startProvider(item.provider)}
              >
                {m.assets_choose_in_line({ p0: providerLabel[item.provider] })}
              </Button>
            ))}
          </div>
        )}
        {importSession && (
          <aside className="grid gap-2.25 rounded-travel-media border border-travel-warning-border bg-travel-warning-surface p-3.5 text-sm leading-normal text-travel-warning-ink [&_.action-link]:w-fit [&_button]:w-fit">
            <strong>{m.assets_selection_line({ p0: providerLabel[importSession.provider] })}</strong>
            <span>{m.assets_first_choose_only_the_media_you_want_to_copy_to_this_private_trip()}</span>
            {importSession.picker_uri && (
              <a className="action-link" href={importSession.picker_uri} target="_blank" rel="noreferrer">
                {m.assets_open_selection()}
              </a>
            )}
            <Button type="button" onClick={finishImport}>
              {m.assets_import_selection()}
            </Button>
          </aside>
        )}
      </div>
      {assets.length > 0 && (
        <div className="manager-subsection">
          <div className="capture-heading">
            <div>
              <h3>{m.assets_review_possible_travel_updates()}</h3>
              <p>
                {m.assets_choose_private_media_above_candidates_use_a_twohour_window_and_ke_line({
                  p0: candidateReview?.gps_agreement_metres ?? 500,
                })}
              </p>
            </div>
          </div>
          <Button className="w-fit" type="button" onClick={review}>
            {m.assets_review_selected_media()}
          </Button>
          {candidateReview?.unavailable_media_asset_ids.length ? (
            <p className="help">
              {m.assets_metadata_unavailable({ count: candidateReview.unavailable_media_asset_ids.length })}
            </p>
          ) : null}
          {candidateReview?.candidates.map((candidate) => (
            <article className="scope-item" key={candidate.id}>
              <strong>{candidateAssetNames(candidate)}</strong>
              <span>
                {candidate.starts_at
                  ? `${timestamp(candidate.starts_at)}${candidate.ends_at && candidate.ends_at !== candidate.starts_at ? ` – ${dayjs(candidate.ends_at).format("HH:mm")}` : ""}`
                  : m.assets_no_capture_time_available()}
              </span>
              {candidate.time_options.length > 1 && (
                <Field>
                  <FieldLabel>{m.assets_use_capture_time()}</FieldLabel>
                  <SearchSelect
                    ariaLabel={m.assets_use_capture_time()}
                    value={candidateTimes[candidate.id] ?? ""}
                    onChange={(value) => setCandidateTimes((current) => ({ ...current, [candidate.id]: value }))}
                  >
                    <option value="">{m.assets_choose_a_time_yourself()}</option>
                    {candidate.time_options.map((option) => (
                      <option key={option.media_asset_id} value={option.captured_at}>
                        {timestamp(option.captured_at)}
                      </option>
                    ))}
                  </SearchSelect>
                </Field>
              )}
              {candidate.location_options.length > 1 && (
                <Field>
                  <FieldLabel>{m.assets_gps_choice()}</FieldLabel>
                  <SearchSelect
                    ariaLabel={m.assets_gps_choice()}
                    value={candidateLocations[candidate.id] ?? ""}
                    onChange={(value) => setCandidateLocations((current) => ({ ...current, [candidate.id]: value }))}
                  >
                    <option value="">{m.owner_dismiss_location()}</option>
                    {candidate.location_options.map((option, index) => (
                      <option key={option.media_asset_ids.join("-")} value={index}>
                        {m.assets_location_from_media_items_line({ p0: option.media_asset_ids.length })}
                      </option>
                    ))}
                  </SearchSelect>
                </Field>
              )}
              {candidate.location_options.length === 0 && (
                <p className="help">{m.assets_no_gps_available_no_place_will_be_suggested()}</p>
              )}
              {candidate.location_options.length > 1 && (
                <p className="help">
                  {m.assets_the_gps_metadata_conflicts_choose_at_most_one_option_nothing_will_be_mer()}
                </p>
              )}
              {candidate.location_options.length > 0 && (
                <Button className="secondary compact" type="button" onClick={() => suggestCandidateArea(candidate)}>
                  {m.assets_suggest_area_and_visit()}
                </Button>
              )}
              {candidateAreas[candidate.id] && (
                <p className="help">
                  {m.assets_this_suggestion_has_not_been_saved_line({
                    p0: candidateAreas[candidate.id].existing_area_id
                      ? m.assets_existing_area({ p0: candidateAreas[candidate.id].area.label })
                      : m.assets_new_area_possible({
                          p0: candidateAreas[candidate.id].area.label,
                          p1: candidateAreas[candidate.id].area.timezone ?? m.assets_unknown_timezone(),
                        }),
                    p1:
                      visits
                        .filter(
                          (visit) =>
                            visit.area.id === candidateAreas[candidate.id].existing_area_id &&
                            candidate.starts_at &&
                            visit.starts_on &&
                            candidate.starts_at.slice(0, 10) >= visit.starts_on &&
                            candidate.starts_at.slice(0, 10) <= (visit.ends_on ?? visit.starts_on),
                        )
                        .map((visit) => visitTitle(visit))
                        .join(", ") || m.assets_new_visit_possible(),
                  })}
                </p>
              )}
              <div className="button-row">
                <Button type="button" onClick={() => startCandidateUpdate(candidate)}>
                  {m.assets_open_as_a_new_travel_update()}
                </Button>
                {
                  <>
                    <Field>
                      <FieldLabel className="scope-choice">{m.assets_link_to()}</FieldLabel>
                      <AsyncSearchSelect
                        ariaLabel={m.assets_link_to()}
                        value={candidateAttachments[candidate.id] ?? ""}
                        selectedOption={
                          foundUpdates[candidateAttachments[candidate.id]]
                            ? {
                                value: candidateAttachments[candidate.id],
                                label: foundUpdates[candidateAttachments[candidate.id]].title,
                              }
                            : null
                        }
                        onChange={(value) =>
                          setCandidateAttachments((current) => ({ ...current, [candidate.id]: value }))
                        }
                        loadOptions={async (q) => {
                          const updates = await searchUpdates(q);
                          setFoundUpdates((current) => ({
                            ...current,
                            ...Object.fromEntries(updates.map((update) => [update.id, update])),
                          }));
                          return [
                            { value: "", label: m.assets_choose_existing_travel_update() },
                            ...updates.map((update) => ({ value: update.id, label: update.title })),
                          ];
                        }}
                      />
                    </Field>
                    <Button className="secondary" type="button" onClick={() => attachCandidate(candidate)}>
                      {m.assets_link_to_travel_update()}
                    </Button>
                  </>
                }
              </div>
            </article>
          ))}
        </div>
      )}
      <RecordDialog
        open={dialogOpen}
        title={dialogTitle}
        dirty={dialogDirty}
        error={assetDialog.error}
        onDismiss={closeAsset}
      >
        {selected && view.kind === "asset" && (
          <div className="stack-form">
            <div>
              {selected.thumbnail_url && owner ? (
                <OwnerImage
                  session={owner.session}
                  url={selected.thumbnail_url}
                  alt=""
                  className="mb-1 block max-h-65 max-w-65 rounded-travel-media bg-travel-media-bg object-contain"
                />
              ) : null}
              <h3>{selected.original_filename ?? m.owner_unnamed_media_item()}</h3>
              <p>
                {selected.media_kind === "photo" ? m.assets_photo() : m.assets_video()} ·{" "}
                {bytesLabel(selected.byte_size)}
                {selected.captured_at ? ` · ${timestamp(selected.captured_at)}` : ""}
              </p>
            </div>
            <div className="button-row">
              <Button
                className="secondary compact"
                type="button"
                onClick={() => open(selected.file_url, m.assets_the_private_original_could_not_be_opened)}
              >
                {m.assets_view_original()}
              </Button>
              <Button
                className="secondary compact"
                type="button"
                onClick={() =>
                  void toggleOffline(selected).catch(fail(m.assets_the_private_media_item_could_not_be_saved_offline))
                }
              >
                {offline.isPinned("media_asset", selected.id) ? m.owner_remove_offline_copy() : m.owner_save_offline()}
              </Button>
              <Button className="danger compact" type="button" onClick={() => setConfirmDeleteAsset(true)}>
                {m.owner_delete()}
              </Button>
            </div>
            {confirmDeleteAsset && (
              <DeleteConfirmation
                title={m.assets_delete_from_this_trip({
                  p0: selected.original_filename ?? m.assets_this_media_item_2(),
                })}
                description={m.assets_links_to_travel_updates_will_also_be_removed()}
                onCancel={() => setConfirmDeleteAsset(false)}
                onConfirm={() => performEraseAsset(selected)}
              />
            )}
            <div className="manager-subsection">
              <div className="capture-heading">
                <div>
                  <h4>{m.assets_copies_to_share()}</h4>
                  <p>{m.assets_a_new_copy_always_requires_explicit_approval()}</p>
                </div>
                <Button className="secondary compact" type="button" onClick={startCreateCopy}>
                  {m.assets_create_copy()}
                </Button>
              </div>
              {derivatives.length > 0 ? (
                <div className="saved-records mt-0.5">
                  {derivatives.map((item) => {
                    const canPreview = item.processing_state !== "processing" && item.processing_state !== "failed";
                    const previewUrl = item.media_kind === "video" ? (item.poster_url ?? null) : item.file_url;
                    return (
                      <article className="excerpt-row" key={item.id}>
                        <Button
                          className="document-select flex items-center gap-3"
                          type="button"
                          onClick={() => viewCopy(item.id)}
                          aria-label={m.assets_view_copy({ p0: purposeLabel[item.purpose] })}
                        >
                          {canPreview && previewUrl && owner ? (
                            <OwnerImage
                              session={owner.session}
                              url={previewUrl}
                              alt=""
                              className="size-13 shrink-0 rounded-lg bg-travel-media-bg object-cover"
                            />
                          ) : (
                            <span
                              className="size-13 shrink-0 rounded-lg bg-travel-media-bg object-cover media-thumbnail-placeholder"
                              aria-hidden="true"
                            >
                              {item.media_kind === "video" ? "🎞" : "🖼"}
                            </span>
                          )}
                          <div className="min-w-0">
                            <strong>
                              {item.processing_state === "processing"
                                ? m.assets_processing()
                                : item.processing_state === "failed"
                                  ? m.assets_processing_failed()
                                  : item.review_state === "approved"
                                    ? m.assets_approved()
                                    : m.assets_awaiting_approval()}
                            </strong>
                            <span>
                              {purposeLabel[item.purpose]} ·{" "}
                              {item.width && item.height
                                ? `${item.width} × ${item.height}`
                                : m.assets_unknown_dimensions()}
                            </span>
                          </div>
                        </Button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="help">{m.assets_no_copies_for_this_media_item_yet()}</p>
              )}
            </div>
          </div>
        )}
        {selected && view.kind === "create" && (
          <RecordForm
            record={derivativeRecord}
            submitLabel={
              selected.media_kind === "video" ? m.assets_create_safe_video_copy() : m.assets_create_metadatafree_copy()
            }
            pendingLabel={m.assets_creating_copy()}
            actions={cancelAction}
          >
            <div className="field-row">
              <derivativeRecord.form.Field name="purpose">
                {(field) => (
                  <SelectField field={field} label={m.assets_purpose()}>
                    <option value="share">{m.owner_sharing()}</option>
                    <option value="static_export">{m.assets_static_archive()}</option>
                    <option value="owner_preview">{m.assets_private_preview()}</option>
                  </SelectField>
                )}
              </derivativeRecord.form.Field>
              {selected.media_kind === "photo" && (
                <derivativeRecord.form.Field
                  name="maxDimension"
                  validators={{ onChange: dimensionInRange, onSubmit: dimensionInRange }}
                >
                  {(field) => (
                    <TextField
                      field={field}
                      label={m.assets_maximum_side_px()}
                      required
                      min={64}
                      max={4000}
                      type="number"
                    />
                  )}
                </derivativeRecord.form.Field>
              )}
              {selected.media_kind === "video" && (
                <derivativeRecord.form.Field name="removeAudio">
                  {(field) => (
                    <Field className="contents">
                      <FieldLabel className="scope-choice">
                        <TravelCheckbox
                          checked={field.state.value}
                          onCheckedChange={(checked) => field.handleChange(checked)}
                        />
                        {m.assets_remove_audio()}
                      </FieldLabel>
                    </Field>
                  )}
                </derivativeRecord.form.Field>
              )}
            </div>
          </RecordForm>
        )}
        {selected &&
          view.kind === "copy" &&
          selectedDerivative &&
          !view.edit &&
          (() => {
            const canPreview =
              selectedDerivative.processing_state !== "processing" && selectedDerivative.processing_state !== "failed";
            const previewUrl =
              selectedDerivative.media_kind === "video"
                ? (selectedDerivative.poster_url ?? null)
                : selectedDerivative.file_url;
            return (
              <div className="stack-form">
                {canPreview && previewUrl && owner && (
                  <OwnerImage
                    session={owner.session}
                    url={previewUrl}
                    alt={m.assets_preview_of_the_copy_of({
                      p0: selected.original_filename ?? m.assets_this_media_item_2(),
                    })}
                    className="mb-1 block max-h-65 max-w-65 rounded-travel-media bg-travel-media-bg object-contain"
                  />
                )}
                <div>
                  <strong>
                    {selectedDerivative.processing_state === "processing"
                      ? m.assets_video_is_being_processed()
                      : selectedDerivative.processing_state === "failed"
                        ? m.assets_processing_failed()
                        : selectedDerivative.review_state === "approved"
                          ? m.assets_approved_copy()
                          : m.assets_awaiting_approval()}
                  </strong>
                  <p>
                    {purposeLabel[selectedDerivative.purpose]} ·{" "}
                    {selectedDerivative.width && selectedDerivative.height
                      ? `${selectedDerivative.width} × ${selectedDerivative.height}`
                      : m.assets_unknown_dimensions()}
                    {selectedDerivative.media_kind === "video" &&
                      ` · ${selectedDerivative.duration_seconds?.toFixed(1) ?? "?"} s · ${selectedDerivative.remove_audio ? m.assets_without_audio() : m.assets_with_audio()}`}
                  </p>
                </div>
                {selectedDerivative.review_state === "approved" &&
                  selectedDerivative.processing_state !== "failed" &&
                  selectedDerivative.purpose === "share" && (
                    <VisibilityControl
                      tripId={trip.id}
                      kind="media_derivative"
                      id={selectedDerivative.id}
                      value={selectedDerivative.visibility}
                      name={m.assets_copy_of({ p0: selected.original_filename ?? "foto" })}
                      followsUpdate={
                        trip.travel_updates.find((update) => update.id === selectedDerivative.travel_update_id)?.title
                      }
                    />
                  )}
                <div className="button-row">
                  {canPreview && (
                    <Button
                      className="secondary compact"
                      type="button"
                      onClick={() => open(selectedDerivative.file_url, m.assets_the_private_copy_could_not_be_opened)}
                    >
                      {selectedDerivative.media_kind === "video" ? m.assets_check_video_and_audio() : m.assets_view()}
                    </Button>
                  )}
                  {canPreview && (
                    <Button
                      className="secondary compact"
                      type="button"
                      onClick={() =>
                        void toggleDerivativeOffline(selectedDerivative).catch(
                          fail(m.assets_the_copy_could_not_be_saved_offline),
                        )
                      }
                    >
                      {offline.isPinned("media_derivative", selectedDerivative.id)
                        ? m.owner_remove_offline_copy()
                        : m.assets_save_offline({ p0: bytesLabel(selectedDerivative.byte_size ?? 0) })}
                    </Button>
                  )}
                  {selectedDerivative.processing_state === "failed" && (
                    <Button
                      className="secondary compact"
                      type="button"
                      onClick={() =>
                        retry
                          .mutateAsync({ assetId: selected.id, derivative: selectedDerivative })
                          .catch(fail(m.assets_the_video_could_not_be_processed_again))
                      }
                    >
                      {m.retry()}
                    </Button>
                  )}
                  {selectedDerivative.review_state === "pending" && canPreview && (
                    <Button
                      className="compact"
                      type="button"
                      onClick={() =>
                        approve
                          .mutateAsync({ assetId: selected.id, derivative: selectedDerivative })
                          .then(
                            () =>
                              setNotice(
                                textNotice(() => m.assets_copy_explicitly_approved_now_choose_who_can_see_it()),
                              ),
                            fail(m.assets_the_copy_could_not_be_approved),
                          )
                      }
                    >
                      {m.assets_explicitly_approve()}
                    </Button>
                  )}
                  {selectedDerivative.purpose === "share" && selectedDerivative.processing_state !== "processing" && (
                    <Button className="secondary compact" type="button" onClick={() => editCopy(selectedDerivative)}>
                      {m.assets_edit_presentation()}
                    </Button>
                  )}
                  <Button className="danger compact" type="button" onClick={() => setConfirmDeleteCopy(true)}>
                    {m.owner_delete()}
                  </Button>
                </div>
                {confirmDeleteCopy && (
                  <DeleteConfirmation
                    title={m.assets_delete_this_copy()}
                    description={m.assets_it_will_immediately_be_removed_from_any_sharing_scopes()}
                    onCancel={() => setConfirmDeleteCopy(false)}
                    onConfirm={() => performEraseDerivative(selected, selectedDerivative)}
                  />
                )}
                <div className="button-row">{cancelAction}</div>
              </div>
            );
          })()}
        {selected && view.kind === "copy" && selectedDerivative && view.edit && (
          <RecordForm
            record={presentationRecord}
            submitLabel={m.assets_save_presentation()}
            pendingLabel={m.owner_saving()}
            actions={cancelAction}
          >
            <PresentationFields
              record={presentationRecord}
              tripId={trip.id}
              updates={trip.travel_updates}
              previewUrl={
                selectedDerivative.media_kind === "video"
                  ? (selectedDerivative.poster_url ?? null)
                  : selectedDerivative.file_url
              }
              session={owner?.session ?? null}
            />
          </RecordForm>
        )}
      </RecordDialog>
    </section>
  );
}
