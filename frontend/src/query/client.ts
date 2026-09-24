import { MutationCache, onlineManager, QueryCache, QueryClient } from "@tanstack/react-query";

import { ApiError } from "./api";

const MAX_QUERY_RETRIES = 2;

/**
 * Retry only what can succeed later. A rejected request (4xx) is final, and an
 * offline read waits for the connection instead of burning retries.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && (error.permanent || error.offline)) return false;
  return failureCount < MAX_QUERY_RETRIES;
}

/**
 * Builds the owner QueryClient.
 * - Reads pause while offline and resume on reconnect (`networkMode: "online"`).
 * - Writes always attempt the network so an offline owner gets an immediate,
 *   explicit error instead of a save that silently waits (`"always"`), and are
 *   never retried: a write is not safe to repeat blindly.
 * - A 401 from any call reports once so the app can end the session.
 */
export function createOwnerQueryClient({ onUnauthorized }: { onUnauthorized?: () => void } = {}): QueryClient {
  // The manager only learns of changes after load; start from the browser's current state.
  if (typeof navigator !== "undefined") onlineManager.setOnline(navigator.onLine);
  const report = (error: unknown) => { if (error instanceof ApiError && error.unauthorized) onUnauthorized?.(); };
  return new QueryClient({
    queryCache: new QueryCache({ onError: report }),
    mutationCache: new MutationCache({ onError: report }),
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: shouldRetryQuery, refetchOnWindowFocus: false, networkMode: "online" },
      mutations: { retry: false, networkMode: "always" },
    },
  });
}
