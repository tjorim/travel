// @vitest-environment jsdom
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AuthProvider } from "./auth-context";
import { createOwnerQueryClient } from "./query/client";
import { OwnerQueryProvider } from "./query/OwnerQueryProvider";
import { testToken } from "./query/test-utils";
import { buildTrackerRouteTree, createTrackerRouter } from "./router";

const json = (value: unknown) => Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));

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

afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });

it("prefetches the trips list through tripsRoute's loader before Trips reads it", async () => {
  sessionStorage.setItem("travel-tracker-session", JSON.stringify({ accessToken: testToken("owner-1"), expiresAt: Date.now() + 60_000 }));
  const fetcher = vi.fn(() => json([{ id: "t1", title: "Exampleland" }]));
  vi.stubGlobal("fetch", fetcher);

  const queryClient = createOwnerQueryClient();
  const routeTree = buildTrackerRouteTree(routeComponents);
  const router = createTrackerRouter(routeTree, { queryClient, initialEntries: ["/trips"] });

  render(<AuthProvider><OwnerQueryProvider client={queryClient}><RouterProvider router={router} /></OwnerQueryProvider></AuthProvider>);

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

  render(<AuthProvider><OwnerQueryProvider client={queryClient}><RouterProvider router={router} /></OwnerQueryProvider></AuthProvider>);

  await waitFor(() => expect(screen.getByText("Trips geladen")).toBeTruthy());
  expect(fetcher).not.toHaveBeenCalled();
});
