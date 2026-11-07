import { m } from "../../paraglide/messages.js";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../../query/owner-queries";
import type { AlternativeChoice, AlternativeGroup, AlternativeKind } from "../../tracker-model";

const records = { stay: "stays", visit: "visits", route: "routes" } as const;

/** The stored groups of a trip and the suggestions made from its loose ideas. */
export function useAlternativeQueries(tripId: string) {
  const groups = useTripResource(tripId, "alternative-groups");
  const suggestions = useTripResource(tripId, "alternative-groups/suggestions");
  return { groups, suggestions };
}

/** The owner API calls behind the alternatives panel. */
export function useAlternativeMutations(tripId: string, kind: AlternativeKind) {
  const path = tripPath(tripId, "alternative-groups");
  // A choice changes the statuses of the records, which the sharing check and the audit trail also read.
  const invalidate = (subject: string) => [
    ownerKeys.tripResource(subject, tripId, "alternative-groups"),
    ownerKeys.tripResource(subject, tripId, "alternative-groups/suggestions"),
    ownerKeys.tripResource(subject, tripId, records[kind]),
    ownerKeys.tripResource(subject, tripId, "overview"),
    [...ownerKeys.trip(subject, tripId), "audit-events"],
  ];
  const create = useOwnerMutation<{ memberIds: string[]; label?: string | null }, AlternativeGroup>(
    {
      fallback: m.owner_the_alternatives_could_not_be_saved,
      request: ({ memberIds, label }) => ({
        path,
        method: "POST",
        body: { kind, member_ids: memberIds, label: label || null },
      }),
      invalidate,
    },
  );
  const update = useOwnerMutation<
    { id: string; add: string[]; remove: string[] },
    AlternativeGroup
  >({
    fallback: m.owner_the_alternatives_could_not_be_saved,
    request: ({ id, add, remove }) => ({
      path: `${path}/${id}`,
      method: "PATCH",
      body: { add_member_ids: add, remove_member_ids: remove },
    }),
    invalidate,
  });
  const dissolve = useOwnerMutation<AlternativeGroup>({
    fallback: m.owner_the_group_could_not_be_dissolved,
    request: (group) => ({ path: `${path}/${group.id}`, method: "DELETE" }),
    invalidate,
  });
  const choose = useOwnerMutation<
    { id: string; memberId: string; others: "cancel" | "remove" },
    AlternativeChoice
  >({
    fallback: m.owner_the_choice_could_not_be_made,
    request: ({ id, memberId, others }) => ({
      path: `${path}/${id}/choose`,
      method: "POST",
      body: { member_id: memberId, others },
    }),
    invalidate,
  });
  const undo = useOwnerMutation<{ id: string; eventId: string }, AlternativeGroup>({
    fallback: m.owner_the_choice_could_not_be_undone,
    request: ({ id, eventId }) => ({
      path: `${path}/${id}/undo-choice`,
      method: "POST",
      body: { event_id: eventId },
    }),
    invalidate,
  });
  return { create, update, dissolve, choose, undo };
}
