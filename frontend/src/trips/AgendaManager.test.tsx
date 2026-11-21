import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { server } from "../mocks/server";
import * as offlineStore from "@/lib/offline-store";
import { localized } from "../query/fake-api";
import { renderWithOwner, resetOfflineDb, testToken } from "../query/test-utils";
import type { Area, Route, Stay, Trip, Visit } from "../api-types";
import { AgendaManager } from "./AgendaManager";
import { agendaFilterKey } from "./agenda-filter";
import type { AgendaRecordKind } from "./agenda-items";
import { PlanEditors, usePlanHost } from "./plan-host";

// Every offline call goes through unchanged, except where a test makes the removal of a saved copy fail.
vi.mock("@/lib/offline-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/offline-store")>();
  return { ...original, removeOfflineCopy: vi.fn(original.removeOfflineCopy) };
});

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const area = (id: string, label: string): Area => ({
  id,
  visibility: "private",
  label,
  label_nl: label,
  label_en: null,
  local_name: null,
  country_code: "TW",
  region: null,
  latitude: 25,
  longitude: 121,
  timezone: null,
});
const taipei = area("taipei", "Taipei");
const trip: Trip = {
  owner_subject: "owner-1",
  content_language: "nl",
  cover_derivative_id: null,
  cover_url: null,
  summary_html: null,
  id: "trip",
  title: "Exampleland",
  title_nl: "Exampleland",
  title_en: null,
  summary: null,
  summary_nl: null,
  summary_en: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [],
};
const visit = (id: string, title: string, overrides: Partial<Visit> = {}): Visit =>
  localized({
    id,
    area: taipei,
    location: null,
    title,
    kind: null,
    status: "planned",
    starts_on: "2054-11-21",
    ends_on: null,
    start_time: null,
    end_time: null,
    notes: null,
    summary: null,
    visibility: "private",
    share_time: false,
    share_date_precision: null,
    notes_html: null,
    summary_html: null,
    possible_route_duplicates: [],
    ...overrides,
  }) as Visit;
const stay = (id: string, name: string, overrides: Partial<Stay> = {}): Stay =>
  ({
    id,
    check_in_date: "2054-11-21",
    check_out_date: "2054-11-23",
    check_in_time: null,
    check_out_time: null,
    status: "planned",
    property_name: name,
    website_url: null,
    booking_reference: null,
    contact_details: null,
    notes: null,
    location: null,
    area: taipei,
    visibility: "private",
    share_date_precision: null,
    document_asset_ids: [],
    ...overrides,
  }) as Stay;
const route = (id: string, label: string, overrides: Partial<Route> = {}): Route =>
  localized({
    id,
    mode: "train",
    label,
    status: "planned",
    visibility: "private",
    departure_area: taipei,
    arrival_area: taipei,
    departs_on: "2054-11-22",
    departs_at: null,
    arrives_at: null,
    ...overrides,
  }) as Route;

let visits: Visit[];
let stays: Stay[];
let routes: Route[];
/** Holds the answer to a route's delete until a test releases it. */
let routeDeleteGate: Promise<void> | undefined;
let sent: { method: string; path: string; body?: unknown }[];

function serve() {
  const json =
    <T extends JsonBodyType = never>(read: () => NoInfer<T>) =>
    () =>
      HttpResponse.json<T>(read());
  server.use(
    http.get(
      "/api/trips/trip/visits",
      json<Api.VisitResponse[]>(() => visits),
    ),
    http.get(
      "/api/trips/trip/stays",
      json<Api.StayResponse[]>(() => stays),
    ),
    http.get(
      "/api/trips/trip/routes",
      json<Api.RouteResponse[]>(() => routes),
    ),
    http.get(
      "/api/trips/trip/areas",
      json<Api.AreaResponse[]>(() => [taipei]),
    ),
    http.get(
      "/api/trips/trip/locations",
      json<never[]>(() => []),
    ),
    http.get(
      "/api/trips/trip/documents",
      json<never[]>(() => []),
    ),
    http.get(
      "/api/documents",
      json<never[]>(() => []),
    ),
    http.get(
      "/api/trips/trip/alternative-groups",
      json<never[]>(() => []),
    ),
    http.get(
      "/api/trips/trip/alternative-groups/suggestions",
      json<never[]>(() => []),
    ),
    http.delete("/api/trips/trip/visits/:id", ({ params, request }) => {
      sent.push({ method: "DELETE", path: new URL(request.url).pathname });
      visits = visits.filter((candidate) => candidate.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch("/api/trips/trip/stays/:id", async ({ params, request }) => {
      const body = (await request.json()) as Partial<Stay>;
      sent.push({ method: "PATCH", path: new URL(request.url).pathname, body });
      stays = stays.map((candidate) =>
        candidate.id === params.id ? { ...candidate, ...body } : candidate,
      );
      return HttpResponse.json<Api.StayResponse>(
        stays.find((candidate) => candidate.id === params.id)!,
      );
    }),
    http.delete("/api/trips/trip/routes/:id", async ({ params, request }) => {
      sent.push({ method: "DELETE", path: new URL(request.url).pathname });
      await routeDeleteGate;
      routes = routes.filter((candidate) => candidate.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete("/api/trips/trip/stays/:id", ({ params, request }) => {
      sent.push({ method: "DELETE", path: new URL(request.url).pathname });
      stays = stays.filter((candidate) => candidate.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

/** The agenda with the plan's dialogs behind it, as the plan tab wires them. */
function Plan({
  onShowOnMap,
  datedTrip = false,
  kindRequest,
}: {
  onShowOnMap?: (pointId: string) => void;
  datedTrip?: boolean;
  kindRequest?: { kinds: readonly AgendaRecordKind[]; token: number } | null;
}) {
  const host = usePlanHost(null, null, () => undefined);
  const shown = datedTrip ? { ...trip, starts_on: "2054-11-16", ends_on: "2054-11-18" } : trip;
  return (
    <>
      <AgendaManager
        trip={shown}
        host={host}
        kindRequest={kindRequest}
        onShowOnMap={onShowOnMap}
        onCreateRecord={() => undefined}
      />
      <PlanEditors trip={shown} host={host} />
    </>
  );
}

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  visits = [];
  stays = [];
  routes = [];
  sent = [];
  routeDeleteGate = undefined;
  localStorage.clear();
  serve();
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  await resetOfflineDb();
});

const rowOf = async (text: RegExp) =>
  (await screen.findByRole("button", { name: text })).closest("li") as HTMLElement;
const openMenu = (row: HTMLElement) =>
  fireEvent.click(within(row).getByRole("button", { name: /^Acties voor / }));

it("says what sets a row apart: an idea, a cancelled record, and who a record is shared with", async () => {
  visits = [
    visit("v1", "Nachtmarkt"),
    visit("v2", "Theehuis", { status: "idea", visibility: "everyone" }),
  ];
  stays = [stay("s1", "Hotel Royal", { status: "cancelled" })];
  renderWithOwner(<Plan />);
  const market = await rowOf(/Bezoek: Nachtmarkt/);
  // A private plan is the common case: nothing is added to it.
  expect(market.textContent).not.toMatch(/Idee|Geannuleerd|Iedereen|Privé/);
  expect((await rowOf(/Bezoek: Theehuis/)).textContent).toContain("Idee · Iedereen");
  expect((await rowOf(/Verblijf: Hotel Royal/)).textContent).toContain("Geannuleerd");
});

it("filters by kind and by status, remembers it per trip and shows nothing outside the filter", async () => {
  visits = [visit("v1", "Nachtmarkt"), visit("v2", "Theehuis", { status: "idea" })];
  stays = [stay("s1", "Hotel Royal")];
  routes = [route("r1", "Naar het noorden", { status: "cancelled" })];
  const { unmount } = renderWithOwner(<Plan />);
  await screen.findByRole("button", { name: /Bezoek: Nachtmarkt/ });

  const kinds = screen.getByRole("group", { name: "Filter op soort" });
  fireEvent.click(within(kinds).getByRole("button", { name: "Verblijven" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: /Bezoek:/ })).toBeNull());
  expect(screen.queryByRole("button", { name: /Route:/ })).toBeNull();
  expect(screen.getAllByRole("button", { name: /Hotel Royal/ }).length).toBeGreaterThan(0);
  expect(screen.getByText("1 van 4 getoond.")).toBeTruthy();

  // The status filter narrows within the kinds; two kinds together are allowed.
  fireEvent.click(within(kinds).getByRole("button", { name: "Bezoeken" }));
  const statuses = screen.getByRole("group", { name: "Filter op status" });
  fireEvent.click(within(statuses).getByRole("button", { name: "Ideeën" }));
  await screen.findByRole("button", { name: /Bezoek: Theehuis/ });
  expect(screen.queryByRole("button", { name: /Bezoek: Nachtmarkt/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Hotel Royal/ })).toBeNull();

  // Remembered for this trip in this browser, and only there.
  expect(JSON.parse(localStorage.getItem(agendaFilterKey("trip")) ?? "null")).toEqual({
    kinds: ["visit", "stay"],
    statuses: ["idea"],
  });
  unmount();
  renderWithOwner(<Plan />);
  await screen.findByRole("button", { name: /Bezoek: Theehuis/ });
  expect(screen.queryByRole("button", { name: /Bezoek: Nachtmarkt/ })).toBeNull();
  expect(
    within(screen.getByRole("group", { name: "Filter op status" }))
      .getByRole("button", { name: "Ideeën" })
      .getAttribute("aria-pressed"),
  ).toBe("true");

  fireEvent.click(screen.getByRole("button", { name: "Alles tonen" }));
  await screen.findByRole("button", { name: /Bezoek: Nachtmarkt/ });
  expect(localStorage.getItem(agendaFilterKey("trip"))).toBeNull();
});

it("shows the kind an old #stays address names, in every status, and again for each new request", async () => {
  visits = [visit("v1", "Nachtmarkt")];
  stays = [stay("s1", "Hotel Royal"), stay("s2", "Gasthuis", { status: "cancelled" })];
  routes = [route("r1", "Naar het noorden")];
  // A filter left from earlier visits does not hide what the address asks for.
  localStorage.setItem(
    agendaFilterKey("trip"),
    JSON.stringify({ kinds: ["route"], statuses: ["idea"] }),
  );
  const kinds = (name: string) =>
    within(screen.getByRole("group", { name: "Filter op soort" })).getByRole("button", { name });
  function Arrival() {
    const [request, setRequest] = useState({ kinds: ["stay"] as AgendaRecordKind[], token: 1 });
    return (
      <>
        <button
          type="button"
          onClick={() => setRequest((current) => ({ kinds: ["route"], token: current.token + 1 }))}
        >
          Naar routes
        </button>
        <Plan kindRequest={request} />
      </>
    );
  }
  renderWithOwner(<Arrival />);
  await screen.findAllByRole("button", { name: /Hotel Royal/ });
  expect(screen.getAllByRole("button", { name: /Gasthuis/ }).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /Bezoek:/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Route:/ })).toBeNull();
  expect(kinds("Verblijven").getAttribute("aria-pressed")).toBe("true");
  expect(JSON.parse(localStorage.getItem(agendaFilterKey("trip")) ?? "null")).toEqual({
    kinds: ["stay"],
    statuses: [],
  });

  fireEvent.click(kinds("Bezoeken"));
  await screen.findByRole("button", { name: /Bezoek: Nachtmarkt/ });
  fireEvent.click(screen.getByRole("button", { name: "Naar routes" }));
  await screen.findByRole("button", { name: /Route: Naar het noorden/ });
  expect(screen.queryByRole("button", { name: /Bezoek:/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Hotel Royal/ })).toBeNull();
});

it("says so when the filter leaves nothing, and ignores a stored filter it cannot read", async () => {
  localStorage.setItem(agendaFilterKey("trip"), "{broken");
  stays = [stay("s1", "Hotel Royal")];
  renderWithOwner(<Plan />);
  await screen.findAllByRole("button", { name: /Hotel Royal/ });
  fireEvent.click(
    within(screen.getByRole("group", { name: "Filter op status" })).getByRole("button", {
      name: "Geannuleerd",
    }),
  );
  await screen.findByText("Niets in de agenda komt overeen met dit filter.");
});

it("keeps working when the browser denies storage", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  visits = [visit("v1", "Nachtmarkt")];
  stays = [stay("s1", "Hotel Royal")];
  renderWithOwner(<Plan />);
  await screen.findByRole("button", { name: /Bezoek: Nachtmarkt/ });
  fireEvent.click(
    within(screen.getByRole("group", { name: "Filter op soort" })).getByRole("button", {
      name: "Verblijven",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("button", { name: /Bezoek:/ })).toBeNull());
  vi.restoreAllMocks();
});

it("offers Edit, Show on map, Save offline and Delete on a visit, and Edit and Delete on a stay", async () => {
  visits = [visit("v1", "Nachtmarkt")];
  stays = [stay("s1", "Hotel Royal")];
  const onShowOnMap = vi.fn();
  renderWithOwner(<Plan onShowOnMap={onShowOnMap} />);

  openMenu(await rowOf(/Bezoek: Nachtmarkt/));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Bewerken",
    "Toon op kaart",
    "Offline bewaren",
    "Verwijderen",
  ]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Toon op kaart" }));
  expect(onShowOnMap).toHaveBeenCalledWith("taipei");

  openMenu(await rowOf(/Verblijf: Hotel Royal/));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Bewerken",
    "Verwijderen",
  ]);
});

it("saves a visit offline from its row and says so on the block's status line", async () => {
  visits = [visit("v1", "Nachtmarkt")];
  renderWithOwner(<Plan />);
  openMenu(await rowOf(/Bezoek: Nachtmarkt/));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Offline bewaren" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Nachtmarkt"));
  openMenu(await rowOf(/Bezoek: Nachtmarkt/));
  expect(await screen.findByRole("menuitem", { name: "Offline verwijderen" })).toBeTruthy();
});

it("opens the record for editing from the row menu", async () => {
  visits = [visit("v1", "Nachtmarkt")];
  renderWithOwner(<Plan />);
  openMenu(await rowOf(/Bezoek: Nachtmarkt/));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Bewerken" }));
  const dialog = await screen.findByRole("dialog", { name: "Bezoek bewerken" });
  expect((within(dialog).getByLabelText("Titel (optioneel)") as HTMLInputElement).value).toBe(
    "Nachtmarkt",
  );
});

it("deletes from the row menu after a confirmation, and reports it on the status line", async () => {
  visits = [visit("v1", "Nachtmarkt"), visit("v2", "Theehuis")];
  renderWithOwner(<Plan />);
  openMenu(await rowOf(/Bezoek: Nachtmarkt/));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Verwijderen" }));
  const confirm = await screen.findByRole("alertdialog");
  // Cancelling deletes nothing.
  fireEvent.click(within(confirm).getByRole("button", { name: "Annuleren" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(sent).toEqual([]);

  openMenu(await rowOf(/Bezoek: Nachtmarkt/));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Verwijderen" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );
  await waitFor(() => expect(screen.queryByRole("button", { name: /Nachtmarkt/ })).toBeNull());
  expect(sent).toEqual([{ method: "DELETE", path: "/api/trips/trip/visits/v1" }]);
  expect(screen.getByRole("status").textContent).toBe("Bezoek verwijderd.");
  // The deleted row is gone: focus moves on to the next row instead of falling to the page.
  const next = screen.getByRole("button", { name: /Bezoek: Theehuis/ });
  await waitFor(() => expect(document.activeElement).toBe(next));
});

it("deletes a stay and a route from their rows through the same path", async () => {
  stays = [stay("s1", "Hotel Royal")];
  routes = [route("r1", "Naar het noorden")];
  renderWithOwner(<Plan />);
  openMenu(await rowOf(/Route: Naar het noorden/));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Verwijderen" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toEqual({ method: "DELETE", path: "/api/trips/trip/routes/r1" });
  await waitFor(() => expect(screen.queryByRole("button", { name: /Route: Naar/ })).toBeNull());

  openMenu(await rowOf(/Verblijf: Hotel Royal/));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Verwijderen" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );
  await waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[1]).toEqual({ method: "DELETE", path: "/api/trips/trip/stays/s1" });
  await waitFor(() => expect(screen.queryByRole("button", { name: /Hotel Royal/ })).toBeNull());
});

it("keeps the question open while the delete runs, so it cannot finish into another editor", async () => {
  routes = [route("r1", "Naar het noorden"), route("r2", "Terug", { departs_on: "2054-11-23" })];
  let release!: () => void;
  routeDeleteGate = new Promise((resolve) => {
    release = resolve;
  });
  renderWithOwner(<Plan />);
  openMenu(await rowOf(/Route: Naar het noorden/));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Verwijderen" }));
  const question = await screen.findByRole("alertdialog");
  fireEvent.click(within(question).getByRole("button", { name: "Verwijderen" }));
  await waitFor(() => expect(sent).toHaveLength(1));

  // Neither the buttons nor Escape can leave the question while the request is out.
  await waitFor(() =>
    expect(
      (within(question).getByRole("button", { name: "Annuleren" }) as HTMLButtonElement).disabled,
    ).toBe(true),
  );
  expect(
    (within(question).getByRole("button", { name: "Verwijderen" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.keyDown(question, { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toBeTruthy();

  release();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(screen.queryByRole("button", { name: /Route: Naar/ })).toBeNull());
  expect(screen.getByRole("status").textContent).toBe("Route verwijderd.");
});

it("closes the question and reports the delete even when the saved offline copy cannot be removed", async () => {
  visits = [visit("v1", "Nachtmarkt")];
  renderWithOwner(<Plan />);
  openMenu(await rowOf(/Bezoek: Nachtmarkt/));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Offline bewaren" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("offline bewaard"));

  vi.mocked(offlineStore.removeOfflineCopy).mockRejectedValueOnce(new Error("storage failed"));
  openMenu(await rowOf(/Bezoek: Nachtmarkt/));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Verwijderen" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(screen.queryByRole("button", { name: /Nachtmarkt/ })).toBeNull());
  expect(sent).toEqual([{ method: "DELETE", path: "/api/trips/trip/visits/v1" }]);
  expect(screen.getByRole("status").textContent).toBe("Bezoek verwijderd.");
});

it("lists the days of a dated trip with their Add menus even when nothing is planned yet", async () => {
  renderWithOwner(<Plan datedTrip />);
  const adds = await screen.findAllByRole("button", { name: /^Toevoegen aan / });
  expect(adds).toHaveLength(3);
  expect(screen.queryByText(/Nog niets in de agenda/)).toBeNull();
});

it("changes a stay's nights from its check-in row, only while it is private and still a plan", async () => {
  stays = [
    stay("s1", "Hotel Royal"),
    stay("s2", "Gasthuis", { visibility: "everyone", check_in_date: "2054-11-25" }),
    stay("s3", "Kasteel", { status: "confirmed", check_in_date: "2054-11-27" }),
  ];
  renderWithOwner(<Plan />);
  await screen.findAllByRole("button", { name: /Hotel Royal/ });
  expect(screen.getAllByRole("group", { name: /^Nachten bij / })).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Eén nacht meer bij Hotel Royal" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toMatchObject({
    method: "PATCH",
    path: "/api/trips/trip/stays/s1",
    body: { check_out_date: "2054-11-24" },
  });
  await screen.findByText(/→/);
  expect(
    (screen.getByRole("button", { name: "Eén nacht minder bij Hotel Royal" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it("shows where a visit sleeps on its row", async () => {
  stays = [
    stay("s1", "Hotel Royal", { check_in_date: "2054-11-20", check_out_date: "2054-11-24" }),
  ];
  visits = [visit("v1", "Rondreis", { starts_on: "2054-11-21", ends_on: "2054-11-23" })];
  renderWithOwner(<Plan />);
  const row = await rowOf(/Bezoek: Rondreis/);
  expect(row.textContent).toContain("Hotel Royal");
});

it("walks a row's menu with the keyboard and gives focus back to the row's menu button", async () => {
  visits = [visit("v1", "Nachtmarkt")];
  renderWithOwner(<Plan />);
  const user = userEvent.setup();
  const trigger = within(await rowOf(/Bezoek: Nachtmarkt/)).getByRole("button", {
    name: "Acties voor Nachtmarkt",
  });
  trigger.focus();
  await user.keyboard("{Enter}");
  await screen.findByRole("menu");
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog", { name: "Bezoek bewerken" });
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(dialog.isConnected).toBe(false);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
