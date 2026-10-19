import type { ErrorFallback } from "../query/api";
import { tripPath, useOwnerMutation } from "../query/owner-queries";

/**
 * The save (create with POST, update with PATCH) and delete calls the trip's record editors share.
 * Only the resource, the failure messages and the reads to refresh differ between them.
 */
export function useTripRecordMutations<T extends { id: string }>(
  tripId: string,
  resource: string,
  {
    saveFailed,
    deleteFailed,
    invalidate,
  }: {
    saveFailed: ErrorFallback;
    deleteFailed: ErrorFallback;
    /** The reads that go stale when a record changes. */
    invalidate: (subject: string) => (readonly unknown[])[];
  },
) {
  const path = tripPath(tripId, resource);
  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, T>({
    fallback: saveFailed,
    request: ({ id, payload }) => ({
      path: id ? `${path}/${id}` : path,
      method: id ? "PATCH" : "POST",
      body: payload,
    }),
    invalidate,
  });
  const remove = useOwnerMutation<T>({
    fallback: deleteFailed,
    request: (record) => ({ path: `${path}/${record.id}`, method: "DELETE" }),
    invalidate,
  });
  return { save, remove };
}
