import { Button } from "@/ui/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { formatCapture, type MediaAsset } from "../../tracker-model";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { SuggestionAside } from "./SuggestionAside";

type Gps = { latitude: number; longitude: number };

/** The private photos that can be linked to the update, with suggestions read from the linked ones. */
export function PhotoLinks({
  mediaState,
  media,
  attachedMedia,
  selectedIds,
  dismissedSuggestions,
  onToggle,
  onUseCaptureDate,
  onFindPlace,
  onDismiss,
}: {
  mediaState: string;
  media: MediaAsset[];
  attachedMedia: MediaAsset[];
  selectedIds: string[];
  dismissedSuggestions: string[];
  onToggle: (assetId: string) => void;
  onUseCaptureDate: (asset: MediaAsset) => void;
  onFindPlace: (gps: Gps) => void;
  onDismiss: (assetId: string) => void;
}) {
  useLocale();
  return (
    <FieldSet className="location">
      <FieldLegend>{m.owner_link_private_photos()}</FieldLegend>
      <p>{m.owner_a_link_is_private_exif_is_only_used_below_as_a_suggestion_no_date_or_pla()}</p>
      <p className="help" role="status">
        {mediaState}
      </p>
      {media.map((asset) => (
        <Field className="contents" key={asset.id}>
          <FieldLabel className="flex items-center gap-2 rounded-lg border border-travel-divider bg-travel-surface px-2.75 py-2.5 font-semibold">
            <TravelCheckbox
              checked={selectedIds.includes(asset.id)}
              onCheckedChange={() => onToggle(asset.id)}
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
            <SuggestionAside key={`suggestion-${asset.id}`}>
              <strong>
                {m.owner_suggestion_from()} {asset.original_filename ?? m.owner_this_photo()}
              </strong>
              {asset.captured_at && (
                <span>
                  {m.owner_captured_2()} {formatCapture(asset.captured_at, asset.captured_local)}.
                </span>
              )}
              <div className="button-row">
                {asset.captured_at && (
                  <Button
                    className="secondary compact"
                    type="button"
                    onClick={() => onUseCaptureDate(asset)}
                  >
                    {m.owner_use_capture_date()}
                  </Button>
                )}
                {asset.gps && (
                  <Button
                    className="secondary compact"
                    type="button"
                    onClick={() => onFindPlace(asset.gps!)}
                  >
                    {m.owner_find_place_for_photo()}
                  </Button>
                )}
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() => onDismiss(asset.id)}
                >
                  {m.owner_dismiss_suggestion()}
                </Button>
              </div>
            </SuggestionAside>
          ),
      )}
      {attachedMedia.filter((asset) => asset.captured_at || asset.gps).length > 1 && (
        <p className="help">
          {m.owner_photos_can_differ_each_suggestion_remains_visible_separately_choose_at_m()}
        </p>
      )}
    </FieldSet>
  );
}
