import { onlineManager, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useMemo } from "react";

import { decodeSubject, type TrackerSession } from "../auth";
import { useAuth } from "../auth-context";
import type { BroadPlace, Stay, TransportLeg, Trip, TripTask, TripTaskAlert } from "../tracker-model";
import { ApiError, ownerRequest, type OwnerRequest } from "./api";
import { ownerKeys, type TripResource } from "./keys";

export type Owner = { session: TrackerSession; subject: string };

/** The signed-in owner, or null when there is no session or its subject is unreadable. */
export function useOwner(): Owner | null {
  const { session } = useAuth();
  return useMemo(() => {
    const subject = session ? decodeSubject(session.accessToken) : null;
    return session && subject ? { session, subject } : null;
  }, [session]);
}

type TripResourceData = {
  stays: Stay[];
  "transport-legs": TransportLeg[];
  "trip-tasks": TripTask[];
  "task-alerts": TripTaskAlert[];
  "places/broad": BroadPlace[];
};

const resourceFailure: Record<TripResource, string> = {
  stays: "Je verblijven konden niet worden geladen.",
  "transport-legs": "Je vervoer kon niet worden geladen.",
  "trip-tasks": "Je taken konden niet worden geladen.",
  "task-alerts": "Je meldingen konden niet worden geladen.",
  "places/broad": "De brede plaatsen konden niet worden geladen.",
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

type Invalidation = readonly QueryKey[];

type MutationSpec<V, R> = {
  fallback: string;
  request: (variables: V) => { path: string } & Pick<OwnerRequest, "method" | "body">;
  /** Queries a successful write makes stale; they are refetched before the write settles. */
  invalidate: (subject: string, variables: V, result: R) => Invalidation;
  /** A safe, reversible cache edit applied immediately and rolled back if the write fails. */
  optimistic?: { key: (subject: string, variables: V) => QueryKey; update: (current: never, variables: V) => unknown };
};

/**
 * An owner write with shared pending/error state and targeted invalidation.
 * `mutateAsync` resolves only after the affected reads are fresh, so the UI
 * never shows the record as it was before the edit.
 */
export function useOwnerMutation<V, R = unknown>({ fallback, request, invalidate, optimistic }: MutationSpec<V, R>) {
  const owner = useOwner();
  const client = useQueryClient();
  const refresh = (subject: string, variables: V, result: R) => Promise.all(invalidate(subject, variables, result).map((queryKey) => client.invalidateQueries({ queryKey })));
  return useMutation<R, Error, V, { key: QueryKey; previous: unknown } | undefined>({
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
