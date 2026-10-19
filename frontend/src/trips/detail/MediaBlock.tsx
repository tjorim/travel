import { Button } from "@base-ui/react/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { bytesLabel, formatCapture, type MediaAsset, type Trip } from "../../tracker-model";
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
    <Section id="media" title={m.owner_private_media()}>
      <DetailList empty={media.length === 0} message={m.owner_no_private_media_captured()}>
        {media.map((asset) => (
          <article key={asset.id}>
            <RecordHeading tripId={trip.id} kind="media" id={asset.id}>
              {asset.original_filename ?? m.owner_unnamed_media_item()}
            </RecordHeading>
            {session && <MediaPreview asset={asset} session={session} />}
            <p>
              {MEDIA_KIND_LABELS[asset.media_kind]} · {bytesLabel(asset.byte_size)}{" "}
              {m.owner_captured()}{" "}
              {asset.captured_at ? formatCapture(asset.captured_at, asset.captured_local) : "—"}
            </p>
            {asset.gps && (
              <p>
                {m.owner_gps()} {asset.gps.latitude}, {asset.gps.longitude}
              </p>
            )}
            <Button
              className="secondary compact"
              type="button"
              onClick={() =>
                openFile(asset.file_url, m.owner_the_private_media_could_not_be_opened())
              }
            >
              {m.owner_open_media()}
            </Button>
          </article>
        ))}
      </DetailList>
    </Section>
  );
}
