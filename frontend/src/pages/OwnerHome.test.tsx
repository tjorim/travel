// @vitest-environment jsdom
import { createRootRoute } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import { OwnerHome } from "./OwnerHome";

const routeTree = createRootRoute({ component: OwnerHome });
const renderHome = () => renderRoutesWithOwner(routeTree, ["/"]);

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => ({ session: auth.session }) }));

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function trip(id: string, title: string, startsOn: string | null, endsOn: string | null) {
  return { id, title, summary: null, starts_on: startsOn, ends_on: endsOn, travel_updates: [] };
}

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows active and planning-first trips with unread alerts", async () => {
  const now = new Date();
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const trips = [trip("active", "Exampleland", day(-1), day(1)), trip("planned", "IJsland", null, null)];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/trips") return Promise.resolve(json(trips));
      if (url.includes("task-alerts"))
        return Promise.resolve(
          json(
            url.includes("active")
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
        );
      if (url.includes("trip-tasks")) return Promise.resolve(json([]));
      if (url.includes("stays") || url.includes("routes")) return Promise.resolve(json([]));
      throw new Error(`unexpected request ${url}`);
    }),
  );

  renderHome();
  await waitFor(() => expect(screen.getByText("Exampleland")).toBeTruthy());
  expect(screen.getByText("Nu op reis")).toBeTruthy();
  expect(screen.getByText("Nog plannen")).toBeTruthy();
  expect(screen.getByText("Check in")).toBeTruthy();
  expect(screen.getAllByRole("link", { name: "Open reis" })[0].getAttribute("href")).toBe("/trips/active");
  expect(screen.getByRole("link", { name: "Publieke reizen bekijken" }).getAttribute("href")).toBe("/");
});

it("offers a first private trip when the owner has none", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(json([]))),
  );
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

function inboxApi(patch: () => Response) {
  const now = new Date();
  let current = alert(now);
  return vi.fn((url: string, init: RequestInit = {}) => {
    if (init.method === "PATCH") {
      const response = patch();
      if (response.ok) current = { ...current, read_at: now.toISOString() };
      return Promise.resolve(response);
    }
    if (url === "/api/trips") return Promise.resolve(json([trip("active", "Exampleland", "2000-01-01", "2999-01-01")]));
    if (url.includes("task-alerts")) return Promise.resolve(json([current]));
    return Promise.resolve(json([]));
  });
}

it("clears a reminder from the inbox at once and keeps it cleared once the server agrees", async () => {
  const fetcher = inboxApi(() => json({}));
  vi.stubGlobal("fetch", fetcher);
  renderHome();
  fireEvent.click(await screen.findByRole("button", { name: "Gelezen" }));
  await waitFor(() => expect(screen.queryByText("Check in")).toBeNull());
  expect(
    fetcher.mock.calls.some(
      ([url, init]) => String(url).endsWith("/task-alerts/alert/read") && (init as RequestInit).method === "PATCH",
    ),
  ).toBe(true);
});

it("brings a reminder back with a message when marking it read fails", async () => {
  vi.stubGlobal(
    "fetch",
    inboxApi(() => new Response(JSON.stringify({ detail: "Bijwerken mislukt." }), { status: 500 })),
  );
  renderHome();
  fireEvent.click(await screen.findByRole("button", { name: "Gelezen" }));
  await screen.findByText("Bijwerken mislukt.");
  expect(screen.getByText("Check in")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Gelezen" })).toBeTruthy();
});

it("explains that the workspace needs a connection instead of retrying offline", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  renderHome();
  expect(await screen.findByText(/Je bent offline/)).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});
