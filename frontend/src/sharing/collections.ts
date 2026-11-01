import { useQuery } from "@tanstack/react-query";

import { m } from "../paraglide/messages.js";
import { ownerRequest } from "../query/api";
import { ownerKeys } from "../query/keys";
import { useOwner, useOwnerMutation, type Owner } from "../query/owner-queries";
import type { ProjectionDocument, ShareLink, ShareScope } from "../tracker-model";

export type CollectionMember = {
  revision: number;
  id: string;
  trip_id: string;
  /** Owner-only: the trip's own title, whatever the member scope shares. */
  trip_title: string;
  scope: ShareScope;
  /** How many records this member delivers today; 0 means a visitor sees at most the trip header. */
  delivered_records: number;
  created_at: string;
  updated_at: string;
};

export type Collection = {
  id: string;
  label: string;
  title: string | null;
  state: ShareLink["state"];
  token: string | null;
  expires_at: string | null;
  rotations: number;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  revoked_at: string | null;
  members: CollectionMember[];
};

export const collectionsPath = "/api/collections";

export function collectionsQueryOptions(owner: Owner | null) {
  return {
    queryKey: ownerKeys.collections(owner?.subject ?? ""),
    enabled: owner !== null,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      ownerRequest<Collection[]>(
        owner!.session,
        collectionsPath,
        m.sharing_collections_load_error,
        { signal },
      ),
  };
}

export function useCollections() {
  return useQuery(collectionsQueryOptions(useOwner()));
}

export function collectionUrl(token: string): string {
  return new URL(`/share/${encodeURIComponent(token)}`, window.location.origin).toString();
}

/** The most recent thing that happened to a collection or link, for "last change". */
export function lastChange(item: {
  created_at: string;
  activated_at: string | null;
  revoked_at: string | null;
  updated_at?: string;
}): string {
  return [item.created_at, item.activated_at, item.revoked_at, item.updated_at]
    .filter((value): value is string => Boolean(value))
    .reduce((latest, value) => (value > latest ? value : latest));
}

export type CollectionAction = {
  collection: Collection;
  action: "activate" | "rotate";
  expiresInDays: number | null;
  reason: string | null;
};

/** The owner API calls behind collection links. */
export function useCollectionMutations() {
  const refresh = (subject: string) => [ownerKeys.collections(subject)];
  const save = m.sharing_collection_save_error;
  const act = m.sharing_collection_action_error;

  const create = useOwnerMutation<{ label: string; title: string | null }, Collection>({
    fallback: save,
    request: (body) => ({ path: collectionsPath, method: "POST", body }),
    invalidate: refresh,
  });
  const update = useOwnerMutation<{ id: string; label: string; title: string | null }, Collection>({
    fallback: save,
    request: ({ id, ...body }) => ({ path: `${collectionsPath}/${id}`, method: "PATCH", body }),
    invalidate: refresh,
  });
  const remove = useOwnerMutation<{ id: string }, void>({
    fallback: act,
    request: ({ id }) => ({ path: `${collectionsPath}/${id}`, method: "DELETE" }),
    invalidate: refresh,
  });
  const addMember = useOwnerMutation<
    { collectionId: string; tripId: string; scope: ShareScope },
    Collection
  >({
    fallback: save,
    request: ({ collectionId, tripId, scope }) => ({
      path: `${collectionsPath}/${collectionId}/members`,
      method: "POST",
      body: { trip_id: tripId, scope },
    }),
    invalidate: refresh,
  });
  const setMemberScope = useOwnerMutation<
    { collectionId: string; member: CollectionMember; scope: ShareScope },
    Collection
  >({
    fallback: save,
    request: ({ collectionId, member, scope }) => ({
      path: `${collectionsPath}/${collectionId}/members/${member.id}`,
      method: "PUT",
      body: scope,
      headers: { "If-Match": `"${member.revision}"` },
    }),
    invalidate: refresh,
  });
  const removeMember = useOwnerMutation<{ collectionId: string; memberId: string }, Collection>({
    fallback: act,
    request: ({ collectionId, memberId }) => ({
      path: `${collectionsPath}/${collectionId}/members/${memberId}`,
      method: "DELETE",
    }),
    invalidate: refresh,
  });
  const previewMember = useOwnerMutation<
    { collectionId: string; memberId: string; scope: ShareScope },
    ProjectionDocument
  >({
    fallback: m.assets_the_link_preview_could_not_be_loaded,
    // The unsaved candidate scope is rendered and never stored.
    request: ({ collectionId, memberId, scope }) => ({
      path: `${collectionsPath}/${collectionId}/members/${memberId}/preview`,
      method: "POST",
      body: scope,
    }),
    invalidate: () => [],
    gcTime: 0,
  });
  // The owner-managed URL stays in the owner-only in-memory cache; the PWA never persists it locally.
  const activate = useOwnerMutation<CollectionAction, Collection>({
    fallback: m.assets_the_secure_link_could_not_be_created,
    request: ({ collection, action, expiresInDays, reason }) => ({
      path: `${collectionsPath}/${collection.id}/${action}`,
      method: "POST",
      body: { expires_in_days: expiresInDays, reason },
    }),
    invalidate: refresh,
    gcTime: 0,
  });
  const revoke = useOwnerMutation<{ collection: Collection; reason: string | null }, Collection>({
    fallback: m.assets_the_link_could_not_be_revoked,
    request: ({ collection, reason }) => ({
      path: `${collectionsPath}/${collection.id}/revoke`,
      method: "POST",
      body: { reason },
    }),
    invalidate: refresh,
  });

  return {
    create,
    update,
    remove,
    addMember,
    setMemberScope,
    removeMember,
    previewMember,
    activate,
    revoke,
  };
}
