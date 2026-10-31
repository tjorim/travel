// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  isProjection,
  projectionMapLines,
  projectionMapPoints,
  ProjectionView,
  visitTimes,
  type Projection,
} from "./ProjectionView";
import { timeForViewer, type ShareScope } from "./tracker-model";
import { VisitorRoutes } from "./visitor-routes";
import { RenderedPreview } from "./trips/RenderedPreview";
import { serveApi } from "./query/serve-api";

const previewScope: ShareScope = {
  schema_version: "travel/share-scope@1",
  trip: { title: true, summary: true, dates: null },
  items: [],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function projection(schema_version = "travel/public-trip@1"): Projection {
  return {
    schema_version,
    title: "Selected trip",
    summary: "Shared summary",
    dates: null,
    navigation: [],
    visits: [],
    places: [],
    updates: [],
    stays: [],
    routes: [],
    media: [],
  };
}

it("renders shared video with a poster, controls and no eager download", () => {
  const data = projection();
  data.media = [
    {
      id: "media-video",
      video: { id: "media-video" },
      poster: { id: "media-video-poster" },
      alt_text: "Coastline",
      caption: "At the shore",
      width: 640,
      height: 360,
    },
  ];
  const view = render(
    <ProjectionView projection={data} audience="public" identifier="safe-slug" />,
  );
  const video = view.container.querySelector("video")!;
  expect(video.getAttribute("controls")).not.toBeNull();
  expect(video.getAttribute("preload")).toBe("none");
  expect(video.hasAttribute("autoplay")).toBe(false);
  expect(video.getAttribute("poster")).toBe("/api/public/trips/safe-slug/files/media-video-poster");
  expect(video.querySelector("source")?.getAttribute("src")).toBe(
    "/api/public/trips/safe-slug/files/media-video",
  );
  expect(view.container.textContent).toContain("At the shore");
});

it("derives tile-facing map bounds only from scoped route geometry", () => {
  const data = projection("travel/unlisted-trip@1");
  data.places = [
    { id: "selected-place", label: "Area city", latitude: 25, longitude: 121 },
    { id: "incomplete", latitude: 25 },
  ];
  data.visits = [
    { id: "selected-visit", place: { label: "Area stage", latitude: 26, longitude: 122 } },
  ];
  data.routes = [
    {
      id: "selected",
      label: "Selected route",
      geometry: {
        type: "LineString",
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      },
    },
    { id: "unselected", label: "No shared geometry" },
  ];
  expect(projectionMapLines(data)).toEqual([
    {
      id: "selected",
      label: "Selected route",
      coordinates: [
        [1, 2],
        [3, 4],
      ],
      transport: "other",
    },
  ]);
  expect(projectionMapPoints(data)).toEqual([
    { id: "selected-place", label: "Area city", coordinates: [121, 25] },
    { id: "selected-visit", label: "Area stage", coordinates: [122, 26] },
  ]);
});

it("draws a drawn line as is, otherwise a straight line between the two areas of the route", () => {
  const data = projection("travel/unlisted-trip@1");
  const departure = { label: "Brussels", latitude: 50.85, longitude: 4.35 },
    arrival = { label: "Amsterdam", latitude: 52.37, longitude: 4.9 };
  data.routes = [
    {
      id: "leg",
      mode: "train",
      status: "planned",
      carrier: "Eurostar",
      service_reference: "ES 9167",
      departure,
      arrival,
    },
  ];
  expect(projectionMapLines(data)).toEqual([
    {
      id: "route-leg",
      label: "Eurostar · ES 9167",
      coordinates: [
        [4.35, 50.85],
        [4.9, 52.37],
      ],
      transport: "train",
      from: "Brussels",
      to: "Amsterdam",
    },
  ]);

  // The owner's drawn line wins, without a second straight line beside it.
  data.routes = [
    {
      id: "rail-track",
      label: "Eurostar route",
      mode: "train",
      departure,
      arrival,
      geometry: {
        type: "LineString",
        coordinates: [
          [4.1, 50.7],
          [4.6, 51.5],
          [5.1, 52.5],
        ],
      },
    },
  ];
  expect(projectionMapLines(data)).toEqual([
    {
      id: "rail-track",
      label: "Eurostar route",
      coordinates: [
        [4.1, 50.7],
        [4.6, 51.5],
        [5.1, 52.5],
      ],
      transport: "train",
    },
  ]);

  // An end without a point cannot be drawn, and a cancelled route is not drawn at all.
  data.routes = [
    { id: "loose", mode: "train", departure: { label: "Brussels" }, arrival },
    { id: "cancelled", mode: "train", status: "cancelled", departure, arrival },
  ];
  expect(projectionMapLines(data)).toEqual([]);
});

it("shows explicitly shared transport endpoints as map points and uses them for a generalized line", () => {
  const data = projection("travel/unlisted-trip@1");
  data.routes = [
    {
      id: "flight",
      mode: "flight",
      status: "confirmed",
      carrier: "EVA Air",
      service_reference: "BR 75",
      departure: { label: "Amsterdam" },
      arrival: { label: "Taipei" },
      map: {
        departure: {
          label: "Amsterdam Schiphol",
          latitude: 52.31,
          longitude: 4.76,
          kind: "airport",
        },
        arrival: {
          label: "Taoyuan Airport",
          latitude: 25.0797,
          longitude: 121.2328,
          kind: "airport",
        },
      },
    },
  ];
  expect(projectionMapPoints(data)).toEqual([
    {
      id: "transport-flight-departure",
      label: "Amsterdam Schiphol",
      coordinates: [4.76, 52.31],
      kind: "airport",
    },
    {
      id: "transport-flight-arrival",
      label: "Taoyuan Airport",
      coordinates: [121.2328, 25.0797],
      kind: "airport",
    },
  ]);
  expect(projectionMapLines(data)).toEqual([
    {
      id: "route-flight",
      label: "EVA Air · BR 75",
      coordinates: [
        [4.76, 52.31],
        [121.2328, 25.0797],
      ],
      transport: "flight",
      from: "Amsterdam Schiphol",
      to: "Taoyuan Airport",
    },
  ]);
});

it("links map cards only to records supplied in the visitor projection", () => {
  const data = projection();
  data.places = [{ id: "lisbon", label: "Lisbon", latitude: 38, longitude: -9 }];
  data.visits = [
    {
      id: "visit",
      title: "Arrival",
      place: { label: "Lisbon", latitude: 38, longitude: -9 },
      starts_on: "2054-09",
      date_precision: "month",
    },
  ];
  data.updates = [
    {
      id: "update",
      title: "First day",
      place: { label: "Lisbon", latitude: 38, longitude: -9 },
      story_date: "2054-09",
      date_precision: "month",
    },
  ];
  data.routes = [
    {
      id: "route",
      label: "To Coimbra",
      mode: "train",
      departure: { label: "Lisbon", latitude: 38, longitude: -9 },
      arrival: { label: "Coimbra", latitude: 40, longitude: -8 },
    },
  ];
  render(<ProjectionView projection={data} audience="public" identifier="trip" />);
  fireEvent.click(screen.getByRole("button", { name: "Lisbon" }));
  expect(screen.getByRole("link", { name: "Bezoek: Arrival" }).getAttribute("href")).toBe(
    "#visit-visit",
  );
  expect(screen.getByRole("link", { name: "Update: First day" }).getAttribute("href")).toBe(
    "#update",
  );
  expect(document.getElementById("visit-visit")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /To Coimbra/ }));
  expect(screen.getByRole("link", { name: "Route bekijken" }).getAttribute("href")).toBe(
    "#route-route",
  );
  expect(document.getElementById("route-route")).toBeTruthy();
});

it("lists only server supplied public cards and opens their stable slugs", async () => {
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify([
          { slug: "safe-slug", title: "Visible journey", summary: null },
          { slug: "hidden-title", title: null, summary: "Approved summary" },
        ]),
      ),
  );
  const sent = serveApi(fetcher);
  render(<VisitorRoutes initialEntries={["/"]} />);
  expect((await screen.findByRole("status")).textContent).toContain("Reizen laden");
  const first = await screen.findByRole("link", { name: /Visible journey/ });
  expect(first.getAttribute("href")).toBe("/trips/safe-slug");
  expect(screen.getByRole("link", { name: /Gepubliceerde reis/ }).getAttribute("href")).toBe(
    "/trips/hidden-title",
  );
  expect(screen.getByRole("link", { name: "Mijn reizen beheren" }).getAttribute("href")).toBe(
    "/admin/",
  );
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/public/trips");
  expect(sent.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", credentials: "omit" });
});

it("shows an empty index and retries a failed listing without using archive routes", async () => {
  let failed = true;
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    failed ? new Response(null, { status: 503 }) : new Response("[]"),
  );
  serveApi(fetcher);
  render(<VisitorRoutes initialEntries={["/trips/"]} />);
  await screen.findByRole("alert");
  failed = false;
  screen.getByRole("button", { name: "Opnieuw proberen" }).click();
  await screen.findByRole("heading", { name: "Nog geen publieke reizen" });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/api/public/trips",
    "/api/public/trips",
  ]);
});

it("does not treat former archive paths as visitor trips", async () => {
  const fetcher = vi.fn();
  serveApi(fetcher);
  render(<VisitorRoutes initialEntries={["/exampleland-2054/"]} />);
  expect(await screen.findByRole("heading", { name: "Pagina niet beschikbaar" })).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

it("renders every resource kind using only supplied fields", () => {
  const data = projection();
  data.visits = [
    {
      id: "visit",
      title: "First stage",
      place: { label: "Area city" },
      private_address: "Hidden street",
    },
  ];
  data.places = [
    {
      id: "place",
      label: "Shared place",
      region: "Region",
      latitude: 17.123456,
      owner_note: "Secret place note",
    },
  ];
  data.updates = [
    {
      id: "update-shared",
      title: "Shared update",
      body: "Shared story",
      date_precision: "month",
      private_body: "Secret story",
    },
  ];
  data.stays = [
    {
      id: "stay",
      title: "Shared stay",
      place: { label: "Area stay place" },
      date_precision: "month",
      starts_on: "2054-11",
      ends_on: "2054-11",
      booking_reference: "Secret booking",
    },
  ];
  data.routes = [
    {
      id: "leg",
      mode: "flight",
      status: "confirmed",
      carrier: "EVA Air",
      service_reference: "BR-087",
      departure: { locality: "Zaventem", country_code: "BE", display_name: "Brussels Airport" },
      arrival: { locality: "Taoyuan", country_code: "TW", display_name: "Taoyuan Airport" },
      departs_at: "2054-04-01T09:00:00Z",
      arrives_at: "2054-04-01T23:00:00Z",
      booking_reference: "Secret booking",
    },
  ];
  data.routes.push({
    id: "route",
    label: "Shared route",
    geometry: {
      type: "LineString",
      coordinates: [
        [1, 2],
        [3, 4],
      ],
    },
    raw_track: "Secret track",
    mode: "train",
    departure: { label: "Shared start" },
    arrival: { label: "Shared end" },
  });
  data.media = [{ id: "media", image: { id: "media" }, original_filename: "Secret photo" }];
  data.navigation = [{ id: "place" }];
  const { container } = render(
    <ProjectionView projection={data} audience="public" identifier="safe-slug" />,
  );
  for (const value of [
    "Shared summary",
    "First stage",
    "Area city",
    "Shared place",
    "Region",
    "Shared update",
    "Shared story",
    "Maandprecisie",
    "Shared stay",
    "Area stay place",
    "Routes",
    "Vlucht",
    "EVA Air",
    "BR-087",
    "Zaventem",
    "Taoyuan",
    "Bevestigd",
    "Shared route",
  ]) {
    expect(container.textContent).toContain(value);
  }
  // The loose gallery sits under its own "Galerij" heading and is named once, for assistive technology.
  expect(screen.getByRole("region", { name: "Gedeelde foto’s" })).toBeTruthy();
  for (const value of ["Secret booking", "Brussels Airport", "Taoyuan Airport"])
    expect(container.textContent).not.toContain(value);
  for (const value of [
    "Hidden street",
    "Secret place note",
    "Secret story",
    "Secret booking",
    "Secret track",
    "Secret photo",
    "Secret PDF",
    "17.123456",
  ]) {
    expect(container.textContent).not.toContain(value);
  }
  expect(screen.getByRole("button", { name: /Shared route/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Routebeschrijving" }).getAttribute("href")).toBe(
    "/api/public/trips/safe-slug/navigation/place",
  );
  expect(screen.getByRole("img", { name: "Gedeelde afbeelding" }).getAttribute("src")).toBe(
    "/api/public/trips/safe-slug/files/media",
  );
});

it("shows a shared route's day while it has no times", () => {
  const data = projection();
  data.routes = [
    {
      id: "north",
      mode: "train",
      label: "Naar het noorden",
      departure: { label: "Kaohsiung" },
      arrival: { label: "Taipei" },
      departs_on: "2054-12-05",
    },
  ];
  const { container } = render(
    <ProjectionView projection={data} audience="public" identifier="safe-slug" />,
  );
  expect(container.textContent).toContain("5 december 2054");
  expect(container.textContent).not.toContain("Vertrektijd onbekend");
});

it("does not invent values for omitted fields and keeps audience links separate", () => {
  const data = projection("travel/unlisted-trip@1");
  data.summary = null;
  data.places = [{ id: "place-1" }];
  data.media = [{ id: "media" }];
  data.navigation = [{ id: "place-1" }, { id: "location-4" }];
  const { container } = render(
    <ProjectionView projection={data} audience="share" identifier="capability" />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).not.toContain("Reisoverzicht");
  expect(
    screen
      .getAllByRole("link", { name: "Routebeschrijving" })
      .map((link) => link.getAttribute("href")),
  ).toEqual([
    "/api/shared/capability/navigation/place-1",
    "/api/shared/capability/navigation/location-4",
  ]);
  expect(isProjection(data, "public")).toBe(false);
  expect(isProjection(data, "share")).toBe(true);
});

it("requests a fresh scoped projection after navigation and shows live edits", async () => {
  let title = "Before edit";
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ...projection(), title }), { status: 200 }),
  );
  const sent = serveApi(fetcher);
  const first = render(<VisitorRoutes initialEntries={["/trips/slug"]} />);
  await screen.findByRole("heading", { name: "Before edit" });
  expect(screen.getByRole("link", { name: "Mijn reizen beheren" }).getAttribute("href")).toBe(
    "/admin/",
  );
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/public/trips/slug");
  expect(sent.mock.calls[0]?.[1]).toMatchObject({
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  first.unmount();
  title = "After edit";
  render(<VisitorRoutes initialEntries={["/trips/slug"]} />);
  await screen.findByRole("heading", { name: "After edit" });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
});

it("uses only the unlisted endpoint and a uniform unavailable state", async () => {
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 404 }),
  );
  serveApi(fetcher);
  render(<VisitorRoutes initialEntries={["/share/token"]} />);
  await screen.findByRole("heading", { name: "Reis niet beschikbaar" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/shared/token");
  expect(document.body.textContent).not.toMatch(/ingetrokken|verlopen|onbekend/i);
});

it("renders a successful unlisted response without requesting public or owner data", async () => {
  const data = projection("travel/unlisted-trip@1");
  data.updates = [{ id: "update-1", body: "Shared update text" }];
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(data)),
  );
  serveApi(fetcher);
  render(<VisitorRoutes initialEntries={["/share/token"]} />);
  await screen.findByText("Shared update text");
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
  serveApi(fetcher);

  const visited = render(<VisitorRoutes initialEntries={[`/share/${token}`]} />);
  await screen.findByRole("heading", { name: "Family trip" });
  visited.unmount();

  render(<VisitorRoutes initialEntries={["/"]} />);
  const saved = await screen.findByRole("link", { name: /Family trip/ });
  expect(saved.getAttribute("href")).toBe(`/share/${token}`);
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen van dit apparaat" }));
  expect(screen.queryByRole("link", { name: /Family trip/ })).toBeNull();
});

it("renders dated updates in projection order with direct links and scoped photo galleries", () => {
  const data = projection("travel/unlisted-trip@1");
  data.updates = [
    {
      id: "update-later",
      title: "Later",
      story_date: "2054-05",
      date_precision: "month",
      place: { label: "Area coast" },
    },
    {
      id: "update-first",
      title: "First",
      story_date: "2054-04-02",
      date_precision: "day",
      body: "Shared text",
    },
  ];
  data.media = [
    {
      id: "media-1",
      image: { id: "media-1" },
      update: "update-first",
      caption: "At the station",
      alt_text: "Train platform",
      width: 900,
      height: 600,
      focal_x: 25,
      focal_y: 60,
    },
    { id: "media-2", image: { id: "media-2" }, caption: "Elsewhere", alt_text: "Trees" },
  ];
  const { container } = render(
    <ProjectionView projection={data} audience="share" identifier="token" />,
  );
  expect(
    screen
      .getByRole("navigation", { name: "Updates in dit verhaal" })
      .querySelectorAll("a")[1]
      ?.getAttribute("href"),
  ).toBe("#update-first");
  expect(container.querySelectorAll('ol[aria-label="Reisupdates tijdlijn"] > li')[1]?.id).toBe(
    "update-first",
  );
  // The story shows its place, and the header lists the same area as a destination.
  expect(screen.getAllByText("Area coast")).toHaveLength(2);
  expect(screen.getByText("2 april 2054")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Train platform" }).getAttribute("src")).toBe(
    "/api/shared/token/files/media-1",
  );
  expect(screen.getByRole("img", { name: "Train platform" }).getAttribute("style")).toContain(
    "25% 60%",
  );
  expect(
    screen.getByText("At the station").closest('ol[aria-label="Reisupdates tijdlijn"]'),
  ).toBeTruthy();
  expect(screen.getByText("Elsewhere").closest('ol[aria-label="Reisupdates tijdlijn"]')).toBeNull();
});

it("says how many days passed between updates dated to the day, and nothing otherwise", () => {
  const data = projection("travel/unlisted-trip@1");
  data.updates = [
    { id: "u1", title: "One", story_date: "2054-04-02", date_precision: "day" },
    { id: "u2", title: "Two", story_date: "2054-04-03", date_precision: "day" },
    { id: "u3", title: "Same day", story_date: "2054-04-03", date_precision: "day" },
    { id: "u4", title: "Month only", story_date: "2054-05", date_precision: "month" },
    { id: "u5", title: "After a month", story_date: "2054-05-09", date_precision: "day" },
  ];
  render(<ProjectionView projection={data} audience="share" identifier="token" />);
  // Dutch is the default test locale: one day takes the singular, and neither a same-day pair nor a month does a count.
  expect(screen.getAllByText(/ dag(en)? later$/i).map((node) => node.textContent)).toEqual([
    "1 dag later",
  ]);
});

it("keeps story-only, image-only, and empty projections readable", () => {
  const data = projection();
  data.title = null;
  data.summary = null;
  data.updates = [{ id: "update-safe", body: "Story only" }];
  const first = render(<ProjectionView projection={data} audience="public" identifier="slug" />);
  expect(screen.getByText("Story only")).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  first.unmount();
  data.updates = [];
  data.media = [{ id: "photo", image: { id: "photo" }, alt_text: "Image only" }];
  const second = render(<ProjectionView projection={data} audience="public" identifier="slug" />);
  expect(screen.getByRole("img", { name: "Image only" })).toBeTruthy();
  second.unmount();
  data.media = [];
  render(<ProjectionView projection={data} audience="public" identifier="slug" />);
  expect(screen.getByRole("status").textContent).toContain("Nog geen gedeelde inhoud");
});

it("uses the visitor story renderer for an owner preview and requests only owner scoped resources", async () => {
  const data = projection("travel/unlisted-trip@1");
  data.updates = [
    { id: "update-1", title: "Shared story", body: "Visitor text", private_body: "Owner secret" },
  ];
  data.places = [{ id: "area-1", label: "Taipei" }];
  data.navigation = [{ id: "area-1" }];
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ url: "https://www.google.com/maps/dir/?api=1&destination=Taipei" }),
      ),
  );
  const sent = serveApi(fetcher);
  vi.spyOn(window, "open").mockImplementation(() => null);
  const session = { accessToken: "owner-token", expiresAt: Date.now() + 60_000 };
  const preview = render(
    <RenderedPreview
      projection={data}
      audience="share"
      tripId="trip"
      linkId="draft-link"
      scope={previewScope}
      session={session}
    />,
  );
  const visitor = render(
    <ProjectionView projection={data} audience="share" identifier="live-token" />,
  );
  for (const value of ["Shared story", "Visitor text", "Reisupdates", "Routebeschrijving"]) {
    expect(preview.container.textContent).toContain(value);
    expect(visitor.container.textContent).toContain(value);
  }
  expect(preview.container.textContent).not.toContain("Owner secret");
  fireEvent.click(screen.getByRole("button", { name: "Routebeschrijving" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    "/api/trips/trip/share-links/draft-link/preview/navigation/area-1",
  );
  expect(sent.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: { Authorization: "Bearer owner-token" },
  });
});

it("renders the same scoped gallery in preview without requesting a visitor file URL", () => {
  const data = projection();
  data.updates = [{ id: "update-1", title: "Arrival" }];
  data.media = [
    {
      id: "photo-1",
      image: { id: "photo-1" },
      update: "update-1",
      caption: "Station",
      alt_text: "Platform",
      focal_x: 20,
      focal_y: 70,
    },
  ];
  const visitor = render(<ProjectionView projection={data} audience="public" identifier="slug" />);
  const preview = render(
    <ProjectionView
      projection={data}
      audience="public"
      identifier=""
      previewResources={{
        images: { "photo-1": "blob:owner-preview" },
        openFile: vi.fn(),
        openNavigation: vi.fn(),
      }}
    />,
  );
  expect(
    visitor.container.querySelector(
      'ol[aria-label="Reisupdates tijdlijn"] section[aria-label="Media bij deze update"]',
    )?.textContent,
  ).toContain("Station");
  expect(
    preview.container.querySelector(
      'ol[aria-label="Reisupdates tijdlijn"] section[aria-label="Media bij deze update"]',
    )?.textContent,
  ).toContain("Station");
  expect(preview.container.querySelector("img")?.getAttribute("src")).toBe("blob:owner-preview");
  expect(preview.container.innerHTML).not.toContain("/api/public/trips/");
});

it("shows shared trip dates and visit summaries only from the projection", () => {
  const data = projection();
  data.dates = { id: "dates", starts_on: "2054-11", ends_on: "2054-12", date_precision: "month" };
  data.visits = [{ id: "visit-3", title: "Taipei", summary: "Stad, eten en een eerste weekend." }];
  render(<ProjectionView projection={data} audience="public" identifier="slug" />);
  expect(screen.getByText("november 2054 – december 2054")).toBeTruthy();
  expect(screen.getByText("Stad, eten en een eerste weekend.")).toBeTruthy();
  expect(isProjection({ ...data, dates: "2054" }, "public")).toBe(false);
  expect(isProjection({ ...data, updates: undefined }, "public")).toBe(false);
});

it("shows a visit with its days, its place and a time only when it was shared", () => {
  const data = projection();
  data.visits = [
    {
      id: "visit-1",
      title: "Nachtmarkt",
      place: { label: "Taipei" },
      date_precision: "day",
      starts_on: "2054-11-21",
      ends_on: "2054-11-22",
      start_time: "18:30",
      end_time: "21:00",
      timezone: "Asia/Taipei",
    },
    {
      id: "visit-2",
      title: "Warme bron",
      place: { label: "Beitou" },
      date_precision: "day",
      starts_on: "2054-11-23",
      ends_on: null,
    },
  ];
  render(<ProjectionView projection={data} audience="public" identifier="slug" />);
  expect(screen.getByRole("heading", { name: "Bezoeken" })).toBeTruthy();
  expect(screen.getByText(/18:30–21:00 \(Taipei\)/)).toBeTruthy();
  expect(screen.getByText("Taipei")).toBeTruthy();
  expect(screen.queryByText(/Hidden/)).toBeNull();
  // Without a shared time nothing is invented.
  expect(screen.getByText("Warme bron").closest("article")?.textContent).not.toMatch(/\d\d:\d\d/);
});

it("reads a visit time in the viewer's own zone, with the day when it moves", () => {
  // 18:30 in Taipei (UTC+8) is 11:30 in Amsterdam (UTC+1) in November, and 02:00 in Taipei is 19:00 the day before.
  expect(timeForViewer("2054-11-21", "18:30", "Asia/Taipei", "Europe/Amsterdam")).toEqual({
    time: "11:30",
    days: 0,
  });
  expect(timeForViewer("2054-11-21", "02:00", "Asia/Taipei", "Europe/Amsterdam")).toEqual({
    time: "19:00",
    days: -1,
  });
  expect(timeForViewer("2054-11-21", "18:30", "Asia/Taipei", "Asia/Taipei")).toBeNull();
  expect(timeForViewer("2054-11-21", "18:30", "Not/AZone", "Europe/Amsterdam")).toBeNull();
  expect(
    visitTimes({
      id: "v",
      start_time: "18:30",
      end_time: "21:00",
      starts_on: "2054-11-21",
      timezone: "Asia/Taipei",
    }),
  ).toMatch(/^18:30–21:00 \(Taipei\)( · bij jou \d\d:\d\d–\d\d:\d\d)?/);
  expect(visitTimes({ id: "v", start_time: "18:30" })).toBe("18:30");
  expect(visitTimes({ id: "v" })).toBeNull();
});

it("shows the server's sanitized Markdown and falls back to plain source text", () => {
  const data = projection();
  data.summary = "**Two** weeks";
  data.summary_html = "<p><strong>Two</strong> weeks</p>\n";
  data.visits = [
    {
      id: "visit-1",
      title: "Taipei",
      summary: "- [x] tea",
      summary_html:
        '<ul class="contains-task-list"><li class="task-list-item"><input class="task-list-item-checkbox" checked="checked" type="checkbox" disabled="disabled"> tea</li></ul>',
    },
  ];
  data.updates = [{ id: "update-1", title: "Arrival", body: "*Landed*" }];
  const view = render(
    <ProjectionView projection={data} audience="public" identifier="safe-slug" />,
  );
  expect(view.container.querySelector(".markdown strong")?.textContent).toBe("Two");
  const checkbox = view.container.querySelector<HTMLInputElement>(
    ".markdown input[type=checkbox]",
  )!;
  expect(checkbox.disabled).toBe(true);
  expect(checkbox.checked).toBe(true);
  // Without rendered HTML the source is text, never markup.
  expect(view.container.querySelector("[data-markdown-source]")?.textContent).toBe("*Landed*");
  expect(view.container.querySelector("em")).toBeNull();
});

it("shows a card's one-line plain-text summary instead of its Markdown", async () => {
  serveApi(
    vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              slug: "safe-slug",
              title: "Journey",
              summary: "# Exampleland\n\n**Two** weeks",
              summary_text: "Exampleland Two weeks",
            },
          ]),
        ),
    ),
  );
  render(<VisitorRoutes initialEntries={["/"]} />);
  const card = await screen.findByRole("link", { name: /Journey/ });
  expect(card.querySelector("p")?.textContent).toBe("Exampleland Two weeks");
});

it("renders a caption's inline Markdown in its figcaption and falls back to its source", () => {
  const data = projection();
  data.media = [
    {
      id: "media-1",
      image: { id: "media-1" },
      caption: "**Night** market",
      caption_html: "<strong>Night</strong> market",
    },
    { id: "media-2", image: { id: "media-2" }, caption: "*Temple*" },
  ];
  const view = render(
    <ProjectionView projection={data} audience="public" identifier="safe-slug" />,
  );
  const [rendered, source] = Array.from(view.container.querySelectorAll("figcaption"));
  expect(rendered.querySelector("strong")?.textContent).toBe("Night");
  expect(rendered.querySelector("p, div")).toBeNull();
  expect(source.textContent).toBe("*Temple*");
  expect(source.querySelector("em")).toBeNull();
});

const coverData = (): Projection => ({
  ...projection(),
  dates: { id: "dates", starts_on: "2054-11-01", ends_on: "2054-11-21", date_precision: "day" },
  cover: "media-cover",
  visits: [{ id: "visit-1", title: "Harbour", place: { label: "Keelung" } }],
  media: [
    {
      id: "media-cover",
      image: { id: "media-cover" },
      alt_text: "Fishing boats",
      caption: "Dawn at the harbour",
      width: 1600,
      height: 900,
      focal_x: 30,
      focal_y: 70,
    },
  ],
});

it("opens the trip with its cover, title, dates and destinations", () => {
  render(<ProjectionView projection={coverData()} audience="public" identifier="safe-slug" />);

  const cover = screen.getAllByRole("img", { name: "Fishing boats" })[0];
  expect(cover.getAttribute("src")).toBe("/api/public/trips/safe-slug/files/media-cover");
  expect(cover.getAttribute("style")).toContain("30% 70%");
  expect(screen.getByRole("heading", { level: 1, name: "Selected trip" })).toBeTruthy();
  expect(screen.getByText("1 november 2054 – 21 november 2054")).toBeTruthy();
  expect(screen.getAllByText("Keelung")).toHaveLength(2); // in the header and under its visit
  // The cover keeps its caption; the photo also stays in the gallery, so the caption repeats once.
  expect(screen.getAllByText("Dawn at the harbour", { selector: "figcaption" })).toHaveLength(2);
});

it("falls back to the text-only header when there is no cover or the image fails", () => {
  const withoutCover = { ...coverData(), cover: null };
  const view = render(
    <ProjectionView projection={withoutCover} audience="public" identifier="safe-slug" />,
  );
  // The photo is still a gallery photo; only the header has no image.
  expect(view.container.querySelector("header img")).toBeNull();
  expect(screen.getByRole("heading", { level: 1, name: "Selected trip" })).toBeTruthy();
  view.unmount();

  // A cover that names no delivered photo (or a video) never produces an image.
  const unknown = { ...coverData(), cover: "media-other" };
  const other = render(
    <ProjectionView projection={unknown} audience="public" identifier="safe-slug" />,
  );
  expect(other.container.querySelector("header img")).toBeNull();
  other.unmount();

  const failing = render(
    <ProjectionView projection={coverData()} audience="public" identifier="safe-slug" />,
  );
  fireEvent.error(failing.container.querySelector("header img")!);
  expect(failing.container.querySelector("header img")).toBeNull();
  expect(screen.getByRole("heading", { level: 1, name: "Selected trip" })).toBeTruthy();
});

it("keeps a sparse, untitled trip readable and truncates a long list of destinations", () => {
  const data = projection();
  data.title = null;
  data.summary = null;
  data.visits = ["A", "B", "C", "D", "E", "F"].map((label) => ({
    id: `visit-${label}`,
    place: { label },
  }));
  render(<ProjectionView projection={data} audience="public" identifier="safe-slug" />);

  expect(screen.getByRole("heading", { level: 1, name: "Gedeelde reis" })).toBeTruthy();
  expect(screen.getByText(/A · B · C · D · \+2 meer/)).toBeTruthy();
});

it("draws the same header in an owner preview from the supplied cover file", () => {
  render(
    <ProjectionView
      projection={coverData()}
      audience="public"
      identifier=""
      previewResources={{
        images: { "media-cover": "blob:cover" },
        openFile: () => {},
        openNavigation: () => {},
      }}
    />,
  );

  expect(screen.getByRole("heading", { level: 2, name: "Selected trip" })).toBeTruthy();
  expect(screen.getAllByRole("img", { name: "Fishing boats" })[0].getAttribute("src")).toBe(
    "blob:cover",
  );
});

it("accepts a projection with or without a cover id and rejects a malformed one", () => {
  expect(isProjection(projection(), "public")).toBe(true);
  expect(isProjection({ ...projection(), cover: "media-1" }, "public")).toBe(true);
  expect(isProjection({ ...projection(), cover: null }, "public")).toBe(true);
  expect(isProjection({ ...projection(), cover: { id: "media-1" } }, "public")).toBe(false);
});

it("discloses all authored update anchors without changing history", async () => {
  const data = projection();
  data.updates = Array.from({ length: 24 }, (_, i) => ({
    id: `update-${i}`,
    title: `Authored ${i + 1}`,
  }));
  render(<ProjectionView projection={data} audience="public" identifier="slug" />);
  const trigger = screen.getByRole("button", { name: "Kies een update" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  const before = window.history.length;
  fireEvent.click(trigger);
  await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
  expect(window.history.length).toBe(before);
  expect(
    screen
      .getAllByRole("link", { name: "Authored 24" })
      .every((link) => link.getAttribute("href") === "#update-23"),
  ).toBe(true);
  expect(document.getElementById("update-23")?.tabIndex).toBe(-1);
});
