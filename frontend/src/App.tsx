import { RouterProvider } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { clearSession } from "./auth";
import { AuthProvider, useAuth } from "./auth-context";
import { lazyNamed } from "./lazy-view";
import { Callback } from "./pages/Callback";
import { OwnerHome } from "./pages/OwnerHome";
import { createOwnerQueryClient } from "./query/client";
import { OwnerQueryProvider } from "./query/OwnerQueryProvider";
import { buildTrackerRouteTree, createTrackerRouter } from "./router";

// The sign-in callback and the home page load with the shell. Every other page is fetched when its route is first
// visited; the router, its loaders and the query client stay here, so route state never depends on a page's chunk.
const Trips = lazyNamed(() => import("./pages/Trips"), "Trips");
const TripWorkspace = lazyNamed(() => import("./pages/TripWorkspace"), "TripWorkspace");
const TripDetail = lazyNamed(() => import("./pages/TripDetail"), "TripDetail");
const Capture = lazyNamed(() => import("./pages/Capture"), "Capture");
const Library = lazyNamed(() => import("./pages/Library"), "Library");
const Settings = lazyNamed(() => import("./pages/Settings"), "Settings");

const routeTree = buildTrackerRouteTree({
  Callback,
  OwnerHome,
  Trips,
  TripWorkspace,
  TripDetail,
  Capture,
  Library,
  Settings,
});

function AppShell() {
  const { setSession } = useAuth();
  const endSession = useRef(() => {});
  endSession.current = () => {
    clearSession();
    setSession(null);
  };
  // Created once and shared with the router below, so a route's `loader` warms
  // the same QueryClient cache that the page's own `useQuery` reads from.
  const [{ queryClient, router }] = useState(() => {
    const queryClient = createOwnerQueryClient({ onUnauthorized: () => endSession.current() });
    return {
      queryClient,
      router: createTrackerRouter(routeTree, { basepath: "/admin", queryClient }),
    };
  });

  return (
    <OwnerQueryProvider client={queryClient}>
      <RouterProvider router={router} />
    </OwnerQueryProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
