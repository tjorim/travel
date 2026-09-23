// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { OwnerHome } from "./OwnerHome";

const auth = vi.hoisted(() => ({ session: { accessToken: "token" } as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => ({ session: auth.session }) }));

function json(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }); }

function trip(id: string, title: string, startsOn: string | null, endsOn: string | null) {
  return { id, title, summary: null, starts_on: startsOn, ends_on: endsOn, visibility: "private", publication_state: "draft", route_stages: [], highlights: [], moments: [], moment_excerpts: [] };
}

beforeEach(() => {
  auth.session = { accessToken: "token" };
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows active and planning-first trips with unread alerts", async () => {
  const now = new Date();
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const trips = [trip("active", "Exampleland", day(-1), day(1)), trip("planned", "IJsland", null, null)];
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/api/trips") return Promise.resolve(json(trips));
    if (url.includes("task-alerts")) return Promise.resolve(json(url.includes("active") ? [{ id: "alert", task_id: "task", kind: "reminder", title: "Check in", scheduled_for: now.toISOString(), created_at: now.toISOString(), read_at: null, email_sent_at: null, email_attempts: 0, email_last_error: null }] : []));
    if (url.includes("trip-tasks")) return Promise.resolve(json([]));
    if (url.includes("stays") || url.includes("transport-legs")) return Promise.resolve(json([]));
    throw new Error(`unexpected request ${url}`);
  }));

  render(<MemoryRouter><OwnerHome /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("Exampleland")).toBeTruthy());
  expect(screen.getByText("Nu op reis")).toBeTruthy();
  expect(screen.getByText("Nog plannen")).toBeTruthy();
  expect(screen.getByText("Check in")).toBeTruthy();
  expect(screen.getAllByRole("link", { name: "Open reis" })[0].getAttribute("href")).toBe("/trips/active");
});

it("offers a first private trip when the owner has none", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json([]))));
  render(<MemoryRouter><OwnerHome /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("Begin met je eerste reis")).toBeTruthy());
  expect(screen.getAllByRole("link", { name: "Nieuwe reis" }).length).toBeGreaterThan(0);
});

it("asks an inaccessible session to sign in", () => {
  auth.session = null;
  render(<MemoryRouter><OwnerHome /></MemoryRouter>);
  expect(screen.getByText("Meld aan om je private reiswerkruimte te openen.")).toBeTruthy();
});
