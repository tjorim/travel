// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, beforeEach, expect, it } from "vitest";
import { changeLocale } from "./locale";
import { server } from "./mocks/server";
import { VisitorRoutes } from "./visitor-routes";

const token = "synthetic-collection-capability-0001";
const storageKey = "travel-saved-shared-trips@1";

const index = {
  schema_version: "travel/collection@1",
  title: "Shared with family",
  trips: [
    {
      id: "member-1",
      title: "Alpha Coast 2054",
      summary_text: "A synthetic summary.",
      dates: null,
      cover: null,
    },
    { id: "member-2", title: null, summary_text: null, dates: null, cover: "cover-1" },
  ],
};
const trip = {
  schema_version: "travel/unlisted-trip@1",
  title: "Alpha Coast 2054",
  summary: null,
  summary_html: null,
  summary_text: null,
  dates: null,
  cover: null,
  visits: [],
  places: [],
  updates: [],
  stays: [],
  media: [],
  routes: [],
  navigation: [],
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  act(() => changeLocale("nl"));
});

it("lists the members a collection link grants and opens each at its own page", async () => {
  server.use(http.get(`/api/shared/${token}`, () => HttpResponse.json(index)));
  render(<VisitorRoutes initialEntries={[`/share/${token}`]} />);
  expect(await screen.findByRole("heading", { level: 1, name: "Shared with family" })).toBeTruthy();
  const link = screen.getByRole("link", { name: /Alpha Coast 2054/ });
  expect(link.getAttribute("href")).toBe(`/share/${token}/trips/member-1`);
  // A member that shows nothing is still listed, with a generic name and its permitted cover.
  expect(screen.getByRole("link", { name: /Gedeelde reis.*Bekijk/ }).getAttribute("href")).toBe(
    `/share/${token}/trips/member-2`,
  );
  expect(document.querySelector("img")?.getAttribute("src")).toBe(
    `/api/shared/${token}/trips/member-2/files/cover-1`,
  );
  // Saved on this browser, with the collection's delivered title and no summary.
  expect(JSON.parse(localStorage.getItem(storageKey) ?? "[]")).toMatchObject([
    { token, title: "Shared with family", summary: null },
  ]);
  expect(
    screen.getByRole("heading", { name: "Deze link is bewaard in deze browser" }),
  ).toBeTruthy();
});

it("renders a member trip through the projection and links back without forgetting the collection", async () => {
  server.use(http.get(`/api/shared/${token}/trips/member-1`, () => HttpResponse.json(trip)));
  render(<VisitorRoutes initialEntries={[`/share/${token}/trips/member-1`]} />);
  expect(await screen.findByRole("heading", { name: "Alpha Coast 2054" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Alle reizen in deze link" }).getAttribute("href")).toBe(
    `/share/${token}`,
  );
  act(() => changeLocale("en"));
  expect(screen.getByRole("link", { name: "All trips in this link" })).toBeTruthy();
  expect(localStorage.getItem(storageKey)).toBeNull();
});

it("shows one unavailable page for a revoked collection and for a removed member", async () => {
  localStorage.setItem(
    storageKey,
    JSON.stringify([{ token, title: "Old", summary: null, lastVisitedAt: "2054-01-01T00:00:00Z" }]),
  );
  server.use(
    http.get(`/api/shared/${token}`, () => HttpResponse.json({}, { status: 404 })),
    http.get(`/api/shared/${token}/trips/gone`, () => HttpResponse.json({}, { status: 404 })),
  );
  const first = render(<VisitorRoutes initialEntries={[`/share/${token}/trips/gone`]} />);
  await screen.findByText("Reis niet beschikbaar");
  // A removed member does not forget the (possibly still valid) collection.
  expect(localStorage.getItem(storageKey)).not.toBeNull();
  first.unmount();
  render(<VisitorRoutes initialEntries={[`/share/${token}`]} />);
  await screen.findByText("Reis niet beschikbaar");
  expect(JSON.parse(localStorage.getItem(storageKey) ?? "[]")).toEqual([]);
});

it("shows an empty collection and validates a saved collection on the home page", async () => {
  server.use(http.get(`/api/shared/${token}`, () => HttpResponse.json({ ...index, trips: [] })));
  render(<VisitorRoutes initialEntries={[`/share/${token}`]} />);
  expect(await screen.findByText("Nog geen reizen hier")).toBeTruthy();
  cleanup();
  server.use(
    http.get("/api/public/trips", () => HttpResponse.json([])),
    http.get(`/api/shared/${token}`, () => HttpResponse.json(index)),
  );
  render(<VisitorRoutes initialEntries={["/trips"]} />);
  expect(await screen.findByText("Shared with family")).toBeTruthy();
  expect(screen.getByText("Verborgen reizen")).toBeTruthy();
});
