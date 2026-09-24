// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { OwnerQueryProvider } from "./OwnerQueryProvider";
import { createOwnerQueryClient } from "./client";
import { useOwnerMutation, useTripResource, useTripsQuery } from "./owner-queries";
import { renderWithOwner, testClient, testToken } from "./test-utils";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string; expiresAt: number } | null, setSession: vi.fn() }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));

beforeEach(() => {
  auth.session = { accessToken: testToken("owner-1"), expiresAt: Date.now() + 60_000 };
  auth.setSession.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function TaskCount({ label }: { label: string }) {
  const tasks = useTripResource("trip", "trip-tasks");
  return <p>{label}: {tasks.data ? tasks.data.length : "…"}</p>;
}

it("does not duplicate an in-flight identical owner read across screens", async () => {
  const fetcher = vi.fn(() => json([{ id: "task" }]));
  vi.stubGlobal("fetch", fetcher);
  renderWithOwner(<><TaskCount label="overview" /><TaskCount label="tasks" /></>);
  await waitFor(() => expect(screen.getByText("tasks: 1")).toBeTruthy());
  expect(screen.getByText("overview: 1")).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("reuses a fresh cached read when a screen remounts on route change", async () => {
  const fetcher = vi.fn(() => json([{ id: "task" }]));
  vi.stubGlobal("fetch", fetcher);
  const client = testClient();
  const first = renderWithOwner(<TaskCount label="first" />, client);
  await waitFor(() => expect(screen.getByText("first: 1")).toBeTruthy());
  first.unmount();
  renderWithOwner(<TaskCount label="second" />, client);
  expect(screen.getByText("second: 1")).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("aborts an in-flight read when its screen goes away", async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => { signal = init.signal ?? undefined; return new Promise(() => undefined); }));
  const { unmount } = renderWithOwner(<TaskCount label="tasks" />);
  await waitFor(() => expect(signal).toBeDefined());
  expect(signal!.aborted).toBe(false);
  unmount();
  await waitFor(() => expect(signal!.aborted).toBe(true));
});

it("keeps one owner's records out of another owner's cache", async () => {
  const fetcher = vi.fn((_url: string, init: RequestInit) => json([{ id: (init.headers as Record<string, string>).Authorization.includes(testToken("owner-1")) ? "mine" : "theirs" }]));
  vi.stubGlobal("fetch", fetcher);
  const client = testClient();
  function Trips() { return <p>{useTripsQuery().data?.map((trip) => trip.id).join(",") ?? "…"}</p>; }
  const view = render(<QueryClientProvider client={client}><OwnerQueryProvider client={client}><Trips /></OwnerQueryProvider></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText("mine")).toBeTruthy());

  auth.session = { accessToken: testToken("owner-2"), expiresAt: Date.now() + 60_000 };
  view.rerender(<QueryClientProvider client={client}><OwnerQueryProvider client={client}><Trips /></OwnerQueryProvider></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText("theirs")).toBeTruthy());
  expect(client.getQueryCache().findAll().every((query) => query.queryKey[1] === "owner-2")).toBe(true);
});

it("discards the owner cache on sign-out", async () => {
  vi.stubGlobal("fetch", vi.fn(() => json([{ id: "task" }])));
  const client = testClient();
  const tree = () => <QueryClientProvider client={client}><OwnerQueryProvider client={client}><TaskCount label="tasks" /></OwnerQueryProvider></QueryClientProvider>;
  const view = render(tree());
  await waitFor(() => expect(screen.getByText("tasks: 1")).toBeTruthy());
  auth.session = null;
  view.rerender(tree());
  // A signed-out screen may keep an empty, disabled placeholder; no owner record may remain.
  await waitFor(() => expect(client.getQueryCache().findAll().filter((query) => query.state.data !== undefined)).toHaveLength(0));
});

it("ends the session once on a 401 and does not retry it", async () => {
  const fetcher = vi.fn(() => json({ detail: "Not authenticated" }, 401));
  vi.stubGlobal("fetch", fetcher);
  sessionStorage.setItem("travel-tracker-session", "kept-until-cleared");
  const client = createOwnerQueryClient({ onUnauthorized: () => auth.setSession(null) });
  render(<QueryClientProvider client={client}><TaskCount label="tasks" /></QueryClientProvider>);
  await waitFor(() => expect(auth.setSession).toHaveBeenCalledTimes(1));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("wires the provider's 401 handler to sign the owner out", async () => {
  vi.stubGlobal("fetch", vi.fn(() => json({ detail: "Not authenticated" }, 401)));
  localStorage.setItem("travel-tracker-may-restore-session", "1");
  render(<OwnerQueryProvider><TaskCount label="tasks" /></OwnerQueryProvider>);
  await waitFor(() => expect(auth.setSession).toHaveBeenCalledWith(null));
  expect(localStorage.getItem("travel-tracker-may-restore-session")).toBeNull();
});

it("fails a write immediately while offline instead of queueing it", async () => {
  const fetcher = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
  vi.stubGlobal("fetch", fetcher);
  let outcome: unknown;
  function Save() {
    const save = useOwnerMutation<string>({ fallback: "Mislukt.", request: (title) => ({ path: "/api/trips", method: "POST", body: { title } }), invalidate: () => [] });
    return <button onClick={() => save.mutateAsync("Exampleland").catch((error: unknown) => { outcome = error; })}>Opslaan</button>;
  }
  renderWithOwner(<Save />);
  screen.getByRole("button", { name: "Opslaan" }).click();
  await waitFor(() => expect(outcome).toBeDefined());
  expect((outcome as Error).message).toContain("Geen verbinding");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
