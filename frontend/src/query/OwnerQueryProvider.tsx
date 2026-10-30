import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import { decodeSubject } from "../auth";
import { useAuth } from "../auth-context";
import { createOwnerQueryClient } from "./client";

// Diagnostics are opt-in and exist only in the dev server (`VITE_QUERY_DEVTOOLS=1`):
// the panel lists cached owner records, so it is off by default. The dynamic
// import is behind a build-time constant, so no devtools code ships in production.
const Devtools =
  import.meta.env.DEV && import.meta.env.VITE_QUERY_DEVTOOLS === "1"
    ? lazy(() =>
        import("@tanstack/react-query-devtools").then((module) => ({
          default: module.ReactQueryDevtools,
        })),
      )
    : null;

/**
 * Owner-only query cache. It lives in memory (never persisted) and is scoped
 * to the signed-in subject: sign-out, or a different subject discard it.
 * The visitor routes never mount this provider.
 */
export function OwnerQueryProvider({
  children,
  client,
}: {
  children: ReactNode;
  client?: QueryClient;
}) {
  const { session } = useAuth();
  const [queryClient] = useState(() => client ?? createOwnerQueryClient());
  const subject = session ? decodeSubject(session.accessToken) : null;

  useEffect(() => {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] === "owner" && query.queryKey[1] !== subject,
    });
  }, [queryClient, subject]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {Devtools && (
        <Suspense fallback={null}>
          <Devtools initialIsOpen={false} buttonPosition="bottom-left" />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}
