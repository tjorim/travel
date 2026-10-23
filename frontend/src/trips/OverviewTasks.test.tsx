// @vitest-environment happy-dom
import { createRootRoute } from "@tanstack/react-router";
import { cleanup, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { server } from "../mocks/server";
import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import type { Trip, TripTask } from "../tracker-model";
import { OverviewTasks } from "./OverviewTasks";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = {
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: "2054-11-16",
  ends_on: null,
  travel_updates: [],
};
const task = (id: string, title: string, extra: Partial<TripTask> = {}): TripTask => ({
  id,
  title,
  notes: null,
  due_date: null,
  remind_at: null,
  reminded_at: null,
  links: [],
  completed_at: null,
  created_at: "2054-09-01T00:00:00Z",
  ...extra,
});

const render = () =>
  renderRoutesWithOwner(createRootRoute({ component: () => <OverviewTasks trip={trip} /> }), ["/"]);

function serve(tasks: TripTask[] | number) {
  server.use(
    http.all("*", () =>
      typeof tasks === "number"
        ? HttpResponse.json({}, { status: tasks })
        : HttpResponse.json(tasks),
    ),
  );
}

beforeEach(() => {
  auth.session = { accessToken: testToken() };
});
afterEach(() => {
  cleanup();
});

it("lists the open tasks by deadline, tasks without one last, and hides finished ones", async () => {
  serve([
    task("a", "Reisverzekering"),
    task("b", "Visum regelen", { due_date: "2054-10-01" }),
    task("c", "Treinpas kopen", { due_date: "2054-09-20" }),
    task("d", "Oud", { completed_at: "2054-09-02T00:00:00Z" }),
  ]);
  render();
  await screen.findByText("Visum regelen");
  const titles = screen.getAllByRole("strong", { hidden: true }).map((node) => node.textContent);
  expect(titles).toEqual(["Treinpas kopen", "Visum regelen", "Reisverzekering"]);
  expect(screen.queryByText("Oud")).toBeNull();
  expect(screen.getByText("Geen deadline")).toBeTruthy();
});

it("shows at most five tasks and sends the owner to Prepare to manage them", async () => {
  serve(Array.from({ length: 8 }, (_, index) => task(`t${index}`, `Taak ${index}`)));
  render();
  await screen.findByText("Taak 0");
  expect(screen.getAllByText(/^Taak \d$/)).toHaveLength(5);
  const link = screen.getByRole("link", { name: "Beheren bij Voorbereiden" });
  expect(link.getAttribute("href")).toBe("/trips/trip/prepare#tasks");
});

it("says so when nothing is left to arrange, and when the tasks cannot be read", async () => {
  serve([]);
  render();
  expect(await screen.findByText("Niets meer te regelen.")).toBeTruthy();
  cleanup();
  serve(500);
  render();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Niets meer te regelen.")).toBeNull();
});
