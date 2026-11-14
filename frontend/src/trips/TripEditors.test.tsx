// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { noticeMessage } from "../query/feedback";
import type { MessageNotice, ErrorNotice } from "../query/feedback";
import { renderWithOwner, resetOfflineDb, testToken } from "../query/test-utils";
import type { Area, Route, Stay, Trip, Visit } from "../api-types";
import { RouteEditor } from "./routes/RouteEditor";
import { StayEditor } from "./stays/StayEditor";
import { VisitEditor } from "./visits/VisitEditor";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const taipei: Area = {
  id: "taipei",
  visibility: "private",
  label: "Taipei",
  country_code: "TW",
  region: null,
  latitude: 25.03,
  longitude: 121.56,
  timezone: null,
};
const trip: Trip = {
  owner_subject: "owner-1",
  cover_derivative_id: null,
  cover_url: null,
  summary_html: null,
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: "2054-11-16",
  ends_on: "2054-11-28",
  travel_updates: [],
};
const visit = {
  id: "v1",
  area: taipei,
  location: null,
  title: "Hot springs",
  kind: null,
  status: "planned",
  starts_on: "2054-11-17",
  ends_on: null,
  start_time: null,
  end_time: null,
  notes: null,
  summary: null,
  visibility: "private",
  share_time: false,
  share_date_precision: "month",
  notes_html: null,
  summary_html: null,
  possible_route_duplicates: [],
} as Visit;
const stay = {
  id: "s1",
  check_in_date: "2054-11-16",
  check_out_date: "2054-11-18",
  status: "planned",
  property_name: "Hotel Royal",
  location: null,
  area: taipei,
  visibility: "private",
  document_asset_ids: [],
} as unknown as Stay;
const route = {
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
} as unknown as Route;

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi()
    .collection("/api/trips/trip/visits", [visit])
    .collection("/api/trips/trip/stays", [stay])
    .collection("/api/trips/trip/routes", [route])
    .collection("/api/trips/trip/areas", [taipei])
    .collection("/api/trips/trip/locations", [])
    .collection("/api/trips/trip/documents", [])
    .collection("/api/trips/trip/alternative-groups", [])
    .on("POST", /\/api\/trips\/trip\/visits\/route-check$/, () => []);
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
