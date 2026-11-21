import { responseFixtures } from "@/mocks/response-test-fixtures";
import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { Area, Stay, Trip } from "../api-types";
import { AgendaView } from "./AgendaView";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("@/app/providers/auth-context", () => ({ useAuth: () => auth }));

const area = (id: string, label: string): Area => ({
  id,
  visibility: "private",
  label,
  label_nl: label,
  label_en: null,
  local_name: null,
  country_code: "TW",
  region: null,
  latitude: null,
  longitude: null,
  timezone: null,
});
const taipei = area("taipei", "Taipei"),
  linkou = area("linkou", "Linkou");
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
let api: FakeApi;

beforeEach(() => {
  auth.session = { accessToken: testToken() };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(api.unexpected).toEqual([]);
});

function seed(stays: Api.StayResponse[], routes: Api.RouteResponse[], visits: Api.VisitResponse[]) {
  api = fakeApi()
    .collection<Api.StayResponse>("/api/trips/trip/stays", stays)
    .collection<Api.RouteResponse>("/api/trips/trip/routes", routes)
    .collection<Api.VisitResponse>("/api/trips/trip/visits", visits);
}

it("lists stays, routes and visits together by day, then what has no day yet", async () => {
  seed(
    [
      {
        check_out_time: null,
        status: "planned",
        website_url: null,
        booking_reference: null,
        contact_details: null,
        notes: null,
        document_asset_ids: [],
        location: null,
        visibility: "private",
        share_date_precision: null,
        notes_html: null,
        contact_details_html: null,
        id: "s1",
        check_in_date: "2054-11-16",
        check_out_date: "2054-11-20",
        property_name: "Hotel Royal",
        check_in_time: null,
        area: linkou,
      } satisfies Api.StayResponse,
    ],
    [
      {
        status: "planned",
        label_nl: null,
        label_en: null,
        departure_location: null,
        arrival_location: null,
        carrier: null,
        service_reference: null,
        travel_class: null,
        booking_reference: null,
        notes: null,
        document_asset_ids: [],
        geometry: null,
        visibility: "private",
        notes_html: null,
        id: "r1",
        mode: "flight",
        label: null,
        departure_area: area("ams", "Amsterdam"),
        arrival_area: taipei,
        departs_on: "2054-11-16",
        departs_at: "2054-11-16T09:40:00Z",
        arrives_at: "2054-11-16T22:25:00Z",
        departure_timezone: "Europe/Amsterdam",
        arrival_timezone: "Asia/Taipei",
      },
      {
        status: "planned",
        label_nl: null,
        label_en: null,
        departure_location: null,
        arrival_location: null,
        departure_timezone: null,
        arrival_timezone: null,
        carrier: null,
        service_reference: null,
        travel_class: null,
        booking_reference: null,
        notes: null,
        document_asset_ids: [],
        geometry: null,
        visibility: "private",
        notes_html: null,
        id: "r2",
        mode: "train",
        label: "Losse route",
        departure_area: taipei,
        arrival_area: linkou,
        departs_on: null,
        departs_at: null,
        arrives_at: null,
      },
      {
        status: "planned",
        label_nl: null,
        label_en: null,
        departure_location: null,
        arrival_location: null,
        departure_timezone: null,
        arrival_timezone: null,
        carrier: null,
        service_reference: null,
        travel_class: null,
        booking_reference: null,
        notes: null,
        document_asset_ids: [],
        geometry: null,
        visibility: "private",
        notes_html: null,
        id: "r3",
        mode: "train",
        label: "Naar het noorden",
        departure_area: linkou,
        arrival_area: taipei,
        departs_on: "2054-11-21",
        departs_at: null,
        arrives_at: null,
      },
    ] satisfies Api.RouteResponse[],
    [
      {
        location: null,
        title_nl: null,
        title_en: null,
        kind: null,
        status: "planned",
        notes: null,
        summary: null,
        summary_nl: null,
        summary_en: null,
        visibility: "private",
        share_time: false,
        share_date_precision: null,
        possible_route_duplicates: [],
        notes_html: null,
        summary_html: null,
        id: "v1",
        title: "Nachtmarkt",
        area: taipei,
        starts_on: "2054-11-21",
        ends_on: null,
        start_time: "18:30:00",
        end_time: null,
      },
      {
        location: null,
        title_nl: null,
        title_en: null,
        kind: null,
        status: "planned",
        notes: null,
        summary: null,
        summary_nl: null,
        summary_en: null,
        visibility: "private",
        share_time: false,
        share_date_precision: null,
        possible_route_duplicates: [],
        notes_html: null,
        summary_html: null,
        id: "v2",
        title: "Ooit",
        area: taipei,
        starts_on: null,
        ends_on: null,
        start_time: null,
        end_time: null,
      },
    ] satisfies Api.VisitResponse[],
  );
  renderWithOwner(<AgendaView trip={trip} />);
  await screen.findByText(/Bezoek: Nachtmarkt/);
  const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
  expect(rows).toEqual([
    expect.stringContaining("10:40 Route: Amsterdam → Taipei"),
    expect.stringContaining("Verblijf: Hotel Royal"),
    // The stay sleeps on every night after check-in, then checks out without an extra night.
    expect.stringContaining("Slapen in Hotel Royal"),
    expect.stringContaining("Slapen in Hotel Royal"),
    expect.stringContaining("Slapen in Hotel Royal"),
    expect.stringContaining("Uitchecken: Hotel Royal"),
    expect.stringContaining("18:30 Bezoek: Nachtmarkt"),
    // A route with a day but no train yet is on that day, after what has a time.
    expect.stringContaining("Route: Naar het noorden"),
    // Nothing disappears: undated visits and routes are listed together.
    expect.stringContaining("Bezoek: Ooit"),
    expect.stringContaining("Route: Losse route"),
  ]);
  expect(screen.getByText("Nog geen dag")).toBeTruthy();
});

it("says so when nothing has a day yet", async () => {
  seed([], [], []);
  renderWithOwner(<AgendaView trip={trip} />);
  await screen.findByText(/Nog niets in de agenda/);
});

it("keeps each record's own order for same-day items without a time, instead of sorting by opaque id", async () => {
  seed(
    [],
    [
      // Ids sort alphabetically the other way around, so an id-based tiebreak would reverse these.
      {
        status: "planned",
        label_nl: null,
        label_en: null,
        departure_location: null,
        arrival_location: null,
        departure_timezone: null,
        arrival_timezone: null,
        carrier: null,
        service_reference: null,
        travel_class: null,
        booking_reference: null,
        notes: null,
        document_asset_ids: [],
        geometry: null,
        visibility: "private",
        notes_html: null,
        id: "z-arrival",
        mode: "train",
        label: "Lisbon → Sintra",
        departure_area: area("lisbon", "Lisbon"),
        arrival_area: area("sintra", "Sintra"),
        departs_on: "2054-10-15",
        departs_at: null,
        arrives_at: null,
      },
      {
        status: "planned",
        label_nl: null,
        label_en: null,
        departure_location: null,
        arrival_location: null,
        departure_timezone: null,
        arrival_timezone: null,
        carrier: null,
        service_reference: null,
        travel_class: null,
        booking_reference: null,
        notes: null,
        document_asset_ids: [],
        geometry: null,
        visibility: "private",
        notes_html: null,
        id: "a-return",
        mode: "train",
        label: "Sintra → Lisbon",
        departure_area: area("sintra", "Sintra"),
        arrival_area: area("lisbon", "Lisbon"),
        departs_on: "2054-10-15",
        departs_at: null,
        arrives_at: null,
      },
    ] satisfies Api.RouteResponse[],
    [
      {
        location: null,
        title_nl: null,
        title_en: null,
        kind: null,
        status: "planned",
        notes: null,
        summary: null,
        summary_nl: null,
        summary_en: null,
        visibility: "private",
        share_time: false,
        share_date_precision: null,
        possible_route_duplicates: [],
        notes_html: null,
        summary_html: null,
        id: "v-sintra",
        title: "Sintra",
        area: area("sintra", "Sintra"),
        starts_on: "2054-10-15",
        ends_on: null,
        start_time: null,
        end_time: null,
      },
    ] satisfies Api.VisitResponse[],
  );
  renderWithOwner(<AgendaView trip={trip} />);
  await screen.findByText(/Bezoek: Sintra/);
  const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
  expect(rows).toEqual([
    expect.stringContaining("Route: Lisbon → Sintra"),
    expect.stringContaining("Route: Sintra → Lisbon"),
    expect.stringContaining("Bezoek: Sintra"),
  ]);
});

it("opens the record behind an agenda row when it is clicked", async () => {
  seed(
    [
      {
        check_out_time: null,
        status: "planned",
        website_url: null,
        booking_reference: null,
        contact_details: null,
        notes: null,
        document_asset_ids: [],
        location: null,
        visibility: "private",
        share_date_precision: null,
        notes_html: null,
        contact_details_html: null,
        id: "s1",
        check_in_date: "2054-11-16",
        check_out_date: "2054-11-20",
        property_name: "Hotel Royal",
        check_in_time: null,
        area: linkou,
      } satisfies Api.StayResponse,
    ],
    [
      {
        status: "planned",
        label_nl: null,
        label_en: null,
        departure_location: null,
        arrival_location: null,
        departure_timezone: null,
        arrival_timezone: null,
        carrier: null,
        service_reference: null,
        travel_class: null,
        booking_reference: null,
        notes: null,
        document_asset_ids: [],
        geometry: null,
        visibility: "private",
        notes_html: null,
        id: "r1",
        mode: "train",
        label: null,
        departure_area: taipei,
        arrival_area: linkou,
        departs_on: "2054-11-16",
        departs_at: null,
        arrives_at: null,
      },
    ] satisfies Api.RouteResponse[],
    [
      {
        location: null,
        title_nl: null,
        title_en: null,
        kind: null,
        status: "planned",
        notes: null,
        summary: null,
        summary_nl: null,
        summary_en: null,
        visibility: "private",
        share_time: false,
        share_date_precision: null,
        possible_route_duplicates: [],
        notes_html: null,
        summary_html: null,
        id: "v1",
        title: "Nachtmarkt",
        area: taipei,
        starts_on: "2054-11-16",
        ends_on: null,
        start_time: null,
        end_time: null,
      },
    ] satisfies Api.VisitResponse[],
  );
  const onOpenRecord = vi.fn();
  renderWithOwner(<AgendaView trip={trip} onOpenRecord={onOpenRecord} />);
  await screen.findByText(/Verblijf: Hotel Royal/);
  fireEvent.click(screen.getByRole("button", { name: /^Verblijf: Hotel Royal/ }));
  expect(onOpenRecord).toHaveBeenCalledWith("stay", "s1");
});

it("starts a visit, stay or route on a day, with the area where the owner sleeps", async () => {
  seed(
    [
      {
        check_out_time: null,
        website_url: null,
        booking_reference: null,
        contact_details: null,
        notes: null,
        document_asset_ids: [],
        location: null,
        visibility: "private",
        share_date_precision: null,
        notes_html: null,
        contact_details_html: null,
        id: "s1",
        check_in_date: "2054-11-16",
        check_out_date: "2054-11-19",
        property_name: "Hotel Royal",
        check_in_time: null,
        area: linkou,
        status: "confirmed",
      },
    ],
    [],
    [],
  );
  const create = vi.fn();
  renderWithOwner(<AgendaView trip={trip} onCreateRecord={create} />);
  const [add] = await screen.findAllByRole("button", { name: /^Toevoegen aan / });
  fireEvent.click(add!);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Bezoek op deze dag toevoegen" }));
  expect(create).toHaveBeenLastCalledWith(
    "visit",
    { day: "2054-11-16", areaId: "linkou" },
    expect.any(HTMLElement),
  );

  fireEvent.click(add!);
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Verblijf vanaf deze dag toevoegen" }),
  );
  // A new stay is usually somewhere else: only the day is filled in.
  expect(create).toHaveBeenLastCalledWith("stay", { day: "2054-11-16" }, expect.any(HTMLElement));

  fireEvent.click(add!);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Route op deze dag toevoegen" }));
  expect(create).toHaveBeenLastCalledWith(
    "route",
    { day: "2054-11-16", areaId: "linkou" },
    expect.any(HTMLElement),
  );
});

it("offers no way to start a record unless the workspace can open one", async () => {
  seed(
    [],
    [],
    [
      {
        location: null,
        title_nl: null,
        title_en: null,
        kind: null,
        status: "planned",
        ends_on: null,
        start_time: null,
        end_time: null,
        notes: null,
        summary: null,
        summary_nl: null,
        summary_en: null,
        visibility: "private",
        share_time: false,
        share_date_precision: null,
        possible_route_duplicates: [],
        notes_html: null,
        summary_html: null,
        id: "v1",
        title: "Nachtmarkt",
        area: taipei,
        starts_on: "2054-11-21",
      },
    ],
  );
  renderWithOwner(<AgendaView trip={trip} />);
  await screen.findByText(/Bezoek: Nachtmarkt/);
  expect(screen.queryByRole("button", { name: /^Toevoegen aan / })).toBeNull();
});

const planStay = (id: string, fields: Partial<Stay> = {}) =>
  ({
    ...responseFixtures.StayResponse,
    id,
    status: "planned",
    property_name: `Hotel ${id}`,
    check_in_date: "2054-11-16",
    check_out_date: "2054-11-18",
    check_in_time: null,
    check_out_time: null,
    location: null,
    area: linkou,
    visibility: "private",
    ...fields,
  }) satisfies Api.StayResponse;
const noMenu = {
  onAct: () => {},
  isPinned: () => false,
  onToggleOffline: () => {},
  onAdjustNights: () => {},
  adjustingNights: false,
};

it("moves the check-out by a night for a stay still being planned, not for a booked one", async () => {
  seed(
    [
      planStay("a"),
      planStay("b", {
        status: "confirmed",
        check_in_date: "2054-12-01",
        check_out_date: "2054-12-03",
      }),
      planStay("c", { status: "idea", check_in_date: "2054-12-10", check_out_date: "2054-12-11" }),
    ],
    [],
    [],
  );
  const adjust = vi.fn();
  renderWithOwner(<AgendaView trip={trip} actions={{ ...noMenu, onAdjustNights: adjust }} />);
  await screen.findByText(/Verblijf: Hotel a/);
  // Only the planned and the idea stay have a stepper.
  expect(screen.getAllByRole("group", { name: /^Nachten bij / })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Eén nacht meer bij Hotel a" }));
  fireEvent.click(screen.getByRole("button", { name: "Eén nacht minder bij Hotel a" }));
  expect(adjust.mock.calls.map(([item, delta]) => [item.id, delta])).toEqual([
    ["a", 1],
    ["a", -1],
  ]);
  // A one-night stay cannot lose its only night.
  expect(
    (screen.getByRole("button", { name: "Eén nacht minder bij Hotel c" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("keeps a stay that visitors can see out of the quick stepper", async () => {
  seed(
    [planStay("a", { visibility: "everyone" }), planStay("b", { visibility: "custom" })],
    [],
    [],
  );
  renderWithOwner(<AgendaView trip={trip} actions={noMenu} />);
  await screen.findByText(/Verblijf: Hotel a/);
  expect(screen.queryAllByRole("group", { name: /^Nachten bij / })).toHaveLength(0);
});

it("offers no stepper without row actions", async () => {
  seed([planStay("a")], [], []);
  renderWithOwner(<AgendaView trip={trip} />);
  await screen.findByText(/Verblijf: Hotel a/);
  expect(screen.queryAllByRole("group", { name: /^Nachten bij / })).toHaveLength(0);
});

it("disables the stepper while a night change is being saved", async () => {
  seed([planStay("a")], [], []);
  renderWithOwner(<AgendaView trip={trip} actions={{ ...noMenu, adjustingNights: true }} />);
  await screen.findByText(/Verblijf: Hotel a/);
  expect(
    (screen.getByRole("button", { name: "Eén nacht meer bij Hotel a" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("shows a stay without an accommodation by its area, with no placeholder name", async () => {
  seed([planStay("a", { property_name: null })], [], []);
  renderWithOwner(<AgendaView trip={trip} />);
  const row = await screen.findByRole("button", { name: /Nog te kiezen in Linkou/ });
  expect(row.textContent).toContain("Verblijf: Nog te kiezen in Linkou");
});
