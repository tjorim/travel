import { Button } from "@/ui/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { useOwner } from "../../query/owner-queries";
import { bytesLabel, formatCapture, type MediaAsset } from "../../tracker-model";
import { Field, FieldLabel } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { OwnerImage } from "../OwnerImage";

/** The trip's media as selectable rows, each with a checkbox that adds it to the travel-update review. */
export function MediaAssetList({
  assets,
  selectedId,
  reviewSelection,
  onInspect,
  onToggleReview,
}: {
  assets: MediaAsset[];
  selectedId: string | null;
  reviewSelection: string[];
  onInspect: (id: string) => void;
  onToggleReview: (id: string) => void;
}) {
  useLocale();
  const owner = useOwner();
  if (assets.length === 0) return null;
  return (
    <div className="saved-records mt-0.5">
      {assets.map((asset) => (
        <article
          className="excerpt-row"
          data-selected={asset.id === selectedId ? "" : undefined}
          key={asset.id}
        >
          <Button
            className="document-select flex items-center gap-3"
            type="button"
            onClick={() => onInspect(asset.id)}
            aria-label={m.assets_view_2({
              p0: asset.original_filename ?? m.owner_unnamed_media_item(),
            })}
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
                {asset.media_kind === "photo" ? m.assets_photo() : m.assets_video()} ·{" "}
                {bytesLabel(asset.byte_size)}
                {asset.captured_at
                  ? ` · ${formatCapture(asset.captured_at, asset.captured_local)}`
                  : ""}
              </span>
            </div>
          </Button>
          <div className="button-row">
            <Field className="contents">
              <FieldLabel className="scope-choice">
                <TravelCheckbox
                  checked={reviewSelection.includes(asset.id)}
                  onCheckedChange={() => onToggleReview(asset.id)}
                />
                {m.assets_review_travel_updates()}
              </FieldLabel>
            </Field>
          </div>
        </article>
      ))}
    </div>
  );
}
