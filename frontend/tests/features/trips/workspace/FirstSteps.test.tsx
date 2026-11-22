import { responseFixtures } from "@/mocks/response-test-fixtures";
import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { createRootRoute } from "@tanstack/react-router";
import { cleanup, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { server } from "@/mocks/server";
import { renderRoutesWithOwner, testToken } from "../../../utils/query-test-utils";
import type { Area, Trip } from "@/api-types";
import { FirstSteps } from "@/features/trips/workspace/FirstSteps";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("@/app/providers/auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = {
  owner_subject: "owner-1",
  content_language: "nl",
  cover_derivative_id: null,
  cover_url: null,
  summary_html: null,
  id: "trip",
  title: "Exampleland",
  translation_freshness: {},
  title_nl: "Exampleland",
  title_en: null,
  summary: null,
  summary_nl: null,
  summary_en: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [],
};

const render = (areas: Area[] = []) =>
  renderRoutesWithOwner(
    createRootRoute({ component: () => <FirstSteps trip={trip} areas={areas} /> }),
    ["/"],
  );

function serve(records: {
  visits?: Api.VisitResponse[];
  stays?: Api.StayResponse[];
  routes?: Api.RouteResponse[];
}) {
  server.use(
    http.get("*/api/trips/trip/visits", () =>
      HttpResponse.json<Api.VisitResponse[]>(records.visits ?? []),
    ),
    http.get("*/api/trips/trip/stays", () =>
      HttpResponse.json<Api.StayResponse[]>(records.stays ?? []),
    ),
    http.get("*/api/trips/trip/routes", () =>
      HttpResponse.json<Api.RouteResponse[]>(records.routes ?? []),
    ),
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
  serve({ stays: [{ ...responseFixtures.StayResponse, id: "s" }] });
  render();
  // The lists load before the card could appear, so wait for them rather than for a heading.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole("heading")).toBeNull();
});
