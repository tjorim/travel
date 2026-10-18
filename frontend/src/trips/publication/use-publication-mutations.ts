import { m } from "../../paraglide/messages.js";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwnerMutation } from "../../query/owner-queries";
import type {
  ProjectionDocument,
  PublicProjectionStatus,
  ShareLink,
  ShareScope,
} from "../../tracker-model";

export type LinkAction = {
  link: ShareLink;
  action: "activate" | "rotate";
  expiresInDays: number | null;
  reason: string | null;
};

/** The owner API calls behind publishing: the public scope, previews, and the hidden share links' lifecycle. */
export function usePublicationMutations(tripId: string) {
  const path = tripPath(tripId, "public-projection");
  const linksPath = tripPath(tripId, "share-links");
  const refreshStatus = (subject: string) => [
    ownerKeys.tripResource(subject, tripId, "public-projection"),
    ownerKeys.tripResource(subject, tripId, "overview"),
  ];
  const refreshLinks = (subject: string) => [
    ownerKeys.tripResource(subject, tripId, "share-links"),
    ownerKeys.tripResource(subject, tripId, "overview"),
  ];

  const savePublic = useOwnerMutation<ShareScope, PublicProjectionStatus>({
    fallback: m.assets_the_public_scope_could_not_be_saved,
    request: (scope) => ({ path, method: "PUT", body: scope }),
    invalidate: refreshStatus,
  });
  const previewPublicScope = useOwnerMutation<void, ProjectionDocument>({
    fallback: m.assets_the_public_preview_could_not_be_loaded,
    request: () => ({ path: `${path}/preview`, method: "POST" }),
    invalidate: () => [],
    // A preview is shown once and not kept.
    gcTime: 0,
  });
  const togglePublic = useOwnerMutation<
    { publish: boolean; reason: string | null },
    PublicProjectionStatus
  >({
    fallback: m.assets_the_publication_status_could_not_be_changed,
    request: ({ publish, reason: why }) => ({
      path: `${path}/${publish ? "publish" : "unpublish"}`,
      method: "POST",
      ...(!publish && why ? { body: { reason: why } } : {}),
    }),
    invalidate: (subject) => [...refreshStatus(subject), ownerKeys.trips(subject)],
  });
  const saveLink = useOwnerMutation<
    { id: string | null; label: string; scope: ShareScope },
    ShareLink
  >({
    fallback: m.assets_the_share_link_could_not_be_saved,
    request: ({ id, label, scope }) => ({
      path: id ? `${linksPath}/${id}` : linksPath,
      method: id ? "PATCH" : "POST",
      body: { label, scope },
    }),
    invalidate: refreshLinks,
  });
  const previewLinkScope = useOwnerMutation<ShareLink, ProjectionDocument>({
    fallback: m.assets_the_link_preview_could_not_be_loaded,
    request: (link) => ({ path: `${linksPath}/${link.id}/preview`, method: "POST" }),
    invalidate: () => [],
    gcTime: 0,
  });
  // The owner-managed URL remains in the owner-only in-memory cache; the PWA
  // never persists it locally.
  const activate = useOwnerMutation<LinkAction, ShareLink>({
    fallback: m.assets_the_secure_link_could_not_be_created,
    request: ({ link, action, expiresInDays: days, reason: why }) => ({
      path: `${linksPath}/${link.id}/${action}`,
      method: "POST",
      body: { expires_in_days: days, reason: why },
    }),
    invalidate: refreshLinks,
    gcTime: 0,
  });
  const revoke = useOwnerMutation<{ link: ShareLink; reason: string | null }, ShareLink>({
    fallback: m.assets_the_link_could_not_be_revoked,
    request: ({ link, reason: why }) => ({
      path: `${linksPath}/${link.id}/revoke`,
      method: "POST",
      body: { reason: why },
    }),
    invalidate: refreshLinks,
  });

  return {
    savePublic,
    previewPublicScope,
    togglePublic,
    saveLink,
    previewLinkScope,
    activate,
    revoke,
  };
}
