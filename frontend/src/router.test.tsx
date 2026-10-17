// @vitest-environment jsdom
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AuthProvider } from "./auth-context";
import { createOwnerQueryClient } from "./query/client";
import { OwnerQueryProvider } from "./query/OwnerQueryProvider";
import { testToken } from "./query/test-utils";
import { buildTrackerRouteTree, createTrackerRouter } from "./router";
import { Trips } from "./pages/Trips";
import { TripWorkspace } from "./pages/TripWorkspace";

// The workspace-route regression test below exercises the real Trips component on the
// real route tree; everything it renders beyond the section nav is covered elsewhere.
vi.mock("./trips/DocumentManager", () => ({ DocumentManager: () => null }));
vi.mock("./trips/VisitManager", () => ({ VisitManager: () => null }));
vi.mock("./trips/AreaManager", () => ({ AreaManager: () => null }));
vi.mock("./trips/LocationManager", () => ({ LocationManager: () => null }));
vi.mock("./trips/TravelUpdateManager", () => ({ TravelUpdateManager: () => null }));
vi.mock("./trips/MediaManager", () => ({ MediaManager: () => null }));
vi.mock("./trips/OwnerTripMap", () => ({ OwnerTripMap: () => null }));
vi.mock("./trips/PublicationManager", () => ({ PublicationManager: () => null }));
vi.mock("./trips/StayManager", () => ({ StayManager: () => null }));
vi.mock("./trips/RouteManager", () => ({ RouteManager: () => null }));
vi.mock("./trips/AgendaView", () => ({ AgendaView: () => null }));
vi.mock("./trips/TripTaskManager", () => ({ TripTaskManager: () => null }));
vi.mock("./library/LinkedLibraryDocuments", () => ({ LinkedLibraryDocuments: () => null }));
vi.mock("./trips/TripOverview", () => ({ TripOverview: () => null }));

const json = (value: unknown) =>
  Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));

const routeComponents = {
  Callback: () => null,
  OwnerHome: () => null,
  Trips: () => <p>Trips geladen</p>,
  TripWorkspace: () => null,
  TripDetail: () => null,
  Capture: () => null,
  Library: () => null,
  Settings: () => null,
};

// The real Trips/TripWorkspace pair, wired through the app's own route tree, so this
// reproduces #239: Trips is a sibling (not a descendant) of tripsRoute on these paths.
const workspaceRouteComponents = { ...routeComponents, Trips, TripWorkspace };

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

it("prefetches the trips list through tripsRoute's loader before Trips reads it", async () => {
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ accessToken: testToken("owner-1"), expiresAt: Date.now() + 60_000 }),
  );
  const fetcher = vi.fn(() => json([{ id: "t1", title: "Exampleland" }]));
  vi.stubGlobal("fetch", fetcher);

  const queryClient = createOwnerQueryClient();
  const routeTree = buildTrackerRouteTree(routeComponents);
  const router = createTrackerRouter(routeTree, { queryClient, initialEntries: ["/trips"] });

  render(
    <AuthProvider>
      <OwnerQueryProvider client={queryClient}>
        <RouterProvider router={router} />
      </OwnerQueryProvider>
    </AuthProvider>,
  );

  await waitFor(() => expect(screen.getByText("Trips geladen")).toBeTruthy());
  // The loader's ensureQueryData and Trips' own useTripsQuery share one cache
  // entry (same queryOptions), so only one request should ever go out.
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("skips the prefetch (and any request) when there is no signed-in owner", async () => {
  const fetcher = vi.fn(() => json([{ id: "t1", title: "Exampleland" }]));
  vi.stubGlobal("fetch", fetcher);

  const queryClient = createOwnerQueryClient();
  const routeTree = buildTrackerRouteTree(routeComponents);
  const router = createTrackerRouter(routeTree, { queryClient, initialEntries: ["/trips"] });

  render(
    <AuthProvider>
      <OwnerQueryProvider client={queryClient}>
        <RouterProvider router={router} />
      </OwnerQueryProvider>
    </AuthProvider>,
  );

  await waitFor(() => expect(screen.getByText("Trips geladen")).toBeTruthy());
  expect(fetcher).not.toHaveBeenCalled();
});

it("opens a trip workspace section directly without crashing (regression for #239)", async () => {
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ accessToken: testToken("owner-1"), expiresAt: Date.now() + 60_000 }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/trips")
        return json([
          {
            id: "t1",
            title: "Exampleland",
            summary: null,
            starts_on: null,
            ends_on: null,
            travel_updates: [],
          },
        ]);
      if (url.endsWith("/areas")) return json([]);
      throw new Error(`unexpected request ${url}`);
    }),
  );

  const queryClient = createOwnerQueryClient();
  const routeTree = buildTrackerRouteTree(workspaceRouteComponents);
  // A direct load of a trip's sharing section, as in the issue's reproduction steps.
  const router = createTrackerRouter(routeTree, {
    queryClient,
    initialEntries: ["/trips/t1/sharing"],
  });

  render(
    <AuthProvider>
      <OwnerQueryProvider client={queryClient}>
        <RouterProvider router={router} />
      </OwnerQueryProvider>
    </AuthProvider>,
  );

  await waitFor(() => expect(screen.getByRole("heading", { name: "Exampleland" })).toBeTruthy());
});
