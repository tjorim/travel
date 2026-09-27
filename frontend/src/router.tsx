import type { FC } from "react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Navigate, Outlet, type AnyRoute } from "@tanstack/react-router";

import { AuthProvider } from "./auth-context";
import { Boundary } from "./Boundary";
import { OwnerQueryProvider } from "./query/OwnerQueryProvider";

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** Set by "Toon op kaart" so the trip overview's map can focus that point on arrival. */
    mapFocus?: string;
    /** A message left behind for the page navigated to, e.g. after deleting a trip. */
    notice?: string;
  }
}

export const rootRoute = createRootRoute({
  component: () => (
    <AuthProvider>
      <OwnerQueryProvider>
        <Outlet />
      </OwnerQueryProvider>
    </AuthProvider>
  ),
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
  // The default search (de)serialization JSON-parses digit-led values, turning "1" into the number 1.
  validateSearch: (search: Record<string, unknown>): { new?: string } => ({ new: search.new == null ? undefined : String(search.new) }),
});
export const tripRoute = createRoute({ getParentRoute: () => trackerLayoutRoute, path: "trips/$tripId" });
export const tripSectionRoute = createRoute({ getParentRoute: () => trackerLayoutRoute, path: "trips/$tripId/$section" });
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

export function createTrackerRouter(routeTree: AnyRoute, options?: { initialEntries?: string[]; basepath?: string }) {
  return createRouter({
    routeTree,
    basepath: options?.basepath,
    history: options?.initialEntries ? createMemoryHistory({ initialEntries: options.initialEntries }) : undefined,
  });
}
