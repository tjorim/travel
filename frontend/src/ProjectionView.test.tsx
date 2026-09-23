// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { isProjection, projectionMapLines, projectionMapPoints, ProjectionView, type Projection } from "./ProjectionView";
import { VisitorRoutes } from "./visitor-routes";
import { RenderedPreview } from "./trips/RenderedPreview";

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

function projection(schema_version = "travel/public-trip@1"): Projection {
  return {
    schema_version, title: "Selected trip", summary: "Shared summary", navigation: [],
    route_stages: [], places: [], moments: [], stays: [], route: [], media: [], documents: [],
  };
}

it("derives tile-facing map bounds only from scoped route geometry", () => {
  const data = projection("travel/unlisted-trip@1");
  data.places = [{ id: "selected-place", label: "Broad city", latitude: 25, longitude: 121 }, { id: "incomplete", latitude: 25 }];
  data.route_stages = [{ id: "selected-stage", place: { label: "Broad stage", latitude: 26, longitude: 122 } }];
  data.route = [{ id: "selected", label: "Selected route", geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] } }, { id: "unselected", label: "No shared geometry" }];
  expect(projectionMapLines(data)).toEqual([{ id: "selected", label: "Selected route", coordinates: [[1, 2], [3, 4]] }]);
  expect(projectionMapPoints(data)).toEqual([{ id: "selected-place", label: "Broad city", coordinates: [121, 25] }, { id: "selected-stage", label: "Broad stage", coordinates: [122, 26] }]);
});

it("lists only server supplied public cards and opens their stable slugs", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([
    { slug: "safe-slug", title: "Visible journey", summary: null },
    { slug: "hidden-title", title: null, summary: "Approved summary" },
  ])));
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter initialEntries={["/"]}><VisitorRoutes /></MemoryRouter>);
  expect(screen.getByRole("status").textContent).toContain("Reizen laden");
  const first = await screen.findByRole("link", { name: /Visible journey/ });
  expect(first.getAttribute("href")).toBe("/trips/safe-slug");
  expect(screen.getByRole("link", { name: /Gepubliceerde reis/ }).getAttribute("href")).toBe("/trips/hidden-title");
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/public/trips");
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", credentials: "omit" });
});

it("shows an empty index and retries a failed listing without using archive routes", async () => {
  let failed = true;
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => failed ? new Response(null, { status: 503 }) : new Response("[]"));
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter initialEntries={["/trips/"]}><VisitorRoutes /></MemoryRouter>);
  await screen.findByRole("alert");
  failed = false;
  screen.getByRole("button", { name: "Opnieuw proberen" }).click();
  await screen.findByRole("heading", { name: "Nog geen publieke reizen" });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/public/trips", "/api/public/trips"]);
});

it("does not treat former archive paths as visitor trips", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter initialEntries={["/exampleland-2054/"]}><VisitorRoutes /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: "Pagina niet beschikbaar" })).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

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
  for (const value of ["Shared summary", "First stage", "Broad city", "Shared place", "Region", "Shared moment", "Shared story", "Maandprecisie", "Shared stay", "Broad stay place", "Shared route", "Gedeelde foto’s", "Shared document"]) {
    expect(container.textContent).toContain(value);
  }
  for (const value of ["Hidden street", "Secret place note", "Secret story", "Secret booking", "Secret track", "Secret photo", "Secret PDF", "5"]) {
    expect(container.textContent).not.toContain(value);
  }
  expect(screen.getByRole("button", { name: "Shared route" })).toBeTruthy();
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

it("automatically saves a successfully visited hidden trip on this browser's homepage", async () => {
  const token = "oBj31R7FHNyTEx8Q6qFusqpBPpMDzhq1fb34nwAbCu0";
  const data = projection("travel/unlisted-trip@1");
  data.title = "Family trip";
  const fetcher = vi.fn(async (url: RequestInfo | URL) => {
    if (url === `/api/shared/${token}`) return new Response(JSON.stringify(data));
    return new Response("[]");
  });
  vi.stubGlobal("fetch", fetcher);

  const visited = render(<MemoryRouter initialEntries={[`/share/${token}`]}><VisitorRoutes /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Family trip" });
  visited.unmount();

  render(<MemoryRouter initialEntries={["/"]}><VisitorRoutes /></MemoryRouter>);
  const saved = await screen.findByRole("link", { name: /Family trip/ });
  expect(saved.getAttribute("href")).toBe(`/share/${token}`);
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen van dit apparaat" }));
  expect(screen.queryByRole("link", { name: /Family trip/ })).toBeNull();
});

it("renders dated moments in projection order with direct links and scoped photo galleries", () => {
  const data = projection("travel/unlisted-trip@1");
  data.moments = [
    { id: "moment-later", title: "Later", story_date: "2054-05", date_precision: "month", place: { label: "Broad coast" } },
    { id: "moment-first", title: "First", story_date: "2054-04-02", date_precision: "day", body: "Shared text" },
  ];
  data.media = [
    { id: "media-1", image: { id: "media-1" }, moment: "moment-first", caption: "At the station", alt_text: "Train platform", width: 900, height: 600, focal_x: 25, focal_y: 60 },
    { id: "media-2", image: { id: "media-2" }, caption: "Elsewhere", alt_text: "Trees" },
  ];
  const { container } = render(<ProjectionView projection={data} audience="share" identifier="token" />);
  expect(screen.getByRole("navigation", { name: "Momenten in dit verhaal" }).querySelectorAll("a")[1]?.getAttribute("href")).toBe("#moment-moment-first");
  expect(container.querySelectorAll(".visitor-timeline > li")[1]?.id).toBe("moment-moment-first");
  expect(screen.getByText("Broad coast")).toBeTruthy();
  expect(screen.getByText("2 april 2054")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Train platform" }).getAttribute("src")).toBe("/api/shared/token/files/media-1");
  expect(screen.getByRole("img", { name: "Train platform" }).getAttribute("style")).toContain("25% 60%");
  expect(screen.getByText("At the station").closest(".visitor-timeline")).toBeTruthy();
  expect(screen.getByText("Elsewhere").closest(".visitor-timeline")).toBeNull();
});

it("keeps story-only, image-only, and empty projections readable", () => {
  const data = projection();
  data.title = null; data.summary = null;
  data.moments = [{ id: "moment-safe", body: "Story only" }];
  const first = render(<ProjectionView projection={data} audience="public" identifier="slug" />);
  expect(screen.getByText("Story only")).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  first.unmount();
  data.moments = []; data.media = [{ id: "photo", image: { id: "photo" }, alt_text: "Image only" }];
  const second = render(<ProjectionView projection={data} audience="public" identifier="slug" />);
  expect(screen.getByRole("img", { name: "Image only" })).toBeTruthy();
  second.unmount();
  data.media = [];
  render(<ProjectionView projection={data} audience="public" identifier="slug" />);
  expect(screen.getByRole("status").textContent).toContain("Nog geen gedeelde inhoud");
});

it("uses the visitor story renderer for an owner preview and requests only owner scoped resources", async () => {
  const data = projection("travel/unlisted-trip@1");
  data.moments = [{ id: "moment_excerpt-1", title: "Shared story", body: "Visitor text", private_body: "Owner secret" }];
  data.documents = [{ id: "document_derivative-2", title: "Shared document", file: { id: "document_derivative-2" } }];
  data.navigation = [{ id: "moment_excerpt-1" }];
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ url: "https://www.google.com/maps/dir/?api=1&destination=Taipei" })));
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(window, "open").mockImplementation(() => null);
  const session = { accessToken: "owner-token", expiresAt: Date.now() + 60_000 };
  const preview = render(<RenderedPreview projection={data} audience="share" tripId="trip" linkId="draft-link" session={session} />);
  const visitor = render(<ProjectionView projection={data} audience="share" identifier="live-token" />);
  for (const value of ["Shared story", "Visitor text", "Shared document", "Reisverhaal", "Routebeschrijving"]) {
    expect(preview.container.textContent).toContain(value);
    expect(visitor.container.textContent).toContain(value);
  }
  expect(preview.container.textContent).not.toContain("Owner secret");
  fireEvent.click(preview.container.querySelector(".visitor-resource-action")!);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/trips/trip/share-links/draft-link/preview/navigation/moment_excerpt-1");
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit", cache: "no-store", headers: { Authorization: "Bearer owner-token" } });
});

it("renders the same scoped gallery in preview without requesting a visitor file URL", () => {
  const data = projection();
  data.moments = [{ id: "moment-1", title: "Arrival" }];
  data.media = [{ id: "photo-1", image: { id: "photo-1" }, moment: "moment-1", caption: "Station", alt_text: "Platform", focal_x: 20, focal_y: 70 }];
  const visitor = render(<ProjectionView projection={data} audience="public" identifier="slug" />);
  const preview = render(<ProjectionView projection={data} audience="public" identifier="" previewResources={{ images: { "photo-1": "blob:owner-preview" }, openFile: vi.fn(), openNavigation: vi.fn() }} />);
  expect(visitor.container.querySelector(".visitor-timeline .visitor-gallery")?.textContent).toContain("Station");
  expect(preview.container.querySelector(".visitor-timeline .visitor-gallery")?.textContent).toContain("Station");
  expect(preview.container.querySelector("img")?.getAttribute("src")).toBe("blob:owner-preview");
  expect(preview.container.innerHTML).not.toContain("/api/public/trips/");
});
