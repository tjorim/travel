import type { QueryClient } from "@tanstack/react-query";
import type { FC } from "react";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  type AnyRoute,
} from "@tanstack/react-router";

import { Boundary } from "./Boundary";
import { currentStoredOwner, tripsQueryOptions } from "./query/owner-queries";
import { parseFlagParam } from "./router/search-params";

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** Set by "Toon op kaart" so the trip overview's map can focus that point on arrival. */
    mapFocus?: string;
    /** A serializable message code evaluated by the destination in its current locale. */
    notice?: "trip_deleted";
    /** Set by the private overview so the matching manager opens that record's dialog on arrival. */
    openRecord?: {
      kind: "stay" | "route" | "visit" | "area" | "location" | "task" | "update" | "document" | "media";
      id: string;
    };
  }
}

// Typed router context, not a React context: it carries the single QueryClient
// instance (created in App.tsx, wrapped there in the matching QueryClientProvider)
// that a route's `loader` prefetches into, so it warms the same cache the page's
// own `useQuery` reads from.
export const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
});

export const callbackRoute = createRoute({ getParentRoute: () => rootRoute, path: "auth/callback" });

export const trackerLayoutRoute = createRoute({
  id: "tracker-layout",
  getParentRoute: () => rootRoute,
  component: () => (
    <Boundary>
      <Outlet />
    </Boundary>
  ),
});

export const homeRoute = createRoute({ getParentRoute: () => trackerLayoutRoute, path: "/" });
export const tripsRoute = createRoute({
  getParentRoute: () => trackerLayoutRoute,
  path: "trips",
  validateSearch: (search: Record<string, unknown>): { new?: "1" } => ({ new: parseFlagParam(search.new) }),
  loader: async ({ context }) => {
    // Best-effort prefetch only, mirroring the pattern in tjorim/champagnefestival's
    // venue-plan loader: no signed-in owner (yet), or the prefetch itself fails, and
    // this just skips warming the cache — Trips' own useTripsQuery (the exact same
    // queryOptions) still runs normally and is the sole owner of loading/error UX.
    const owner = currentStoredOwner();
    if (!owner) return;
    try {
      await context.queryClient.ensureQueryData(tripsQueryOptions(owner));
    } catch {
      // Swallowed deliberately — see comment above.
    }
  },
});
export const tripRoute = createRoute({ getParentRoute: () => trackerLayoutRoute, path: "trips/$tripId" });
export const tripSectionRoute = createRoute({
  getParentRoute: () => trackerLayoutRoute,
  path: "trips/$tripId/$section",
});
export const tripDetailRoute = createRoute({ getParentRoute: () => trackerLayoutRoute, path: "trips/$tripId/details" });
export const captureRoute = createRoute({ getParentRoute: () => trackerLayoutRoute, path: "capture" });
export const libraryRoute = createRoute({ getParentRoute: () => trackerLayoutRoute, path: "library" });
export const settingsRoute = createRoute({ getParentRoute: () => trackerLayoutRoute, path: "settings" });
export const trackerNotFoundRoute = createRoute({
  getParentRoute: () => trackerLayoutRoute,
  path: "$",
  component: () => <Navigate to="/" replace />,
});

export function buildTrackerRouteTree({
  Callback,
  OwnerHome,
  Trips,
  TripWorkspace,
  TripDetail,
  Capture,
  Library,
  Settings,
}: {
  Callback: FC;
  OwnerHome: FC;
  Trips: FC;
  TripWorkspace: FC;
  TripDetail: FC;
  Capture: FC;
  Library: FC;
  Settings: FC;
}) {
  return rootRoute.addChildren([
    callbackRoute.update({ component: Callback }),
    trackerLayoutRoute.addChildren([
      homeRoute.update({ component: OwnerHome }),
      tripsRoute.update({ component: Trips }),
      tripRoute.update({ component: TripWorkspace }),
      tripSectionRoute.update({ component: TripWorkspace }),
      tripDetailRoute.update({ component: TripDetail }),
      captureRoute.update({ component: Capture }),
      libraryRoute.update({ component: Library }),
      settingsRoute.update({ component: Settings }),
      trackerNotFoundRoute,
    ]),
  ]);
}

export function createTrackerRouter(
  routeTree: AnyRoute,
  options: { queryClient: QueryClient; initialEntries?: string[]; basepath?: string },
) {
  return createRouter({
    routeTree,
    basepath: options.basepath,
    context: { queryClient: options.queryClient },
    history: options.initialEntries ? createMemoryHistory({ initialEntries: options.initialEntries }) : undefined,
  });
}
