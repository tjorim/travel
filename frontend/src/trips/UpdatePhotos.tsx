import { useQueries } from "@tanstack/react-query";
import { VideoIcon } from "lucide-react";
import { useMemo } from "react";

import type { TrackerSession } from "../auth";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { derivativesQueryOptions, useOwner, useTripResource } from "../query/owner-queries";
import type { MediaDerivative, TravelUpdate, Trip } from "../tracker-model";
import { OwnerImage } from "./OwnerImage";

/** How many thumbnails a row shows before the rest become a count. */
export const STRIP_LIMIT = 4;

/** One photo or video of a travel update, as the owner can load it: an owner-only copy, never a visitor file. */
export type UpdatePhoto = {
  assetId: string;
  /** The authenticated owner route of the photo's thumbnail (or a video's poster); null when it has none. */
  url: string | null;
  /** What the owner wrote for this photo on the update, if anything. */
  alt: string | null;
  video: boolean;
};

const EMPTY: Map<string, UpdatePhoto[]> = new Map();

/** The plain-text label the owner gave a copy on the update: its alt text, else its caption. */
const copyLabel = (copy: MediaDerivative) => copy.alt_text?.trim() || copy.caption?.trim() || null;

/**
 * Each travel update's photos: the media attached to it and the copies prepared for it, in that order,
 * found through the owner's own media list and copies. Nothing here is published or fetched from a visitor route.
 */
export function useUpdatePhotos(trip: Trip): Map<string, UpdatePhoto[]> {
  const owner = useOwner();
  const media = useTripResource(trip.id, "media").data;
  const copies = useQueries({
    queries: (media ?? []).map((asset) =>
      derivativesQueryOptions(owner, trip.id, "media", asset.id),
    ),
    combine: (results) => results.map((result) => result.data),
  });
  return useMemo(() => {
    if (!media || trip.travel_updates.length === 0) return EMPTY;
    const assets = new Map(media.map((asset) => [asset.id, asset]));
    const byUpdate = new Map<string, UpdatePhoto[]>();
    for (const update of trip.travel_updates) {
      const linked = new Map<string, MediaDerivative[]>();
      media.forEach((asset, index) => {
        const own = (copies[index] ?? []).filter((copy) => copy.travel_update_id === update.id);
        if (own.length) linked.set(asset.id, own);
      });
      const ids = [...new Set([...update.media_asset_ids, ...linked.keys()])];
      const photos = ids.flatMap((id): UpdatePhoto[] => {
        const asset = assets.get(id);
        if (!asset) return [];
        const own = linked.get(id) ?? [];
        const video = asset.media_kind === "video";
        return [
          {
            assetId: id,
            url:
              asset.thumbnail_url ??
              (video ? (own.find((copy) => copy.poster_url)?.poster_url ?? null) : null),
            alt: own.map(copyLabel).find(Boolean) ?? null,
            video,
          },
        ];
      });
      if (photos.length) byUpdate.set(update.id, photos);
    }
    return byUpdate;
  }, [media, copies, trip.travel_updates]);
}

const tile = "block size-12 shrink-0 sm:size-14 rounded-lg bg-travel-media-bg object-cover";

/** A small strip of an update's photos, then how many more there are. Every tile keeps its size while loading. */
export function UpdatePhotoStrip({
  update,
  photos,
  session,
}: {
  update: Pick<TravelUpdate, "title">;
  photos: UpdatePhoto[];
  session: TrackerSession;
}) {
  useLocale();
  if (photos.length === 0) return null;
  const shown = photos.slice(0, STRIP_LIMIT);
  const more = photos.length - shown.length;
  return (
    <ul
      className="col-span-full m-0 flex list-none flex-wrap gap-1.5 p-0"
      aria-label={m.owner_photos_of_update({ p0: update.title })}
    >
      {shown.map((photo) => {
        const alt = photo.alt ?? m.owner_update_photo_alt({ p0: update.title });
        return (
          <li key={photo.assetId} className="flex">
            {photo.url ? (
              <OwnerImage session={session} url={photo.url} alt={alt} className={tile} lazy />
            ) : (
              <span
                role="img"
                aria-label={alt}
                className={`${tile} grid place-items-center text-travel-muted`}
              >
                {photo.video && <VideoIcon aria-hidden="true" />}
              </span>
            )}
          </li>
        );
      })}
      {more > 0 && (
        <li className="grid size-12 place-items-center sm:size-14 rounded-lg border border-travel-card-border text-sm font-bold text-travel-muted">
          <span className="sr-only">{m.owner_more_photos_of_update({ count: more })}</span>
          <span aria-hidden="true">+{more}</span>
        </li>
      )}
    </ul>
  );
}
