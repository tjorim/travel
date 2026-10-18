import { Button } from "@base-ui/react/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { useOwner } from "../../query/owner-queries";
import { DeleteConfirmation } from "../../RecordDialog";
import {
  bytesLabel,
  formatCapture,
  type MediaAsset,
  type MediaDerivative,
} from "../../tracker-model";
import { OwnerImage } from "../OwnerImage";
import { purposeLabel } from "./labels";

/** One medium in the asset dialog: its original, offline copy and deletion, and the copies made from it. */
export function AssetView({
  asset,
  derivatives,
  pinned,
  confirmingDelete,
  onViewOriginal,
  onToggleOffline,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onCreateCopy,
  onViewCopy,
}: {
  asset: MediaAsset;
  derivatives: MediaDerivative[];
  pinned: boolean;
  confirmingDelete: boolean;
  onViewOriginal: () => void;
  onToggleOffline: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onCreateCopy: () => void;
  onViewCopy: (id: string) => void;
}) {
  useLocale();
  const owner = useOwner();
  return (
    <div className="stack-form">
      <div>
        {asset.thumbnail_url && owner ? (
          <OwnerImage
            session={owner.session}
            url={asset.thumbnail_url}
            alt=""
            className="mb-1 block max-h-65 max-w-65 rounded-travel-media bg-travel-media-bg object-contain"
          />
        ) : null}
        <h3>{asset.original_filename ?? m.owner_unnamed_media_item()}</h3>
        <p>
          {asset.media_kind === "photo" ? m.assets_photo() : m.assets_video()} ·{" "}
          {bytesLabel(asset.byte_size)}
          {asset.captured_at ? ` · ${formatCapture(asset.captured_at, asset.captured_local)}` : ""}
        </p>
      </div>
      <div className="button-row">
        <Button className="secondary compact" type="button" onClick={onViewOriginal}>
          {m.assets_view_original()}
        </Button>
        <Button className="secondary compact" type="button" onClick={onToggleOffline}>
          {pinned ? m.owner_remove_offline_copy() : m.owner_save_offline()}
        </Button>
        <Button className="danger compact" type="button" onClick={onAskDelete}>
          {m.owner_delete()}
        </Button>
      </div>
      {confirmingDelete && (
        <DeleteConfirmation
          title={m.assets_delete_from_this_trip({
            p0: asset.original_filename ?? m.assets_this_media_item_2(),
          })}
          description={m.assets_links_to_travel_updates_will_also_be_removed()}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      )}
      <div className="manager-subsection">
        <div className="capture-heading">
          <div>
            <h4>{m.assets_copies_to_share()}</h4>
            <p>{m.assets_a_new_copy_always_requires_explicit_approval()}</p>
          </div>
          <Button className="secondary compact" type="button" onClick={onCreateCopy}>
            {m.assets_create_copy()}
          </Button>
        </div>
        {derivatives.length > 0 ? (
          <div className="saved-records mt-0.5">
            {derivatives.map((item) => {
              const canPreview =
                item.processing_state !== "processing" && item.processing_state !== "failed";
              const previewUrl =
                item.media_kind === "video" ? (item.poster_url ?? null) : item.file_url;
              return (
                <article className="excerpt-row" key={item.id}>
                  <Button
                    className="document-select flex items-center gap-3"
                    type="button"
                    onClick={() => onViewCopy(item.id)}
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
  );
}
