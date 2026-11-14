import { Button } from "@/ui/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { bytesLabel } from "../../files";
import { formatCapture } from "../../dates";
import { type MediaAsset, type Trip } from "../../api-types";
import { MEDIA_KIND_LABELS } from "../labels";
import { MediaPreview, RecordHeading, Section, type OwnerSession } from "./shared";
import { DetailList } from "./DetailList";

export function MediaBlock({
  trip,
  media,
  session,
  openFile,
}: {
  trip: Trip;
  media: MediaAsset[];
  session: OwnerSession | null;
  openFile: (url: string, fallback: string) => void;
}) {
  useLocale();
  return (
    <Section id="media" title={m.common_private_media()}>
      <DetailList empty={media.length === 0} message={m.media_no_private_media_captured()}>
        {media.map((asset) => (
          <article key={asset.id}>
            <RecordHeading tripId={trip.id} kind="media" id={asset.id}>
              {asset.original_filename ?? m.media_unnamed_item_title()}
            </RecordHeading>
            {session && <MediaPreview asset={asset} session={session} />}
            <p>
              {m.media_captured_line({
                kind: MEDIA_KIND_LABELS[asset.media_kind],
                size: bytesLabel(asset.byte_size),
                time: asset.captured_at
                  ? formatCapture(asset.captured_at, asset.captured_local)
                  : "—",
              })}
            </p>
            {asset.gps && (
              <p>
                {m.media_gps()} {asset.gps.latitude}, {asset.gps.longitude}
              </p>
            )}
            <Button
              className="secondary compact"
              type="button"
              onClick={() =>
                openFile(asset.file_url, m.media_the_private_media_could_not_be_opened())
              }
            >
              {m.media_open_media()}
            </Button>
          </article>
        ))}
      </DetailList>
    </Section>
  );
}
