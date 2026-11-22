import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { VisitorTopBar } from "@/components/VisitorTopBar";
import type { Audience } from "@/components/projection/ProjectionView";
import { useLocale } from "@/i18n/locale";
import { m } from "@/paraglide/messages.js";
import { TripIndex } from "./TripIndex";
import { VisitorPage } from "./VisitorPage";

function VisitorRoute({ audience }: { audience: Audience }) {
  useLocale();
  const { slug, token, memberId } = useParams({ strict: false });
  const identifier = audience === "public" ? slug : token;
  return identifier ? (
    <VisitorPage
      key={`${audience}:${identifier}:${memberId ?? ""}`}
      audience={audience}
      identifier={identifier}
      memberId={audience === "share" ? memberId : undefined}
    />
  ) : (
    <main className="travel-shell w-travel-visitor-shell! pt-6! min-[960px]:w-travel-owner-shell!">
      <VisitorTopBar />
      <section className="travel-card" role="status">
        <h1>{m.unavailable_trip()}</h1>
      </section>
    </main>
  );
}

const visitorRootRoute = createRootRoute({ component: Outlet });
const visitorIndexRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "/",
  component: TripIndex,
});
const visitorTripsRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "trips",
  component: TripIndex,
});
const visitorTripRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "trips/$slug",
  component: () => <VisitorRoute audience="public" />,
});
const visitorShareRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "share/$token",
  component: () => <VisitorRoute audience="share" />,
});
const visitorShareTripRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "share/$token/trips/$memberId",
  component: () => <VisitorRoute audience="share" />,
});
const visitorNotFoundRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "$",
  component: () => {
    useLocale();
    return (
      <main className="travel-shell w-travel-visitor-shell! pt-6! min-[960px]:w-travel-owner-shell!">
        <VisitorTopBar />
        <section className="travel-card" role="status">
          <h1>{m.page_unavailable()}</h1>
        </section>
      </main>
    );
  },
});

export const visitorRouteTree = visitorRootRoute.addChildren([
  visitorIndexRoute,
  visitorTripsRoute,
  visitorTripRoute,
  visitorShareRoute,
  visitorShareTripRoute,
  visitorNotFoundRoute,
]);

export function createVisitorRouter(initialEntries?: string[]) {
  return createRouter({
    routeTree: visitorRouteTree,
    history: initialEntries ? createMemoryHistory({ initialEntries }) : undefined,
  });
}

export function VisitorRoutes({ initialEntries }: { initialEntries?: string[] } = {}) {
  const router = useMemo(() => createVisitorRouter(initialEntries), [initialEntries]);
  return <RouterProvider router={router} />;
}
