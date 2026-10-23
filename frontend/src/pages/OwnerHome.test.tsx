// @vitest-environment jsdom
import { createRootRoute } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { server } from "../mocks/server";
import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import { OwnerHome } from "./OwnerHome";

const routeTree = createRootRoute({ component: OwnerHome });
const renderHome = () => renderRoutesWithOwner(routeTree, ["/"]);

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => ({ session: auth.session }) }));

function trip(id: string, title: string, startsOn: string | null, endsOn: string | null) {
  return { id, title, summary: null, starts_on: startsOn, ends_on: endsOn, travel_updates: [] };
}

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

afterEach(() => {
  cleanup();
});

it("shows active and planning-first trips with unread alerts", async () => {
  const now = new Date();
  const day = (offset: number) =>
    new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const trips = [trip("active", "Exampleland", day(-1), day(1)), trip("planned", "IJsland", null, null)];
  server.use(
    http.get("/api/trips", () => HttpResponse.json(trips)),
    http.get("/api/trips/:tripId/task-alerts", ({ params }) =>
      HttpResponse.json(
        params.tripId === "active"
          ? [
              {
                id: "alert",
                task_id: "task",
                kind: "reminder",
                title: "Check in",
                scheduled_for: now.toISOString(),
                created_at: now.toISOString(),
                read_at: null,
                email_sent_at: null,
                email_attempts: 0,
                email_last_error: null,
              },
            ]
          : [],
      ),
    ),
    http.get("/api/trips/:tripId/trip-tasks", () => HttpResponse.json([])),
    http.get("/api/trips/:tripId/stays", () => HttpResponse.json([])),
    http.get("/api/trips/:tripId/routes", () => HttpResponse.json([])),
  );

  renderHome();
  await waitFor(() => expect(screen.getByText("Exampleland")).toBeTruthy());
  expect(screen.getByText("Nu op reis")).toBeTruthy();
  expect(screen.getByText("Nog plannen")).toBeTruthy();
  expect(screen.getByText("Check in")).toBeTruthy();
  expect(screen.getAllByRole("link", { name: "Open reis" })[0].getAttribute("href")).toBe(
    "/trips/active",
  );
  expect(screen.getByRole("link", { name: "Publieke reizen bekijken" }).getAttribute("href")).toBe(
    "/",
  );
});

it("offers a first private trip when the owner has none", async () => {
  server.use(http.get("/api/trips", () => HttpResponse.json([])));
  renderHome();
  await waitFor(() => expect(screen.getByText("Begin met je eerste reis")).toBeTruthy());
  expect(screen.getAllByRole("link", { name: "Nieuwe reis" }).length).toBeGreaterThan(0);
});

it("asks an inaccessible session to sign in", async () => {
  auth.session = null;
  renderHome();
  expect(await screen.findByText("Meld aan om je private reiswerkruimte te openen.")).toBeTruthy();
});

const alert = (now: Date) => ({
  id: "alert",
  task_id: "task",
  kind: "reminder",
  title: "Check in",
  scheduled_for: now.toISOString(),
  created_at: now.toISOString(),
  read_at: null as string | null,
  email_sent_at: null,
  email_attempts: 0,
  email_last_error: null,
});

/** The owner's one active trip with a single unread reminder; `patch` answers the mark-as-read write. */
function serveInbox(patch: () => Response) {
  const now = new Date();
  let current = alert(now);
  const patches: Request[] = [];
  // Keep the trip active without making the overview enumerate a millennium of nights.
  const day = (offset: number) =>
    new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  server.use(
    http.get("/api/trips", () => HttpResponse.json([trip("active", "Exampleland", day(-1), day(1))])),
    http.get("/api/trips/:tripId/task-alerts", () => HttpResponse.json([current])),
    http.get("/api/trips/:tripId/:resource", () => HttpResponse.json([])),
    http.patch("/api/trips/:tripId/task-alerts/:alertId/read", ({ request }) => {
      patches.push(request);
      const response = patch();
      if (response.ok) current = { ...current, read_at: now.toISOString() };
      return response;
    }),
  );
  return patches;
}

it("clears a reminder from the inbox at once and keeps it cleared once the server agrees", async () => {
  const patches = serveInbox(() => HttpResponse.json({}));
  renderHome();
  fireEvent.click(await screen.findByRole("button", { name: "Gelezen" }));
  await waitFor(() => expect(screen.queryByText("Check in")).toBeNull());
  expect(patches).toHaveLength(1);
  expect(new URL(patches[0]!.url).pathname).toMatch(/\/task-alerts\/alert\/read$/);
});

it("brings a reminder back with a message when marking it read fails", async () => {
  serveInbox(() => HttpResponse.json({ detail: "Bijwerken mislukt." }, { status: 500 }));
  renderHome();
  fireEvent.click(await screen.findByRole("button", { name: "Gelezen" }));
  await screen.findByText(
    "De melding kon niet worden bijgewerkt. De server reageert niet goed. Probeer het later opnieuw.",
  );
  expect(screen.getByText("Check in")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Gelezen" })).toBeTruthy();
});

it("explains that the workspace needs a connection instead of retrying offline", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  const requests: Request[] = [];
  server.use(
    http.all("*", ({ request }) => {
      requests.push(request);
      return HttpResponse.json([]);
    }),
  );
  renderHome();
  expect(await screen.findByText(/Je bent offline/)).toBeTruthy();
  expect(requests).toHaveLength(0);
});
