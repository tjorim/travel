import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { m } from "../../paraglide/messages.js";
import { ownerRequest } from "../../query/api";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwner } from "../../query/owner-queries";
import { collectionsPath } from "../../sharing/collections";
import type { FutureDisclosure, ShareScope } from "../../api-types";

/** The audience a candidate scope is reviewed for: the public view, a hidden link or a collection member. */
export type FutureDisclosureAudience =
  | { kind: "public" }
  | { kind: "link"; linkId: string | undefined }
  | { kind: "member"; collectionId: string; memberId: string };

function futureDisclosurePath(tripId: string, audience: FutureDisclosureAudience): string {
  switch (audience.kind) {
    case "public":
      return tripPath(tripId, "public-projection/future-disclosure");
    case "link":
      return tripPath(
        tripId,
        `share-links/${encodeURIComponent(audience.linkId ?? "")}/future-disclosure`,
      );
    case "member":
      return `${collectionsPath}/${encodeURIComponent(audience.collectionId)}/members/${encodeURIComponent(audience.memberId)}/future-disclosure`;
  }
}

/**
 * What a candidate scope would show of a trip that has not started yet: routes with exact times or a carrier, and
 * dates shown by day. The server renders the same scope the preview shows and counts it, so the preview's review and
 * the delivered fields cannot disagree. Nothing is stored.
 */
export function useFutureDisclosure(
  tripId: string,
  audience: FutureDisclosureAudience,
  scope: ShareScope,
) {
  const owner = useOwner();
  const path = futureDisclosurePath(tripId, audience);
  return useQuery({
    queryKey: [
      ...ownerKeys.trip(owner?.subject ?? "", tripId),
      "future-disclosure",
      audience,
      scope,
    ],
    enabled: owner !== null && (audience.kind !== "link" || Boolean(audience.linkId)),
    // Keep the previous answer on screen while a changed candidate is counted, so the review does not flicker.
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      ownerRequest<FutureDisclosure>(owner!.session, path, m.exclusions_error, {
        method: "POST",
        body: scope,
        signal,
      }),
  });
}
