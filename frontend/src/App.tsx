import { RouterProvider } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { clearSession } from "./auth";
import { AuthProvider, useAuth } from "./auth-context";
import { Capture } from "./pages/Capture";
import { Callback } from "./pages/Callback";
import { Library } from "./pages/Library";
import { OwnerHome } from "./pages/OwnerHome";
import { Trips } from "./pages/Trips";
import { TripDetail } from "./pages/TripDetail";
import { TripWorkspace } from "./pages/TripWorkspace";
import { Settings } from "./pages/Settings";
import { createOwnerQueryClient } from "./query/client";
import { OwnerQueryProvider } from "./query/OwnerQueryProvider";
import { buildTrackerRouteTree, createTrackerRouter } from "./router";

const routeTree = buildTrackerRouteTree({ Callback, OwnerHome, Trips, TripWorkspace, TripDetail, Capture, Library, Settings });

function AppShell() {
  const { setSession } = useAuth();
  const endSession = useRef(() => {});
  endSession.current = () => { clearSession(); setSession(null); };
  // Created once and shared with the router below, so a route's `loader` warms
  // the same QueryClient cache that the page's own `useQuery` reads from.
  const [{ queryClient, router }] = useState(() => {
    const queryClient = createOwnerQueryClient({ onUnauthorized: () => endSession.current() });
    return { queryClient, router: createTrackerRouter(routeTree, { basepath: "/admin", queryClient }) };
  });

  return <OwnerQueryProvider client={queryClient}><RouterProvider router={router} /></OwnerQueryProvider>;
}

export function App() {
  return <AuthProvider><AppShell /></AuthProvider>;
}
