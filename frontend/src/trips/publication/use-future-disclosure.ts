import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { m } from "../../paraglide/messages.js";
import { ownerRequest } from "../../query/api";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwner } from "../../query/owner-queries";
import type { FutureDisclosure, ShareScope } from "../../api-types";

/**
 * What a candidate scope would show of a trip that has not started yet: routes with exact times or a carrier, and
 * dates shown by day. The server renders the same scope the preview shows and counts it, so the preview's review and
 * the delivered fields cannot disagree. Nothing is stored.
 */
export function useFutureDisclosure(
  tripId: string,
  audience: { kind: "public" } | { kind: "link"; linkId: string | undefined },
  scope: ShareScope,
) {
  const owner = useOwner();
  const path =
    audience.kind === "public"
      ? tripPath(tripId, "public-projection/future-disclosure")
      : tripPath(
          tripId,
          `share-links/${encodeURIComponent(audience.linkId ?? "")}/future-disclosure`,
        );
  return useQuery({
    queryKey: [
      ...ownerKeys.trip(owner?.subject ?? "", tripId),
      "future-disclosure",
      audience,
      scope,
    ],
    enabled: owner !== null && (audience.kind === "public" || Boolean(audience.linkId)),
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
