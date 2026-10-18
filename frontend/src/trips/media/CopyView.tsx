import { Button } from "@base-ui/react/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { useOwner } from "../../query/owner-queries";
import { DeleteConfirmation } from "../../RecordDialog";
import { bytesLabel, type MediaAsset, type MediaDerivative, type Trip } from "../../tracker-model";
import { OwnerImage } from "../OwnerImage";
import { VisibilityControl } from "../visibility";
import { purposeLabel } from "./labels";

/** One copy in the asset dialog: its preview and state, who may see it, and the actions that move it forward. */
export function CopyView({
  trip,
  asset,
  derivative,
  pinned,
  confirmingDelete,
  onOpen,
  onToggleOffline,
  onRetry,
  onApprove,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onBack,
}: {
  trip: Trip;
  asset: MediaAsset;
  derivative: MediaDerivative;
  pinned: boolean;
  confirmingDelete: boolean;
  onOpen: () => void;
  onToggleOffline: () => void;
  onRetry: () => void;
  onApprove: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onBack: () => void;
}) {
  useLocale();
  const owner = useOwner();
  const canPreview =
    derivative.processing_state !== "processing" && derivative.processing_state !== "failed";
  const previewUrl =
    derivative.media_kind === "video" ? (derivative.poster_url ?? null) : derivative.file_url;
  return (
    <div className="stack-form">
      {canPreview && previewUrl && owner && (
        <OwnerImage
          session={owner.session}
          url={previewUrl}
          alt={m.assets_preview_of_the_copy_of({
            p0: asset.original_filename ?? m.assets_this_media_item_2(),
          })}
          className="mb-1 block max-h-65 max-w-65 rounded-travel-media bg-travel-media-bg object-contain"
        />
      )}
      <div>
        <strong>
          {derivative.processing_state === "processing"
            ? m.assets_video_is_being_processed()
            : derivative.processing_state === "failed"
              ? m.assets_processing_failed()
              : derivative.review_state === "approved"
                ? m.assets_approved_copy()
                : m.assets_awaiting_approval()}
        </strong>
        <p>
          {purposeLabel[derivative.purpose]} ·{" "}
          {derivative.width && derivative.height
            ? `${derivative.width} × ${derivative.height}`
            : m.assets_unknown_dimensions()}
          {derivative.media_kind === "video" &&
            ` · ${derivative.duration_seconds?.toFixed(1) ?? "?"} s · ${derivative.remove_audio ? m.assets_without_audio() : m.assets_with_audio()}`}
        </p>
      </div>
      {derivative.review_state === "approved" &&
        derivative.processing_state !== "failed" &&
        derivative.purpose === "share" && (
          <VisibilityControl
            tripId={trip.id}
            kind="media_derivative"
            id={derivative.id}
            value={derivative.visibility}
            name={m.assets_copy_of({ p0: asset.original_filename ?? "foto" })}
            followsUpdate={
              trip.travel_updates.find((update) => update.id === derivative.travel_update_id)?.title
            }
          />
        )}
      <div className="button-row">
        {canPreview && (
          <Button className="secondary compact" type="button" onClick={onOpen}>
            {derivative.media_kind === "video" ? m.assets_check_video_and_audio() : m.assets_view()}
          </Button>
        )}
        {canPreview && (
          <Button className="secondary compact" type="button" onClick={onToggleOffline}>
            {pinned
              ? m.owner_remove_offline_copy()
              : m.assets_save_offline({ p0: bytesLabel(derivative.byte_size ?? 0) })}
          </Button>
        )}
        {derivative.processing_state === "failed" && (
          <Button className="secondary compact" type="button" onClick={onRetry}>
            {m.retry()}
          </Button>
        )}
        {derivative.review_state === "pending" && canPreview && (
          <Button className="compact" type="button" onClick={onApprove}>
            {m.assets_explicitly_approve()}
          </Button>
        )}
        {derivative.purpose === "share" && derivative.processing_state !== "processing" && (
          <Button className="secondary compact" type="button" onClick={onEdit}>
            {m.assets_edit_presentation()}
          </Button>
        )}
        <Button className="danger compact" type="button" onClick={onAskDelete}>
          {m.owner_delete()}
        </Button>
      </div>
      {confirmingDelete && (
        <DeleteConfirmation
          title={m.assets_delete_this_copy()}
          description={m.assets_it_will_immediately_be_removed_from_any_sharing_scopes()}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      )}
      <div className="button-row">
        <Button className="secondary" type="button" onClick={onBack}>
          {m.assets_back_to_the_media_item()}
        </Button>
      </div>
    </div>
  );
}
