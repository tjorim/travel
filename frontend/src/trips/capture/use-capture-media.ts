import { useMemo } from "react";

import { m } from "../../paraglide/messages.js";
import { errorMessage } from "../../query/api";
import { useTripResource } from "../../query/owner-queries";
import type { MediaAsset } from "../../tracker-model";

/** The trip's photos that can be linked, the linked ones among them and the status line above the list. */
export function useCaptureMedia(tripId: string | null, open: boolean, selectedIds: string[]) {
  // The dialog stays mounted (closed) over its workspace, so media is only fetched once it is actually open.
  const mediaQuery = useTripResource(open && tripId ? tripId : null, "media");
  const media = useMemo(
    () => (mediaQuery.data ?? []).filter((asset) => asset.media_kind === "photo"),
    [mediaQuery.data],
  );
  const attachedMedia = useMemo(
    () =>
      selectedIds
        .map((id) => media.find((asset) => asset.id === id))
        .filter((asset): asset is MediaAsset => Boolean(asset)),
    [selectedIds, media],
  );
  const mediaState = !tripId
    ? ""
    : mediaQuery.error
      ? errorMessage(mediaQuery.error, m.owner_your_media_could_not_be_loaded)
      : mediaQuery.isPending
        ? m.owner_loading_media()
        : mediaQuery.data?.length
          ? m.owner_choose_private_photos_to_link_to_this_travel_update()
          : m.owner_no_photos_in_this_trip_yet();
  return { media, attachedMedia, mediaState };
}
