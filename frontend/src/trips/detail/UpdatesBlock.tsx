import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { Markdown } from "../../Markdown";
import type { MediaAsset, Trip } from "../../tracker-model";
import { visibilityLabel } from "../visibility";
import {
  MediaPreview,
  placeLabel,
  RecordHeading,
  RecordLink,
  Section,
  timestamp,
  type OwnerSession,
} from "./shared";
import { DetailList } from "./DetailList";

export function UpdatesBlock({
  trip,
  mediaById,
  session,
}: {
  trip: Trip;
  mediaById: Map<string, MediaAsset>;
  session: OwnerSession | null;
}) {
  useLocale();
  return (
    <Section id="updates" title={m.owner_travel_updates()}>
      <DetailList
        empty={trip.travel_updates.length === 0}
        message={m.owner_no_travel_updates_captured()}
      >
        {trip.travel_updates
          .slice()
          .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
          .map((update) => (
            <article key={update.id}>
              <RecordHeading tripId={trip.id} kind="update" id={update.id}>
                {update.title}
              </RecordHeading>
              <p>
                {timestamp(update.occurred_at)} · {placeLabel(update.location)} ·{" "}
                {visibilityLabel(update.visibility)}
              </p>
              <p className="markdown-label">{m.owner_for_visitors()}</p>
              {update.body ? (
                <Markdown html={update.body_html} text={update.body} />
              ) : (
                <p className="help">{m.owner_no_text_for_visitors_yet()}</p>
              )}
              {update.private_notes && (
                <>
                  <p className="markdown-label">{m.owner_private_note()}</p>
                  <Markdown html={update.private_notes_html} text={update.private_notes} />
                </>
              )}
              {update.media_asset_ids.length > 0 && (
                <div
                  className="flex flex-wrap gap-3"
                  role="group"
                  aria-label={m.owner_media_for({ p0: update.title })}
                >
                  {update.media_asset_ids.map((assetId) => {
                    const asset = mediaById.get(assetId);
                    return asset && session ? (
                      <div key={assetId} className="grid max-w-37.5 gap-1.25">
                        <MediaPreview asset={asset} session={session} />
                        <RecordLink tripId={trip.id} kind="media" id={asset.id}>
                          {asset.original_filename ?? m.owner_open_media_item()}
                        </RecordLink>
                      </div>
                    ) : null;
                  })}
                </div>
              )}
            </article>
          ))}
      </DetailList>
    </Section>
  );
}
