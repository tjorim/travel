import { m } from "../../paraglide/messages.js";
import { ApiError } from "../../query/api";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwnerMutation } from "../../query/owner-queries";
import type {
  PresetApplyResult,
  PublicProjectionStatus,
  ShareLink,
  SharingPresetId,
  SharingPresetReview,
} from "../../api-types";
import type { CollectionMember } from "../../sharing/collections";

/** The audience a preset is reviewed for and applied to: the public view, a saved hidden link or a collection member. */
export type PresetTarget =
  | { kind: "public" }
  | { kind: "link"; linkId: string }
  | { kind: "member"; collectionId: string; memberId: string };

/** What an apply answers with, whichever audience it was for. The caller knows which one it asked about. */
export type PresetAppliedAudience = PublicProjectionStatus | ShareLink | CollectionMember;

export const PRESET_IDS: readonly SharingPresetId[] = [
  "story_only",
  "story_and_route",
  "planned_trip",
];

export const PRESET_NAMES: Record<SharingPresetId, () => string> = {
  story_only: () => m.preset_story_only(),
  story_and_route: () => m.preset_story_and_route(),
  planned_trip: () => m.preset_planned_trip(),
};

export const PRESET_DESCRIPTIONS: Record<SharingPresetId, () => string> = {
  story_only: () => m.preset_story_only_help(),
  story_and_route: () => m.preset_story_and_route_help(),
  planned_trip: () => m.preset_planned_trip_help(),
};

/** The label of a stored preset id; an id a newer application wrote is shown as it is rather than hidden. */
export function presetName(id: string): string {
  return (PRESET_NAMES as Record<string, (() => string) | undefined>)[id]?.() ?? id;
}

const presetPath = (tripId: string, target: PresetTarget) =>
  target.kind === "public"
    ? tripPath(tripId, "public-projection/preset")
    : target.kind === "link"
      ? tripPath(tripId, `share-links/${encodeURIComponent(target.linkId)}/preset`)
      : `/api/collections/${encodeURIComponent(target.collectionId)}/members/${encodeURIComponent(target.memberId)}/preset`;

/** The structured detail of a refused preset call, if that is what the error is. */
export function presetRefusal<T extends { code: string }>(
  error: unknown,
  status: number,
  code: string,
): T | null {
  if (!(error instanceof ApiError) || error.status !== status) return null;
  const detail = error.diagnostic as { code?: string } | undefined;
  return detail?.code === code ? (detail as T) : null;
}

/**
 * Reviewing (nothing is stored) and applying a sharing preset. An apply writes records, scopes and the audit trail, so
 * it refreshes everything on the trip and the owner's collections.
 */
export function usePresetMutations(tripId: string) {
  const review = useOwnerMutation<
    { target: PresetTarget; preset: SharingPresetId },
    SharingPresetReview
  >({
    fallback: m.preset_review_failed,
    request: ({ target, preset }) => ({
      path: `${presetPath(tripId, target)}/review`,
      method: "POST",
      body: { preset },
    }),
    invalidate: () => [],
    gcTime: 0,
  });
  const apply = useOwnerMutation<
    {
      target: PresetTarget;
      preset: SharingPresetId;
      fingerprint: string;
      confirmWidening: boolean;
      revision: number;
    },
    PresetApplyResult<PresetAppliedAudience>
  >({
    fallback: m.preset_apply_failed,
    request: ({ target, preset, fingerprint, confirmWidening, revision }) => ({
      path: presetPath(tripId, target),
      method: "POST",
      body: { preset, fingerprint, confirm_widening: confirmWidening },
      headers: { "If-Match": `"${revision}"` },
    }),
    // Promoted records change their own visibility, which the trip list carries, and every scope and audit read.
    invalidate: (subject) => [
      ownerKeys.trip(subject, tripId),
      ownerKeys.trips(subject),
      ownerKeys.collections(subject),
    ],
    gcTime: 0,
  });
  return { review, apply };
}
