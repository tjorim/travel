import { onlineManager, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useMemo } from "react";

import { decodeSubject, readSession, type TrackerSession } from "../auth";
import { useAuth } from "../auth-context";
import type {
  Area, DocumentAsset, EmergencyInfoEntry, Visit, MediaAsset, MediaDerivative,
  OwnerDocument, Location, ProviderConnectionStatus, PublicProjectionStatus, ShareLink, Stay, Route, Trip, TravelUpdate, TripOverview, TripTask, TripTaskAlert,
} from "../tracker-model";
import { ApiError, ownerRequest, type OwnerRequest } from "./api";
import { ownerKeys, type DerivativeParent, type LibraryResource, type TripResource } from "./keys";

export type Owner = { session: TrackerSession; subject: string };

function ownerFromSession(session: TrackerSession | null): Owner | null {
  const subject = session ? decodeSubject(session.accessToken) : null;
  return session && subject ? { session, subject } : null;
}

/** The signed-in owner, or null when there is no session or its subject is unreadable. */
export function useOwner(): Owner | null {
  const { session } = useAuth();
  return useMemo(() => ownerFromSession(session), [session]);
}

/**
 * The signed-in owner read directly from storage, for use outside React (a
 * route `loader`, which runs before any component mounts).
 */
export function currentStoredOwner(): Owner | null {
  return ownerFromSession(readSession());
}

type TripResourceData = {
  stays: Stay[];
  "trip-tasks": TripTask[];
  "task-alerts": TripTaskAlert[];
  areas: Area[];
  locations: Location[];
  routes: Route[];
  visits: Visit[];
  documents: DocumentAsset[];
  media: MediaAsset[];
  "public-projection": PublicProjectionStatus;
  "share-links": ShareLink[];
  overview: TripOverview;
};

const resourceFailure: Record<TripResource, string> = {
  stays: "Je verblijven konden niet worden geladen.",
  "trip-tasks": "Je taken konden niet worden geladen.",
  "task-alerts": "Je meldingen konden niet worden geladen.",
  areas: "Je gebieden konden niet worden geladen.",
  locations: "Je locaties konden niet worden geladen.",
  "routes": "Je routes konden niet worden geladen.",
  visits: "Je bezoeken konden niet worden geladen.",
  documents: "Je documenten konden niet worden geladen.",
  media: "Je media konden niet worden geladen.",
  "public-projection": "De publieke publicatie kon niet worden geladen.",
  "share-links": "De deellinks konden niet worden geladen.",
  overview: "De controle voor het delen kon niet worden geladen.",
};

export const tripPath = (tripId: string, resource?: string) => `/api/trips/${encodeURIComponent(tripId)}${resource ? `/${resource}` : ""}`;

/** Query options shared by every hook and by `useQueries` callers. */
export function tripsQueryOptions(owner: Owner | null) {
  return {
    queryKey: ownerKeys.trips(owner?.subject ?? ""),
    enabled: owner !== null,
    queryFn: ({ signal }: { signal: AbortSignal }) => ownerRequest<Trip[]>(owner!.session, "/api/trips", "Je reizen konden niet worden geladen.", { signal }),
  };
}

export function tripResourceQueryOptions<R extends TripResource>(owner: Owner | null, tripId: string | null, resource: R) {
  return {
    queryKey: ownerKeys.tripResource(owner?.subject ?? "", tripId ?? "", resource),
    enabled: owner !== null && tripId !== null,
    queryFn: ({ signal }: { signal: AbortSignal }) => ownerRequest<TripResourceData[R]>(owner!.session, tripPath(tripId!, resource), resourceFailure[resource], { signal }),
  };
}

export function useTripsQuery() {
  return useQuery(tripsQueryOptions(useOwner()));
}

export function useTripResource<R extends TripResource>(tripId: string | null, resource: R) {
  return useQuery(tripResourceQueryOptions(useOwner(), tripId, resource));
}

/** Search requests share the owner cache and sit below their parent list key for write invalidation. */
function useOwnerSearch<T>(path: (query: string) => string, key: (subject: string, query: string) => readonly unknown[], fallback: string) {
  const owner = useOwner();
  const client = useQueryClient();
  return (query: string): Promise<T[]> => owner ? client.fetchQuery({
    queryKey: key(owner.subject, query),
    queryFn: ({ signal }) => ownerRequest<T[]>(owner.session, path(query), fallback, { signal }),
    staleTime: 30_000,
  }) : Promise.resolve([]);
}

const searchParams = (query: string) => `?${new URLSearchParams({ q: query.trim(), limit: "50" })}`;

export function useAreaSearch(tripId: string) {
  return useOwnerSearch<Area>((q) => tripPath(tripId, `areas${searchParams(q)}`), (subject, q) => [...ownerKeys.tripResource(subject, tripId, "areas"), "search", q], "Je gebieden konden niet worden doorzocht.");
}

export function useLocationSearch(tripId: string) {
  return useOwnerSearch<Location>((q) => tripPath(tripId, `locations${searchParams(q)}`), (subject, q) => [...ownerKeys.tripResource(subject, tripId, "locations"), "search", q], "Je locaties konden niet worden doorzocht.");
}

export function useTripSearch() {
  return useOwnerSearch<Trip>((q) => `/api/trips${searchParams(q)}`, (subject, q) => [...ownerKeys.trips(subject), "search", q], "Je reizen konden niet worden doorzocht.");
}

export function useTravelUpdateSearch(tripId: string) {
  return useOwnerSearch<TravelUpdate>((q) => tripPath(tripId, `travel-updates${searchParams(q)}`), (subject, q) => [...ownerKeys.trip(subject, tripId), "travel-updates", "search", q], "Je reisupdates konden niet worden doorzocht.");
}

type DerivativeData = { media: MediaDerivative[] };
const derivativeFailure: Record<DerivativeParent, string> = {
  media: "De afgeleiden konden niet worden geladen.",
};

/** The generated copies of one media asset; nothing is read until an asset is chosen. */
export function derivativesQueryOptions<K extends DerivativeParent>(owner: Owner | null, tripId: string | null, kind: K, assetId: string | null) {
  return {
    queryKey: ownerKeys.derivatives(owner?.subject ?? "", tripId ?? "", kind, assetId ?? ""),
    enabled: owner !== null && tripId !== null && assetId !== null,
    queryFn: ({ signal }: { signal: AbortSignal }) => ownerRequest<DerivativeData[K]>(owner!.session, `${tripPath(tripId!, kind)}/${encodeURIComponent(assetId!)}/derivatives`, derivativeFailure[kind], { signal }),
  };
}

export function useDerivatives<K extends DerivativeParent>(tripId: string | null, kind: K, assetId: string | null) {
  return useQuery(derivativesQueryOptions(useOwner(), tripId, kind, assetId));
}

type LibraryData = { documents: OwnerDocument[]; "emergency-info": EmergencyInfoEntry[] };
const libraryFailure: Record<LibraryResource, string> = {
  documents: "Je bibliotheek kon niet worden geladen.",
  "emergency-info": "Je noodinformatie kon niet worden geladen.",
};

export const libraryPath = (resource: LibraryResource) => `/api/library/${resource}`;

/** Owner-wide records that belong to no single trip. */
export function useLibrary<R extends LibraryResource>(resource: R) {
  const owner = useOwner();
  return useQuery({
    queryKey: ownerKeys.library(owner?.subject ?? "", resource),
    enabled: owner !== null,
    queryFn: ({ signal }: { signal: AbortSignal }) => ownerRequest<LibraryData[R]>(owner!.session, libraryPath(resource), libraryFailure[resource], { signal }),
  });
}

export function useLinkedLibraryDocuments(tripId: string | null) {
  const owner = useOwner();
  return useQuery({
    queryKey: ownerKeys.linkedLibraryDocuments(owner?.subject ?? "", tripId ?? ""),
    enabled: owner !== null && tripId !== null,
    queryFn: ({ signal }: { signal: AbortSignal }) => ownerRequest<OwnerDocument[]>(owner!.session, `${libraryPath("documents")}?linked_trip_id=${encodeURIComponent(tripId!)}`, "Gekoppelde bibliotheekdocumenten konden niet worden geladen.", { signal }),
  });
}

/** Which media providers are connected. Only the state is returned, never a token. */
export function useProviderConnections() {
  const owner = useOwner();
  return useQuery({
    queryKey: ownerKeys.providers(owner?.subject ?? ""),
    enabled: owner !== null,
    queryFn: ({ signal }: { signal: AbortSignal }) => ownerRequest<ProviderConnectionStatus[]>(owner!.session, "/api/provider-tokens", "De providerstatus kon niet worden geladen.", { signal }),
  });
}

type Invalidation = readonly QueryKey[];

type MutationSpec<V, R> = {
  fallback: string;
  /** A `FormData` body is sent as an upload. */
  request: (variables: V) => { path: string } & Pick<OwnerRequest, "method" | "body">;
  /** Queries a successful write makes stale; they are refetched before the write settles. */
  invalidate: (subject: string, variables: V, result: R) => Invalidation;
  /** A safe, reversible cache edit applied immediately and rolled back if the write fails. */
  optimistic?: { key: (subject: string, variables: V) => QueryKey; update: (current: never, variables: V) => unknown };
  /** How long a settled write stays in the mutation cache. Use 0 when its result is a secret or a one-off preview. */
  gcTime?: number;
};

/**
 * An owner write with shared pending/error state and targeted invalidation.
 * `mutateAsync` resolves only after the affected reads are fresh, so the UI
 * never shows the record as it was before the edit.
 */
export function useOwnerMutation<V, R = unknown>({ fallback, request, invalidate, optimistic, gcTime }: MutationSpec<V, R>) {
  const owner = useOwner();
  const client = useQueryClient();
  const refresh = (subject: string, variables: V, result: R) => Promise.all(invalidate(subject, variables, result).map((queryKey) => client.invalidateQueries({ queryKey })));
  return useMutation<R, Error, V, { key: QueryKey; previous: unknown } | undefined>({
    ...(gcTime === undefined ? {} : { gcTime }),
    mutationFn: (variables) => {
      if (!owner) throw new ApiError("Meld aan om je private reizen te wijzigen.", 401);
      const { path, ...options } = request(variables);
      return ownerRequest<R>(owner.session, path, fallback, options);
    },
    onMutate: async (variables) => {
      if (!optimistic || !owner) return undefined;
      const key = optimistic.key(owner.subject, variables);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData(key);
      if (previous !== undefined) client.setQueryData(key, optimistic.update(previous as never, variables));
      return { key, previous };
    },
    onSuccess: async (result, variables) => {
      if (!owner) return;
      const fresh = refresh(owner.subject, variables, result);
      // A read that went offline in the meantime waits for the connection; do not hold the write for it.
      if (onlineManager.isOnline()) await fresh;
    },
    onError: (_error, variables, context) => {
      if (context && context.previous !== undefined) client.setQueryData(context.key, context.previous);
      // Make sure the screen converges on the server's truth after a rejected write.
      if (owner && context) void refresh(owner.subject, variables, undefined as R);
    },
  });
}

/** Refreshes owner reads that other, not yet migrated screens have changed. */
export function useRefreshTrip() {
  const owner = useOwner();
  const client = useQueryClient();
  return {
    trips: () => owner ? client.invalidateQueries({ queryKey: ownerKeys.trips(owner.subject) }) : Promise.resolve(),
    /** Drops everything cached for a trip that no longer exists. */
    forget: (tripId: string) => { if (owner) client.removeQueries({ queryKey: ownerKeys.trip(owner.subject, tripId) }); },
    resources: (tripId: string, resources: readonly TripResource[]) => owner
      ? Promise.all(resources.map((resource) => client.invalidateQueries({ queryKey: ownerKeys.tripResource(owner.subject, tripId, resource) })))
      : Promise.resolve([]),
  };
}

export type MarkAlertRead = { tripId: string; alertId: string };

/** Marks a reminder read at once, restoring it if the server refuses. */
export function useMarkAlertRead() {
  return useOwnerMutation<MarkAlertRead, TripTaskAlert>({
    fallback: "De melding kon niet als gelezen worden gemarkeerd.",
    request: ({ tripId, alertId }) => ({ path: `${tripPath(tripId, "task-alerts")}/${encodeURIComponent(alertId)}/read`, method: "PATCH" }),
    invalidate: (subject, { tripId }) => [ownerKeys.tripResource(subject, tripId, "task-alerts")],
    optimistic: {
      key: (subject, { tripId }) => ownerKeys.tripResource(subject, tripId, "task-alerts"),
      update: (alerts: TripTaskAlert[], { alertId }) => alerts.map((alert) => alert.id === alertId ? { ...alert, read_at: new Date().toISOString() } : alert),
    },
  });
}
