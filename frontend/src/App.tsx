import { createPortal } from "react-dom";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { renewSession } from "./auth";
import { AuthProvider, useAuth } from "./auth-context";
import { Button } from "@/ui/button";
import { useLocale } from "./locale";
import { m } from "./paraglide/messages.js";
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
  useLocale();
  const { setSession } = useAuth();
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const expired = () => setExpired(true);
    const renewed = () => setExpired(false);
    window.addEventListener("travel-session-expired", expired);
    window.addEventListener("travel-session-renewed", renewed);
    return () => {
      window.removeEventListener("travel-session-expired", expired);
      window.removeEventListener("travel-session-renewed", renewed);
    };
  }, []);
  // A modal makes the surrounding shell inert. Keep recovery reachable inside
  // the active editor, and move it back when that editor closes.
  const [bannerTarget, setBannerTarget] = useState<Element | null>(null);
  useEffect(() => {
    if (!expired) return;
    const update = () =>
      setBannerTarget([...document.querySelectorAll('[role="dialog"]')].at(-1) ?? null);
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [expired]);
  const endSession = useRef(() => {});
  endSession.current = () => {
    setExpired(true);
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

  const banner = expired && (
    <div role="alert" className="travel-card">
      <p>{m.owner_session_expired_save()}</p>
      <Button
        onClick={() =>
          void renewSession(true)
            .then((session) => {
              setSession(session);
              setExpired(false);
            })
            .catch(() => {})
        }
      >
        {m.owner_sign_in_again()}
      </Button>
    </div>
  );

  return (
    <OwnerQueryProvider client={queryClient}>
      {bannerTarget?.isConnected ? createPortal(banner, bannerTarget) : banner}
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
