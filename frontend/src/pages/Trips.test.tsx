// @vitest-environment happy-dom
import { createRootRoute, createRoute } from "@tanstack/react-router";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import { parseFlagParam } from "../router/search-params";
import type { Trip } from "../tracker-model";
import { TripWorkspace, TripWorkspaceView } from "./TripWorkspace";
import { changeLocale } from "../locale";
import { Trips } from "./Trips";
import { serveApi } from "../query/serve-api";

const rootRoute = createRootRoute();
const tripsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "trips",
  component: Trips,
  validateSearch: (search: Record<string, unknown>): { new?: "1" } => ({
    new: parseFlagParam(search.new),
  }),
});
const tripRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "trips/$tripId",
  component: TripWorkspace,
});
const tripSectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "trips/$tripId/$section",
  component: TripWorkspace,
});
const routeTree = rootRoute.addChildren([tripsListRoute, tripRoute, tripSectionRoute]);

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));
// The managers and map have their own tests; this file covers trip selection and the trip editor.
vi.mock("../trips/DocumentManager", () => ({ DocumentManager: () => null }));
vi.mock("../trips/VisitManager", () => ({
  VisitManager: ({
    onShowOnMap,
    focusId,
  }: {
    onShowOnMap?: (id: string) => void;
    focusId?: { id: string } | null;
  }) => (
    <>
      <button type="button" onClick={() => onShowOnMap?.("p1")}>
        Toon op kaart
      </button>
      <p>Bezoekfocus {focusId?.id ?? "geen"}</p>
    </>
  ),
}));
vi.mock("../trips/AreaManager", () => ({ AreaManager: () => null }));
vi.mock("../trips/LocationManager", () => ({ LocationManager: () => null }));
vi.mock("../trips/TravelUpdateManager", () => ({ TravelUpdateManager: () => null }));
vi.mock("../trips/MediaManager", () => ({ MediaManager: () => null }));
vi.mock("../trips/OwnerTripMap", () => ({
  OwnerTripMap: ({ focus }: { focus?: { id: string } | null }) => (
    <p>Kaartfocus {focus?.id ?? "geen"}</p>
  ),
}));
vi.mock("../trips/PackingManager", () => ({ PackingManager: () => null }));
vi.mock("../trips/PublicationManager", () => ({ PublicationManager: () => null }));
vi.mock("../trips/RouteStageManager", () => ({ RouteStageManager: () => null }));
vi.mock("../trips/StayManager", () => ({
  StayManager: ({ focusId }: { focusId?: { id: string } | null }) => (
    <p>Verblijffocus {focusId?.id ?? "geen"}</p>
  ),
}));
vi.mock("../trips/RouteManager", () => ({
  RouteManager: ({ focusId }: { focusId?: { id: string } | null }) => (
    <p>Routefocus {focusId?.id ?? "geen"}</p>
  ),
}));
vi.mock("../trips/AgendaView", () => ({
  AgendaView: ({
    onOpenRecord,
  }: {
    onOpenRecord?: (kind: "stay" | "route" | "visit", id: string) => void;
  }) => (
    <button type="button" onClick={() => onOpenRecord?.("stay", "s1")}>
      Agendaregel openen
    </button>
  ),
}));
vi.mock("../trips/TripTaskManager", () => ({
  TripTaskManager: ({ focusId }: { focusId?: { id: string } | null }) => (
    <p>Taakfocus {focusId?.id ?? "geen"}</p>
  ),
}));
vi.mock("../library/LinkedLibraryDocuments", () => ({ LinkedLibraryDocuments: () => null }));
vi.mock("../trips/TripOverview", () => ({ TripOverview: () => null }));

const trip = (id: string, title: string, extra: Partial<Trip> = {}): Trip => ({
  id,
  title,
  summary: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [],
  ...extra,
});
let trips: Trip[];
let requests: string[];
let surfaceState: "published" | "unpublished";
const json = (value: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(value), { status }));

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  trips = [
    trip("t1", "Exampleland", { starts_on: "2054-11-16", ends_on: "2054-12-06" }),
    trip("t2", "IJsland"),
  ];
  requests = [];
  surfaceState = "unpublished";
  serveApi(
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      requests.push(`${method} ${url}`);
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url === "/api/trips" && method === "GET") return json(trips);
      if (url === "/api/trips" && method === "POST") {
        const created = trip("t3", String(body.title));
        trips = [...trips, created];
        return json(created, 201);
      }
      const match = /^\/api\/trips\/([^/]+)$/.exec(url);
      if (match && method === "PATCH") {
        trips = trips.map((item) =>
          item.id === match[1]
            ? {
                ...item,
                title: String(body.title),
                summary: (body.summary as string | null) ?? null,
              }
            : item,
        );
        return json(trips.find((item) => item.id === match[1]));
      }
      if (match && method === "DELETE") {
        trips = trips.filter((item) => item.id !== match[1]);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.endsWith("/areas")) return json([]);
      if (url.endsWith("/public-projection"))
        return json({ trip_id: "t1", scope: {}, surface_state: surfaceState, slug: null });
      throw new Error(`unexpected request ${method} ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  act(() => changeLocale("nl"));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The trip dialogs share labels with the managers' forms; scope to the dialog.
const editor = (name: "Reisgegevens" | "Nieuwe reis") =>
  within(screen.getByRole("dialog", { name }));
const openEditor = async () =>
  fireEvent.click(await screen.findByRole("button", { name: "Reisgegevens" }));
const renderTrips = (path = "/trips") => renderRoutesWithOwner(routeTree, [path]);

it("lists trips only, and opens a trip's workspace from its row", async () => {
  renderTrips();
  await screen.findByRole("link", { name: /Exampleland/ });
  // The list page no longer stacks a trip's content or editor under the list.
  expect(screen.queryByText("Private inhoud")).toBeNull();
  expect(screen.queryByRole("button", { name: "Reisgegevens" })).toBeNull();
  expect(screen.queryByLabelText("Titel")).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: /IJsland/ }));
  await screen.findByRole("heading", { name: "IJsland" });
  // The trip header says where the owner is: Trips › the trip.
  const here = within(screen.getByRole("navigation", { name: "Kruimelpad" }));
  expect(here.getByRole("link", { name: "Reizen" }).getAttribute("href")).toBe("/trips");
  expect(here.getByText("IJsland").getAttribute("aria-current")).toBe("page");
});

it("keeps the editor closed in the workspace until asked, then opens the trip with its saved values", async () => {
  renderTrips("/trips/t1");
  await screen.findByRole("heading", { name: "Exampleland" });
  expect(screen.getByRole("link", { name: "Volledige samenvatting" }).getAttribute("href")).toBe(
    "/trips/t1/details",
  );
  expect(screen.queryByRole("heading", { name: "Reisgegevens" })).toBeNull();
  await openEditor();
  await waitFor(() =>
    expect((editor("Reisgegevens").getByLabelText("Titel") as HTMLInputElement).value).toBe(
      "Exampleland",
    ),
  );
  expect(
    (editor("Reisgegevens").getByLabelText("Eerste reisdag (optioneel)") as HTMLInputElement).value,
  ).toBe("16 nov 2054");
});

it("shows the renamed trip in the workspace after saving, with one refreshed read", async () => {
  renderTrips("/trips/t1");
  await openEditor();
  await waitFor(() =>
    expect((editor("Reisgegevens").getByLabelText("Titel") as HTMLInputElement).value).toBe(
      "Exampleland",
    ),
  );
  fireEvent.change(editor("Reisgegevens").getByLabelText("Titel"), {
    target: { value: "Exampleland 2054" },
  });
  fireEvent.click(editor("Reisgegevens").getByRole("button", { name: "Reis opslaan" }));
  await screen.findByRole("heading", { name: "Exampleland 2054" });
  expect(screen.getByText("Reis opgeslagen.")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Reisgegevens" })).toBeNull();
  expect(requests.filter((request) => request === "GET /api/trips")).toHaveLength(2);
});

it("drops a deleted trip and returns to the list", async () => {
  renderTrips("/trips/t1");
  await openEditor();
  await waitFor(() =>
    expect((editor("Reisgegevens").getByLabelText("Titel") as HTMLInputElement).value).toBe(
      "Exampleland",
    ),
  );
  fireEvent.click(editor("Reisgegevens").getByRole("button", { name: "Reis verwijderen" }));
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );
  await screen.findByRole("heading", { name: "Reizen" });
  await waitFor(() => expect(screen.queryByRole("link", { name: /Exampleland/ })).toBeNull());
  expect(screen.getByRole("link", { name: /IJsland/ })).toBeTruthy();
  expect(screen.getByText("Reis verwijderd.")).toBeTruthy();
});

it("creates a trip and opens its workspace", async () => {
  renderTrips();
  await screen.findByRole("link", { name: /IJsland/ });
  fireEvent.click(screen.getByRole("button", { name: "Nieuwe reis" }));
  fireEvent.change(editor("Nieuwe reis").getByLabelText("Titel"), { target: { value: "Japan" } });
  fireEvent.click(editor("Nieuwe reis").getByRole("button", { name: "Reis maken" }));
  await screen.findByRole("heading", { name: "Japan" });
  expect(trips.map((item) => item.title)).toContain("Japan");
});

it("opens the new-trip dialog straight from the home page link", async () => {
  renderTrips("/trips?new=1");
  await waitFor(() =>
    expect((editor("Nieuwe reis").getByLabelText("Titel") as HTMLInputElement).value).toBe(""),
  );
});

it("rejects an end date before the start date without calling the server", async () => {
  renderTrips("/trips/t1");
  await openEditor();
  await waitFor(() =>
    expect((editor("Reisgegevens").getByLabelText("Titel") as HTMLInputElement).value).toBe(
      "Exampleland",
    ),
  );
  fireEvent.change(editor("Reisgegevens").getByLabelText("Laatste reisdag (optioneel)"), {
    target: { value: "2054-11-01" },
  });
  fireEvent.click(editor("Reisgegevens").getByRole("button", { name: "Reis opslaan" }));
  await screen.findByText("De laatste reisdag ligt vóór de eerste.");
  expect(requests.some((request) => request.startsWith("PATCH"))).toBe(false);
});

it("shows a step on the map by opening the overview, whose map focuses that point", async () => {
  renderTrips("/trips/t1/plan");
  fireEvent.click(await screen.findByRole("button", { name: /^Bezoeken/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Toon op kaart" }));
  await screen.findByText("Kaartfocus p1");
});

it("opens only the matching manager's dialog when an agenda row is clicked", async () => {
  renderTrips("/trips/t1/plan");
  expect(await screen.findByText("Verblijffocus geen")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Agendaregel openen" }));
  expect(screen.getByText("Verblijffocus s1")).toBeTruthy();
  expect(screen.getByText("Bezoekfocus geen")).toBeTruthy();
  expect(screen.getByText("Routefocus geen")).toBeTruthy();
});

it("opens a record's dialog when arriving from the private overview with one to open", async () => {
  const { router } = renderTrips("/trips/t1/prepare");
  expect(await screen.findByText("Taakfocus geen")).toBeTruthy();
  await act(async () => {
    await router.navigate({
      to: "/trips/t1/prepare",
      state: { openRecord: { kind: "task", id: "tk1" } },
    });
  });
  expect(await screen.findByText("Taakfocus tk1")).toBeTruthy();
  // Stays are planned on the plan tab, not here.
  expect(screen.queryByText(/Verblijffocus/)).toBeNull();
});

it("keeps the old media link working, and sends an unknown tab to the overview", async () => {
  const media = renderTrips("/trips/t1/media");
  await waitFor(() => expect(media.router.state.location.pathname).toBe("/trips/t1/story"));
  cleanup();
  const unknown = renderTrips("/trips/t1/nonsense");
  await waitFor(() => expect(unknown.router.state.location.pathname).toBe("/trips/t1"));
});

/** The search popup opens after the key press has been handled, so the option is awaited. */
async function choose(optionName: string) {
  fireEvent.keyDown(await screen.findByRole("combobox", { name: "Ga naar" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

const bar = (name: RegExp) => screen.getByRole("button", { name });

it("opens only the first block of the plan tab, and each block can be expanded", async () => {
  renderTrips("/trips/t1/plan");
  await screen.findByText("Verblijffocus geen");
  expect(bar(/^Agenda$/).getAttribute("aria-expanded")).toBe("true");
  expect(bar(/Verblijven/).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(bar(/Verblijven/));
  expect(bar(/Verblijven/).getAttribute("aria-expanded")).toBe("true");
});

it("expands the block a link names with #id on arrival", async () => {
  renderTrips("/trips/t1/plan#routes");
  await screen.findByText("Routefocus geen");
  await waitFor(() => expect(bar(/Routes/).getAttribute("aria-expanded")).toBe("true"));
  expect(bar(/Verblijven/).getAttribute("aria-expanded")).toBe("false");
});

it("expands the block that hosts a record whose dialog is asked to open", async () => {
  const { router } = renderTrips("/trips/t1/plan");
  await screen.findByText("Verblijffocus geen");
  await act(async () => {
    await router.navigate({
      to: "/trips/t1/plan",
      state: { openRecord: { kind: "stay", id: "s1" } },
    });
  });
  expect(await screen.findByText("Verblijffocus s1")).toBeTruthy();
  await waitFor(() => expect(bar(/Verblijven/).getAttribute("aria-expanded")).toBe("true"));
});

it("jumps to a block from the search, even one that was collapsed again", async () => {
  renderTrips("/trips/t1/plan");
  await screen.findByRole("combobox", { name: "Ga naar" });
  await choose("Plan › Verblijven");
  await waitFor(() => expect(bar(/Verblijven/).getAttribute("aria-expanded")).toBe("true"));
  fireEvent.click(bar(/Verblijven/));
  expect(bar(/Verblijven/).getAttribute("aria-expanded")).toBe("false");
  await choose("Plan › Verblijven");
  await waitFor(() => expect(bar(/Verblijven/).getAttribute("aria-expanded")).toBe("true"));
});

it("says so when a workspace trip does not exist for this account", async () => {
  const missingRoot = createRootRoute({
    component: () => <TripWorkspaceView tripId="missing" section="overview" />,
  });
  renderRoutesWithOwner(missingRoot, ["/"]);
  expect(await screen.findByRole("heading", { name: "Reis niet gevonden" })).toBeTruthy();
});

it("explains a failed trip load without hiding the retry path", async () => {
  serveApi(vi.fn(() => json({ detail: "Database niet bereikbaar." }, 400)));
  renderTrips();
  expect(
    (await screen.findAllByText("Je reizen konden niet worden geladen.")).length,
  ).toBeGreaterThan(0);
  // An empty-list hint would claim the account has no trips, which a failed load cannot know.
  expect(screen.queryByText("Je eerste reis blijft privé totdat je iets deelt.")).toBeNull();
});

it("counts travel updates in the selected language, in the list and in the workspace", async () => {
  trips = [
    trip("t1", "Exampleland", { travel_updates: [{ id: "u1" } as Trip["travel_updates"][number]] }),
    trip("t2", "IJsland"),
  ];
  renderTrips();
  fireEvent.click(await screen.findByRole("link", { name: /Exampleland/ }));
  expect(await screen.findByText("1 reisupdate")).toBeTruthy();
  act(() => changeLocale("en"));
  expect(screen.getByText("1 travel update")).toBeTruthy();
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", {
      name: "Trips",
    }),
  );
  expect(await screen.findByText("0 travel updates")).toBeTruthy();
});

it("retranslates a retained navigation notice without changing the route", async () => {
  const { router } = renderRoutesWithOwner(routeTree, ["/trips"]);
  await act(async () => {
    await router.navigate({ to: "/trips", state: { notice: "trip_deleted" } });
  });
  expect(await screen.findByText("Reis verwijderd.")).toBeTruthy();
  act(() => changeLocale("en"));
  expect(screen.getByText("Trip deleted.")).toBeTruthy();
  expect(router.state.location.pathname).toBe("/trips");
  expect(router.state.location.state.notice).toBe("trip_deleted");
});

it("groups trips by state, with the one under way first", async () => {
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  trips = [
    trip("past", "Ardennen", { starts_on: day(-30), ends_on: day(-28) }),
    trip("planned", "IJsland"),
    trip("soon", "Japan", { starts_on: day(20), ends_on: day(30) }),
    trip("now", "Exampleland", { starts_on: day(-1), ends_on: day(2) }),
  ];
  renderTrips();
  await screen.findByRole("link", { name: /Exampleland/ });
  expect(
    screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
  ).toEqual(["Nu en binnenkort", "Nog plannen", "Afgelopen reizen"]);
  const titles = screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent);
  expect(titles).toEqual(["Exampleland", "Japan", "IJsland", "Ardennen"]);
  expect(screen.getByRole("link", { name: /Exampleland/ }).textContent).toContain("Nu op reis");
  expect(screen.getByRole("link", { name: /Ardennen/ }).textContent).toContain("Afgelopen reis");
});

it("shows the trip's state and whether its public page is live in the workspace header", async () => {
  surfaceState = "published";
  trips = [trip("t1", "Exampleland", { starts_on: "2020-01-01", ends_on: "2020-01-05" })];
  renderTrips("/trips/t1");
  expect(await screen.findByText("Afgelopen reis")).toBeTruthy();
  expect(await screen.findByText("Publieke pagina live")).toBeTruthy();
  act(() => changeLocale("en"));
  expect(screen.getByText("Public page live")).toBeTruthy();
});

it("says a trip is not published, and draws its cover from the owner's own file", async () => {
  const coverUrl = "/api/trips/t1/media/m1/derivatives/d1/file";
  trips = [trip("t1", "Exampleland", { cover_url: coverUrl })];
  // Layered over the default API: only the cover file is answered here, everything else falls through.
  serveApi((url) =>
    url === coverUrl ? new Response(new Blob(["x"], { type: "image/png" })) : undefined,
  );
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:cover", revokeObjectURL: () => undefined }),
  );
  renderTrips("/trips/t1");
  expect(await screen.findByText("Niet gepubliceerd")).toBeTruthy();
  await waitFor(() =>
    expect(document.querySelector("header img")?.getAttribute("src")).toBe("blob:cover"),
  );
});
