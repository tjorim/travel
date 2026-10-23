import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { useEffect, useState, type FormEvent } from "react";

import { RecordForm } from "../forms/fields";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useLocale } from "../locale";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { m } from "../paraglide/messages.js";
import { errorMessage, openOwnerFile, ownerFile, type ErrorFallback } from "../query/api";
import { errorNotice, textNotice, useFeedback } from "../query/feedback";
import { tripPath, useDerivatives, useOwner, useTripResource } from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import type {
  ImportSession,
  MediaAsset,
  MediaDerivative,
  Trip,
  TravelUpdateCandidateIntent,
} from "../tracker-model";
import { Field, FieldLabel } from "@/ui/field";
import { AssetView } from "./media/AssetView";
import { CandidateReview } from "./media/CandidateReview";
import {
  blankDerivative,
  blankPresentation,
  fromDerivative,
  PresentationFields,
  type DerivativeValues,
  type PresentationValues,
} from "./media/copy-form";
import { CopyCreateFields } from "./media/CopyCreateFields";
import { CopyView } from "./media/CopyView";
import { providerLabel } from "./media/labels";
import { MediaAssetList } from "./media/MediaAssetList";
import { MediaImport } from "./media/MediaImport";
import { useMediaMutations } from "./media/use-media-mutations";

/** Which part of the asset dialog is showing: the asset with its copies, a new copy's form, or one copy's detail/edit. */
type CopyView =
  | { kind: "asset" }
  | { kind: "create" }
  | { kind: "copy"; id: string; edit: boolean };

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
  const selectedDerivative =
    view.kind === "copy" ? (derivatives.find((item) => item.id === view.id) ?? null) : null;
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useFeedback<string | null>(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [importSession, setImportSession] = useState<ImportSession | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const reviewSelection = selection.filter((id) => assets.some((asset) => asset.id === id));
  const [notice, setNotice] = useFeedback<string | null>(null);
  const mediaPath = tripPath(trip.id, "media");

  const {
    upload,
    remove,
    requestDerivative,
    approve,
    retry,
    presentation,
    setCover,
    removeDerivative,
    startImport,
    completeImport,
  } = useMediaMutations(trip.id, selected);

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
      setNotice(
        textNotice(() => m.assets_copy_started_check_the_copy_and_then_explicitly_approve_it()),
      );
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
      setNotice(
        textNotice(() =>
          m.assets_presentation_saved_only_fields_selected_in_a_sharing_scope_become_visibl(),
        ),
      );
    },
  });

  useEffect(() => {
    if (!derivatives.some((item) => item.processing_state === "processing")) return;
    const timer = window.setInterval(() => {
      void derivativesQuery.refetch();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [derivatives, derivativesQuery]);

  const fail = (fallback: ErrorFallback) => (error: unknown) =>
    setNotice(errorNotice(error, fallback));
  const failInDialog = (fallback: ErrorFallback) => (error: unknown) => {
    setConfirmDeleteAsset(false);
    setConfirmDeleteCopy(false);
    assetDialog.setError(errorNotice(error, fallback));
  };

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
        setNotice(
          textNotice(() =>
            m.assets_private_media_uploaded_you_can_now_link_them_to_a_travel_update(),
          ),
        );
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
        setNotice(
          textNotice(() =>
            m.assets_private_media_deleted_links_to_travel_updates_have_also_been_removed(),
          ),
        );
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
          m.owner_is_no_longer_available_offline({
            p0: asset.original_filename ?? m.assets_this_media_item(),
          }),
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
        m.owner_is_saved_offline_on_this_device({
          p0: asset.original_filename ?? m.assets_this_media_item(),
        }),
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
    const blob = await ownerFile(
      owner.session,
      derivative.file_url,
      m.assets_the_copy_could_not_be_saved_offline,
      {
        cache: "no-store",
      },
    );
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
          m.assets_choose_media_in_then_return_here_to_import_your_selection({
            p0: providerLabel[provider],
          }),
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
          textNotice(() =>
            m.assets_your_selection_is_not_ready_at_the_provider_yet_try_again_when_you_are_d(),
          ),
        );
        return;
      }
      if (outcome.imported[0]) inspectAsset(outcome.imported[0].id);
      setNotice(
        textNotice(
          () =>
            m.assets_imported_count({ count: outcome.imported.length }) +
            (outcome.failed.length
              ? m.assets_import_failed_count({ count: outcome.failed.length })
              : "."),
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
          <p>
            {m.assets_originals_and_metadata_stay_private_only_a_separate_metadatafree_and_app()}
          </p>
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
      <MediaAssetList
        assets={assets}
        selectedId={selected?.id ?? null}
        reviewSelection={reviewSelection}
        onInspect={inspectAsset}
        onToggleReview={toggleReviewSelection}
      />
      <MediaImport importSession={importSession} onStart={startProvider} onFinish={finishImport} />
      <CandidateReview
        tripId={trip.id}
        assets={assets}
        visits={visits}
        reviewSelection={reviewSelection}
        onNotice={setNotice}
        onStartCaptureFromCandidate={onStartCaptureFromCandidate}
      />
      <RecordDialog
        open={dialogOpen}
        title={dialogTitle}
        dirty={dialogDirty}
        error={assetDialog.error}
        onDismiss={closeAsset}
      >
        {selected && view.kind === "asset" && (
          <AssetView
            asset={selected}
            derivatives={derivatives}
            pinned={offline.isPinned("media_asset", selected.id)}
            confirmingDelete={confirmDeleteAsset}
            onViewOriginal={() =>
              open(selected.file_url, m.assets_the_private_original_could_not_be_opened)
            }
            onToggleOffline={() =>
              void toggleOffline(selected).catch(
                fail(m.assets_the_private_media_item_could_not_be_saved_offline),
              )
            }
            onAskDelete={() => setConfirmDeleteAsset(true)}
            onCancelDelete={() => setConfirmDeleteAsset(false)}
            onConfirmDelete={() => performEraseAsset(selected)}
            onCreateCopy={startCreateCopy}
            onViewCopy={viewCopy}
          />
        )}
        {selected && view.kind === "create" && (
          <RecordForm
            record={derivativeRecord}
            submitLabel={
              selected.media_kind === "video"
                ? m.assets_create_safe_video_copy()
                : m.assets_create_metadatafree_copy()
            }
            pendingLabel={m.assets_creating_copy()}
            actions={cancelAction}
          >
            <CopyCreateFields record={derivativeRecord} mediaKind={selected.media_kind} />
          </RecordForm>
        )}
        {selected && view.kind === "copy" && selectedDerivative && !view.edit && (
          <CopyView
            trip={trip}
            asset={selected}
            derivative={selectedDerivative}
            pinned={offline.isPinned("media_derivative", selectedDerivative.id)}
            confirmingDelete={confirmDeleteCopy}
            onOpen={() =>
              open(selectedDerivative.file_url, m.assets_the_private_copy_could_not_be_opened)
            }
            onToggleOffline={() =>
              void toggleDerivativeOffline(selectedDerivative).catch(
                fail(m.assets_the_copy_could_not_be_saved_offline),
              )
            }
            onRetry={() =>
              retry
                .mutateAsync({ assetId: selected.id, derivative: selectedDerivative })
                .catch(fail(m.assets_the_video_could_not_be_processed_again))
            }
            onApprove={() =>
              approve
                .mutateAsync({ assetId: selected.id, derivative: selectedDerivative })
                .then(
                  () =>
                    setNotice(
                      textNotice(() =>
                        m.assets_copy_explicitly_approved_now_choose_who_can_see_it(),
                      ),
                    ),
                  fail(m.assets_the_copy_could_not_be_approved),
                )
            }
            onEdit={() => editCopy(selectedDerivative)}
            onToggleCover={() =>
              setCover
                .mutateAsync(selectedDerivative.is_cover ? null : selectedDerivative)
                .then(
                  () =>
                    setNotice(
                      textNotice(() =>
                        selectedDerivative.is_cover
                          ? m.assets_cover_removed()
                          : m.assets_cover_chosen(),
                      ),
                    ),
                  fail(m.assets_the_cover_could_not_be_saved),
                )
            }
            onAskDelete={() => setConfirmDeleteCopy(true)}
            onCancelDelete={() => setConfirmDeleteCopy(false)}
            onConfirmDelete={() => performEraseDerivative(selected, selectedDerivative)}
            onBack={backToAsset}
          />
        )}
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
