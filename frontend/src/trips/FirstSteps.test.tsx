// @vitest-environment happy-dom
import { createRootRoute } from "@tanstack/react-router";
import { cleanup, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { server } from "../mocks/server";
import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import type { Area, Trip } from "../tracker-model";
import { FirstSteps } from "./FirstSteps";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = {
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [],
};

const render = (areas: Area[] = []) =>
  renderRoutesWithOwner(
    createRootRoute({ component: () => <FirstSteps trip={trip} areas={areas} /> }),
    ["/"],
  );

function serve(records: { visits?: unknown[]; stays?: unknown[]; routes?: unknown[] }) {
  server.use(
    http.get("*/api/trips/trip/visits", () => HttpResponse.json(records.visits ?? [])),
    http.get("*/api/trips/trip/stays", () => HttpResponse.json(records.stays ?? [])),
    http.get("*/api/trips/trip/routes", () => HttpResponse.json(records.routes ?? [])),
  );
}

beforeEach(() => {
  auth.session = { accessToken: testToken() };
});
afterEach(cleanup);

it("offers places, a stay and a route to a trip that has none of them", async () => {
  serve({});
  render();
  await screen.findByRole("heading", { name: "Begin met waar je naartoe gaat" });
  expect(
    screen.getAllByRole("link").map((link) => link.getAttribute("href")?.split("#")[1]),
  ).toEqual(["areas", "stays", "routes"]);
});

it("stays out of the way once the trip has any record", async () => {
  serve({ stays: [{ id: "s" }] });
  render();
  // The lists load before the card could appear, so wait for them rather than for a heading.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole("heading")).toBeNull();
});
