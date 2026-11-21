import { responseFixtures } from "@/mocks/response-test-fixtures";
import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, expect, it, vi } from "vitest";

import { server } from "@/mocks/server";
import { AuthProvider } from "@/app/providers/auth-context";
import { createOwnerQueryClient } from "@/lib/query/client";
import { OwnerQueryProvider } from "@/app/providers/OwnerQueryProvider";
import { testToken } from "../../utils/query-test-utils";
import { buildOwnerRouteTree, createOwnerRouter } from "@/app/router/router";
import { Trips } from "@/features/trips/trip/Trips";
import { TripWorkspace } from "@/features/trips/workspace/TripWorkspace";

// The workspace-route regression test below exercises the real Trips component on the
// real route tree; everything it renders beyond the section nav is covered elsewhere.
vi.mock("@/features/documents/DocumentManager", () => ({ DocumentManager: () => null }));
vi.mock("@/features/trips/areas/AreaManager", () => ({ AreaManager: () => null }));
vi.mock("@/features/trips/locations/LocationManager", () => ({ LocationManager: () => null }));
vi.mock("@/features/trips/updates/TravelUpdateManager", () => ({
  TravelUpdateManager: () => null,
}));
vi.mock("@/features/trips/media/MediaManager", () => ({ MediaManager: () => null }));
vi.mock("@/features/trips/workspace/OwnerTripMap", () => ({ OwnerTripMap: () => null }));
vi.mock("@/features/trips/publication/PublicationManager", () => ({
  PublicationManager: () => null,
}));
vi.mock("@/features/trips/agenda/AgendaView", () => ({ AgendaView: () => null }));
vi.mock("@/features/trips/tasks/TripTaskManager", () => ({ TripTaskManager: () => null }));
vi.mock("@/features/trips/workspace/TripOverview", () => ({ TripOverview: () => null }));

/** Serves the trips list and returns the requests it received. */
function serveTrips(trips: Api.TripSummaryResponse[]): Request[] {
  const requests: Request[] = [];
  server.use(
    http.get("/api/trips", ({ request }) => {
      requests.push(request);
      return HttpResponse.json<Api.TripSummaryResponse[]>(trips);
    }),
  );
  return requests;
}

const routeComponents = {
  Callback: () => null,
  OwnerHome: () => null,
  Trips: () => <p>Trips geladen</p>,
  TripWorkspace: () => null,
  TripDetail: () => null,
  Capture: () => null,
  Library: () => null,
  Sharing: () => null,
  Settings: () => null,
};

// The real Trips/TripWorkspace pair, wired through the app's own route tree, so this
// reproduces #239: Trips is a sibling (not a descendant) of tripsRoute on these paths.
const workspaceRouteComponents = { ...routeComponents, Trips, TripWorkspace };

afterEach(() => {
  // Vitest globals are off, so Testing Library does not unmount for us. Without this the workspace
  // test leaves the real route tree mounted and fetching when the worker's DOM is torn down, and
  // React's scheduler then throws "window is not defined" as an unhandled error (flaky in CI).
  cleanup();
  sessionStorage.clear();
});

it("prefetches the trips list through tripsRoute's loader before Trips reads it", async () => {
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ accessToken: testToken("owner-1"), expiresAt: Date.now() + 60_000 }),
  );
  const requests = serveTrips([
    { ...responseFixtures.TripSummaryResponse, id: "t1", title: "Exampleland" },
  ]);

  const queryClient = createOwnerQueryClient();
  const routeTree = buildOwnerRouteTree(routeComponents);
  const router = createOwnerRouter(routeTree, { queryClient, initialEntries: ["/trips"] });

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
  expect(requests).toHaveLength(1);
});

it("skips the prefetch (and any request) when there is no signed-in owner", async () => {
  const requests = serveTrips([
    { ...responseFixtures.TripSummaryResponse, id: "t1", title: "Exampleland" },
  ]);

  const queryClient = createOwnerQueryClient();
  const routeTree = buildOwnerRouteTree(routeComponents);
  const router = createOwnerRouter(routeTree, { queryClient, initialEntries: ["/trips"] });

  render(
    <AuthProvider>
      <OwnerQueryProvider client={queryClient}>
        <RouterProvider router={router} />
      </OwnerQueryProvider>
    </AuthProvider>,
  );

  await waitFor(() => expect(screen.getByText("Trips geladen")).toBeTruthy());
  expect(requests).toHaveLength(0);
});

it("opens a trip workspace section directly without crashing (regression for #239)", async () => {
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ accessToken: testToken("owner-1"), expiresAt: Date.now() + 60_000 }),
  );
  serveTrips([
    {
      ...responseFixtures.TripSummaryResponse,
      id: "t1",
      title: "Exampleland",
      summary: null,
      starts_on: null,
      ends_on: null,
    },
  ]);
  server.use(http.get("/api/trips/:tripId/areas", () => HttpResponse.json<Api.AreaResponse[]>([])));

  const queryClient = createOwnerQueryClient();
  const routeTree = buildOwnerRouteTree(workspaceRouteComponents);
  // A direct load of a trip's sharing section, as in the issue's reproduction steps.
  const router = createOwnerRouter(routeTree, {
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
