// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { server } from "../mocks/server";
import { OwnerQueryProvider } from "./OwnerQueryProvider";
import { createOwnerQueryClient } from "./client";
import { useOwnerMutation, useTripResource, useTripsQuery } from "./owner-queries";
import { renderWithOwner, testClient, testToken } from "./test-utils";

const auth = vi.hoisted(() => ({
  session: null as { accessToken: string; expiresAt: number } | null,
  setSession: vi.fn(),
}));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const TASKS = "/api/trips/trip/trip-tasks";

/** Serves the tasks of the test trip and counts how often the API is asked. */
function serveTasks(respond: () => Response = () => HttpResponse.json([{ id: "task" }])) {
  const requests: Request[] = [];
  server.use(
    http.get(TASKS, ({ request }) => {
      requests.push(request);
      return respond();
    }),
  );
  return requests;
}

beforeEach(() => {
  auth.session = { accessToken: testToken("owner-1"), expiresAt: Date.now() + 60_000 };
  auth.setSession.mockReset();
});
afterEach(() => {
  cleanup();
});

function TaskCount({ label }: { label: string }) {
  const tasks = useTripResource("trip", "trip-tasks");
  return (
    <p>
      {label}: {tasks.data ? tasks.data.length : "…"}
    </p>
  );
}

it("does not duplicate an in-flight identical owner read across screens", async () => {
  const requests = serveTasks();
  renderWithOwner(
    <>
      <TaskCount label="overview" />
      <TaskCount label="tasks" />
    </>,
  );
  await waitFor(() => expect(screen.getByText("tasks: 1")).toBeTruthy());
  expect(screen.getByText("overview: 1")).toBeTruthy();
  expect(requests).toHaveLength(1);
});

it("reuses a fresh cached read when a screen remounts on route change", async () => {
  const requests = serveTasks();
  const client = testClient();
  const first = renderWithOwner(<TaskCount label="first" />, client);
  await waitFor(() => expect(screen.getByText("first: 1")).toBeTruthy());
  first.unmount();
  renderWithOwner(<TaskCount label="second" />, client);
  expect(screen.getByText("second: 1")).toBeTruthy();
  expect(requests).toHaveLength(1);
});

it("aborts an in-flight read when its screen goes away", async () => {
  let signal: AbortSignal | undefined;
  server.use(
    http.get(TASKS, ({ request }) => {
      signal = request.signal;
      // Never answers, so the read stays in flight until its screen goes away.
      return new Promise<Response>(() => undefined);
    }),
  );
  const { unmount } = renderWithOwner(<TaskCount label="tasks" />);
  await waitFor(() => expect(signal).toBeDefined());
  expect(signal!.aborted).toBe(false);
  unmount();
  await waitFor(() => expect(signal!.aborted).toBe(true));
});

it("keeps one owner's records out of another owner's cache", async () => {
  server.use(
    http.get("/api/trips", ({ request }) =>
      HttpResponse.json([
        {
          id: request.headers.get("authorization")?.includes(testToken("owner-1"))
            ? "mine"
            : "theirs",
        },
      ]),
    ),
  );
  const client = testClient();
  function Trips() {
    return (
      <p>
        {useTripsQuery()
          .data?.map((trip) => trip.id)
          .join(",") ?? "…"}
      </p>
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <OwnerQueryProvider client={client}>
        <Trips />
      </OwnerQueryProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText("mine")).toBeTruthy());

  auth.session = { accessToken: testToken("owner-2"), expiresAt: Date.now() + 60_000 };
  view.rerender(
    <QueryClientProvider client={client}>
      <OwnerQueryProvider client={client}>
        <Trips />
      </OwnerQueryProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText("theirs")).toBeTruthy());
  expect(
    client
      .getQueryCache()
      .findAll()
      .every((query) => query.queryKey[1] === "owner-2"),
  ).toBe(true);
});

it("discards the owner cache on sign-out", async () => {
  serveTasks();
  const client = testClient();
  const tree = () => (
    <QueryClientProvider client={client}>
      <OwnerQueryProvider client={client}>
        <TaskCount label="tasks" />
      </OwnerQueryProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  await waitFor(() => expect(screen.getByText("tasks: 1")).toBeTruthy());
  auth.session = null;
  view.rerender(tree());
  // A signed-out screen may keep an empty, disabled placeholder; no owner record may remain.
  await waitFor(() =>
    expect(
      client
        .getQueryCache()
        .findAll()
        .filter((query) => query.state.data !== undefined),
    ).toHaveLength(0),
  );
});

it("ends the session once on a 401 and does not retry it", async () => {
  const requests = serveTasks(() =>
    HttpResponse.json({ detail: "Not authenticated" }, { status: 401 }),
  );
  sessionStorage.setItem("travel-tracker-session", "kept-until-cleared");
  const client = createOwnerQueryClient({ onUnauthorized: () => auth.setSession(null) });
  render(
    <QueryClientProvider client={client}>
      <TaskCount label="tasks" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(auth.setSession).toHaveBeenCalledTimes(1));
  expect(requests).toHaveLength(1);
});

it("preserves the session and restore marker on a final 401", async () => {
  const requests = serveTasks(() =>
    HttpResponse.json({ detail: "Not authenticated" }, { status: 401 }),
  );
  localStorage.setItem("travel-tracker-may-restore-session", "1");
  render(
    <OwnerQueryProvider>
      <TaskCount label="tasks" />
    </OwnerQueryProvider>,
  );
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(auth.setSession).not.toHaveBeenCalled();
  expect(localStorage.getItem("travel-tracker-may-restore-session")).toBe("1");
});

it("fails a write immediately while offline instead of queueing it", async () => {
  const requests: Request[] = [];
  server.use(
    http.post("/api/trips", ({ request }) => {
      requests.push(request);
      return HttpResponse.error();
    }),
  );
  let outcome: unknown;
  function Save() {
    const save = useOwnerMutation<string>({
      fallback: "Mislukt.",
      request: (title) => ({ path: "/api/trips", method: "POST", body: { title } }),
      invalidate: () => [],
    });
    return (
      <button
        onClick={() =>
          save.mutateAsync("Exampleland").catch((error: unknown) => {
            outcome = error;
          })
        }
      >
        Opslaan
      </button>
    );
  }
  renderWithOwner(<Save />);
  screen.getByRole("button", { name: "Opslaan" }).click();
  await waitFor(() => expect(outcome).toBeDefined());
  expect((outcome as Error).message).toContain("Geen verbinding");
  expect(requests).toHaveLength(1);
});

vi.mock("../auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("../auth")>();
  return {
    ...original,
    freshSession: async (session: unknown, force: boolean) => {
      if (force) throw new Error("Sign-in required");
      return session;
    },
  };
});
