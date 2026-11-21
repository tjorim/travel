import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { noticeMessage } from "@/lib/api/feedback";
import type { MessageNotice, ErrorNotice } from "@/lib/api/feedback";
import { renderWithOwner, resetOfflineDb, testToken } from "../query/test-utils";
import type { Area, Trip } from "../api-types";
import { RouteEditor } from "./routes/RouteEditor";
import { StayEditor } from "./stays/StayEditor";
import { VisitEditor } from "./visits/VisitEditor";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const taipei: Area = {
  id: "taipei",
  visibility: "private",
  label: "Taipei",
  label_nl: "Taipei",
  label_en: null,
  local_name: null,
  country_code: "TW",
  region: null,
  latitude: 25.03,
  longitude: 121.56,
  timezone: null,
};
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
  starts_on: "2054-11-16",
  ends_on: "2054-11-28",
  travel_updates: [],
};
const visit = {
  id: "v1",
  area: taipei,
  location: null,
  title: "Hot springs",
  title_nl: "Hot springs",
  title_en: null,
  kind: null,
  status: "planned",
  starts_on: "2054-11-17",
  ends_on: null,
  start_time: null,
  end_time: null,
  notes: null,
  summary: null,
  summary_nl: null,
  summary_en: null,
  visibility: "private",
  share_time: false,
  share_date_precision: "month",
  notes_html: null,
  summary_html: null,
  possible_route_duplicates: [],
} satisfies Api.VisitResponse;
const stay = {
  check_in_time: null,
  check_out_time: null,
  website_url: null,
  booking_reference: null,
  contact_details: null,
  notes: null,
  share_date_precision: null,
  notes_html: null,
  contact_details_html: null,
  id: "s1",
  check_in_date: "2054-11-16",
  check_out_date: "2054-11-18",
  status: "planned",
  property_name: "Hotel Royal",
  location: null,
  area: taipei,
  visibility: "private",
  document_asset_ids: [],
} satisfies Api.StayResponse;
const route = {
  label_nl: null,
  label_en: null,
  departure_timezone: null,
  arrival_timezone: null,
  carrier: null,
  service_reference: null,
  travel_class: null,
  booking_reference: null,
  notes: null,
  geometry: null,
  notes_html: null,
  id: "r1",
  mode: "train",
  status: "planned",
  label: "Taipei to Tainan",
  departs_on: "2054-11-19",
  departs_at: null,
  arrives_at: null,
  departure_area: taipei,
  departure_location: null,
  arrival_area: taipei,
  arrival_location: null,
  visibility: "private",
  document_asset_ids: [],
} satisfies Api.RouteResponse;

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi()
    .collection<Api.VisitResponse>("/api/trips/trip/visits", [visit])
    .collection<Api.StayResponse>("/api/trips/trip/stays", [stay])
    .collection<Api.RouteResponse>("/api/trips/trip/routes", [route])
    .collection<Api.AreaResponse>("/api/trips/trip/areas", [taipei])
    .collection<Api.LocationResponse>("/api/trips/trip/locations", [])
    .collection<Api.DocumentResponse>("/api/documents?trip_id=trip", [])
    .collection<Api.AlternativeGroupResponse>("/api/trips/trip/alternative-groups", [])
    .on<Api.RouteReference[]>("POST", /\/api\/trips\/trip\/visits\/route-check$/, () => []);
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  expect(api.unexpected).toEqual([]);
  await resetOfflineDb();
});

const notices = () => {
  const seen: string[] = [];
  return {
    seen,
    report: (notice: ErrorNotice | MessageNotice) => seen.push(noticeMessage(notice)),
  };
};

it("opens a visit on a focus request, deletes it and reports it through the callback", async () => {
  const { seen, report } = notices();
  renderWithOwner(<VisitEditor trip={trip} focusId={{ id: "v1", token: 1 }} onNotice={report} />);
  const dialog = await screen.findByRole("dialog", { name: "Bezoek" });
  expect(within(dialog).getByText("Hot springs")).toBeTruthy();
  // The editor shows no status line of its own: the block around it does.
  expect(screen.queryByRole("status")).toBeNull();

  fireEvent.click(within(dialog).getByRole("button", { name: "Verwijderen" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );
  await waitFor(() => expect(seen).toEqual(["Bezoek verwijderd."]));
  expect(api.count("DELETE /api/trips/trip/visits/v1")).toBe(1);
});

it("starts a new record of each kind on a create request and reports it handled once", async () => {
  const { report } = notices();
  const cases = [
    {
      name: "Bezoek toevoegen",
      render: (props: object) => <VisitEditor trip={trip} onNotice={report} {...props} />,
      kind: "visit" as const,
    },
    {
      name: "Verblijf toevoegen",
      render: (props: object) => <StayEditor trip={trip} onNotice={report} {...props} />,
      kind: "stay" as const,
    },
    {
      name: "Route toevoegen",
      render: (props: object) => <RouteEditor trip={trip} onNotice={report} {...props} />,
      kind: "route" as const,
    },
  ];
  for (const item of cases) {
    const handled = vi.fn();
    const { unmount } = renderWithOwner(
      item.render({
        createRequest: { kind: item.kind, prefill: { day: "2054-11-20" }, token: 1 },
        onCreateHandled: handled,
      }),
    );
    expect(await screen.findByRole("dialog", { name: item.name })).toBeTruthy();
    expect(handled).toHaveBeenCalledTimes(1);
    unmount();
    cleanup();
  }
});

it("ignores a create request addressed to another kind", async () => {
  const handled = vi.fn();
  renderWithOwner(
    <StayEditor
      trip={trip}
      onNotice={() => {}}
      createRequest={{ kind: "route", prefill: {}, token: 1 }}
      onCreateHandled={handled}
    />,
  );
  await waitFor(() => expect(api.count("GET /api/trips/trip/stays")).toBeGreaterThan(0));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(handled).not.toHaveBeenCalled();
});

it("opens a stay and a route on a focus request", async () => {
  const { report } = notices();
  renderWithOwner(<StayEditor trip={trip} focusId={{ id: "s1", token: 1 }} onNotice={report} />);
  expect(await screen.findByRole("dialog", { name: "Verblijf" })).toBeTruthy();
  cleanup();
  renderWithOwner(<RouteEditor trip={trip} focusId={{ id: "r1", token: 1 }} onNotice={report} />);
  expect(await screen.findByRole("dialog", { name: "Route" })).toBeTruthy();
});
