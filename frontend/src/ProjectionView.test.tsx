// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { isProjection, ProjectionView, type Projection } from "./ProjectionView";
import { VisitorRoutes } from "./visitor-routes";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function projection(schema_version = "travel/public-trip@1"): Projection {
  return {
    schema_version, title: "Selected trip", summary: "Shared summary", navigation: [],
    route_stages: [], places: [], moments: [], stays: [], route: [], media: [], documents: [],
  };
}

it("renders every resource kind using only supplied fields", () => {
  const data = projection();
  data.route_stages = [{ id: "stage", label: "First stage", place: { label: "Broad city" }, private_address: "Hidden street" }];
  data.places = [{ id: "place", label: "Shared place", region: "Region", latitude: 5, owner_note: "Secret place note" }];
  data.moments = [{ id: "moment", title: "Shared moment", body: "Shared story", date_precision: "month", private_body: "Secret story" }];
  data.stays = [{ id: "stay", title: "Shared stay", place: { label: "Broad stay place" }, booking_reference: "Secret booking" }];
  data.route = [{ id: "route", label: "Shared route", geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] }, raw_track: "Secret track" }];
  data.media = [{ id: "media", image: { id: "media" }, original_filename: "Secret photo" }];
  data.documents = [{ id: "document", title: "Shared document", file: { id: "document" }, original_filename: "Secret PDF" }];
  data.navigation = [{ id: "place" }];
  const { container } = render(<ProjectionView projection={data} audience="public" identifier="safe-slug" />);
  for (const value of ["Shared summary", "First stage", "Broad city", "Shared place", "Region", "Shared moment", "Shared story", "Maandprecisie", "Shared stay", "Broad stay place", "Shared route", "Gedeeld medium", "Shared document"]) {
    expect(container.textContent).toContain(value);
  }
  for (const value of ["Hidden street", "Secret place note", "Secret story", "Secret booking", "Secret track", "Secret photo", "Secret PDF", "5"]) {
    expect(container.textContent).not.toContain(value);
  }
  expect(screen.getByRole("img", { name: "Gegeneraliseerde route" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Routebeschrijving" }).getAttribute("href")).toBe("/api/public/trips/safe-slug/navigation/place");
  expect(screen.getByRole("img", { name: "Gedeelde afbeelding" }).getAttribute("src")).toBe("/api/public/trips/safe-slug/files/media");
  expect(screen.getByRole("link", { name: "Document openen" }).getAttribute("href")).toBe("/api/public/trips/safe-slug/files/document");
});

it("does not invent values for omitted fields and keeps audience links separate", () => {
  const data = projection("travel/unlisted-trip@1");
  data.summary = null;
  data.route_stages = [{ id: "stage" }];
  data.media = [{ id: "media" }];
  data.documents = [{ id: "document" }];
  data.navigation = [{ id: "stage" }, { id: "exact_place-4" }];
  const { container } = render(<ProjectionView projection={data} audience="share" identifier="capability" />);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.queryByRole("link", { name: "Document openen" })).toBeNull();
  expect(container.textContent).not.toContain("Reisoverzicht");
  expect(screen.getAllByRole("link", { name: "Routebeschrijving" }).map((link) => link.getAttribute("href"))).toEqual([
    "/api/shared/capability/navigation/stage", "/api/shared/capability/navigation/exact_place-4",
  ]);
  expect(isProjection(data, "public")).toBe(false);
  expect(isProjection(data, "share")).toBe(true);
});

it("requests a fresh scoped projection after navigation and shows live edits", async () => {
  let title = "Before edit";
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ...projection(), title }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const first = render(<MemoryRouter initialEntries={["/trips/slug"]}><VisitorRoutes /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Before edit" });
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/public/trips/slug");
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
  first.unmount();
  title = "After edit";
  render(<MemoryRouter initialEntries={["/trips/slug"]}><VisitorRoutes /></MemoryRouter>);
  await screen.findByRole("heading", { name: "After edit" });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
});

it("uses only the unlisted endpoint and a uniform unavailable state", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter initialEntries={["/share/token"]}><VisitorRoutes /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Reis niet beschikbaar" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/shared/token");
  expect(document.body.textContent).not.toMatch(/ingetrokken|verlopen|onbekend/i);
});

it("renders a successful unlisted response without requesting public or owner data", async () => {
  const data = projection("travel/unlisted-trip@1");
  data.moments = [{ id: "moment_excerpt-1", body: "Shared excerpt" }];
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(data)));
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter initialEntries={["/share/token"]}><VisitorRoutes /></MemoryRouter>);
  await screen.findByText("Shared excerpt");
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/shared/token"]);
});
