import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { m } from "../../paraglide/messages.js";
import { ownerRequest } from "../../query/api";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwner } from "../../query/owner-queries";
import type { ExclusionReview, ShareScope } from "../../tracker-model";

/**
 * What a hidden link or collection member would leave out of the public baseline, from the server: the records an
 * audience may exclude, each exclusion with the records it also hides, and how many stored entries no longer apply.
 * It is the one source for those counts, so the editor never recomputes the cascade on the client. Nothing is stored.
 */
export function useExclusionReview(tripId: string, scope: ShareScope) {
  const owner = useOwner();
  const body = {
    exclude: (scope.exclude ?? []).map(({ kind, id }) => ({ kind, id })),
    items: scope.items.map(({ kind, id }) => ({ kind, id })),
  };
  return useQuery({
    queryKey: [...ownerKeys.trip(owner?.subject ?? "", tripId), "exclusion-review", body],
    enabled: owner !== null,
    // Keep the previous answer on screen while a changed selection is reviewed, so the list does not flicker.
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      ownerRequest<ExclusionReview>(
        owner!.session,
        tripPath(tripId, "share-scope/exclusion-review"),
        m.exclusions_error,
        { method: "POST", body, signal },
      ),
  });
}
