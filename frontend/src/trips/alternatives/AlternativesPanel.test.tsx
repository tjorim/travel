// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../../query/fake-api";
import { renderWithOwner, testToken } from "../../query/test-utils";
import type { AlternativeGroup, AlternativeSuggestion, Area, Stay } from "../../tracker-model";
import { AlternativesPanel } from "./AlternativesPanel";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../../auth-context", () => ({ useAuth: () => auth }));

const area: Area = {
  id: "area-1",
  visibility: "private",
  label: "Taipei",
  country_code: "TW",
  region: null,
  latitude: null,
  longitude: null,
  timezone: null,
};
const stay = (id: string, name: string, fields: Partial<Stay> = {}): Stay => ({
  id,
  check_in_date: "2054-11-16",
  check_out_date: "2054-11-18",
  check_in_time: null,
  check_out_time: null,
  status: "idea",
  property_name: name,
  website_url: null,
  booking_reference: null,
  contact_details: null,
  notes: null,
  location: null,
  area,
  visibility: "private",
  share_date_precision: null,
  ...fields,
});
const hotels = [
  stay("a", "Hotel A"),
  stay("b", "Hotel B", { notes: "Quiet room on the 9th floor" }),
  stay("c", "Hotel C", { status: "planned" }),
];
const groupOf = (members: Stay[], chosenId: string | null = null): AlternativeGroup => ({
  id: "g1",
  kind: "stay",
  label: null,
  chosen_id: chosenId,
  members: members.map((item) => ({
    record_id: item.id,
    chosen: item.id === chosenId,
    stay: item,
    visit: null,
    route: null,
  })),
  created_at: "2054-01-01T00:00:00Z",
  updated_at: "2054-01-01T00:00:00Z",
});
const suggestion: AlternativeSuggestion = {
  kind: "stay",
  member_ids: ["a", "b"],
  starts_on: "2054-11-16",
  ends_on: "2054-11-18",
  reason: "overlapping_nights",
};

let api: FakeApi;
const base = "/api/trips/trip/alternative-groups";
function render(groups: AlternativeGroup[] = [], suggestions: AlternativeSuggestion[] = []) {
  api = fakeApi()
    .collection(base, groups)
    .collection(`${base}/suggestions`, suggestions as never)
    .collection("/api/trips/trip/stays", hotels);
  const open = vi.fn();
  renderWithOwner(<AlternativesPanel tripId="trip" kind="stay" records={hotels} onOpen={open} />);
  return open;
}
beforeEach(() => {
  auth.session = { accessToken: testToken() };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(api.unexpected).toEqual([]);
});

it("shows nothing when there is nothing to group", async () => {
  api = fakeApi().collection(base, []).collection(`${base}/suggestions`, []);
  const { container } = renderWithOwner(
    <AlternativesPanel tripId="trip" kind="stay" records={[hotels[0]]} onOpen={() => {}} />,
  );
  await waitFor(() => expect(api.count(`GET ${base}`)).toBe(1));
  expect(container.querySelector("section")).toBeNull();
});

it("suggests a group from loose ideas and stores it only when the owner confirms", async () => {
  render([], [suggestion]);
  const item = await screen.findByText("Overlappende nachten · 16 nov → 18 nov");
  expect(within(item.closest("li")!).getByText("Hotel A · Hotel B")).toBeTruthy();
  expect(api.count(`POST ${base}`)).toBe(0);
  api.on("POST", /alternative-groups$/, () => groupOf([hotels[0], hotels[1]]));
  fireEvent.click(screen.getByRole("button", { name: "Groepeer deze: Hotel A, Hotel B" }));
  await screen.findByText("Alternatieven gegroepeerd.");
  expect(api.lastBody(`POST ${base}`)).toEqual({
    kind: "stay",
    member_ids: ["a", "b"],
    label: null,
  });
});

it("chooses one after a confirmation, tells what happens to the others, undoes it and returns focus to the group", async () => {
  const group = groupOf([hotels[0], hotels[1]]);
  render([group]);
  const box = await screen.findByRole("group", { name: "Alternatieven · 16 nov → 18 nov" });
  expect(within(box).getByText("Nog niet gekozen")).toBeTruthy();
  api.on("POST", /choose$/, () => ({
    group: groupOf([hotels[0], hotels[1]], "b"),
    event_id: "event-1",
    chosen_id: "b",
    cancelled_ids: ["a"],
    removed_ids: [],
    undoable: true,
  }));
  api.on("POST", /undo-choice$/, () => groupOf([hotels[0], hotels[1]]));

  fireEvent.click(within(box).getByRole("button", { name: "Kies deze: Hotel B" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText("Hotel B kiezen?")).toBeTruthy();
  expect(within(dialog).getByText(/Ze worden op geannuleerd gezet en privé gemaakt/)).toBeTruthy();
  // Nothing changes until the choice is confirmed.
  expect(api.count(`POST ${base}/g1/choose`)).toBe(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Kies deze" }));
  await screen.findByText("Hotel B is gekozen. De andere alternatieven zijn geannuleerd.");
  expect(api.lastBody(`POST ${base}/g1/choose`)).toEqual({ member_id: "b", others: "cancel" });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("group", { name: /Alternatieven/ })),
  );

  fireEvent.click(screen.getByRole("button", { name: "Ongedaan maken" }));
  await screen.findByText("Keuze ongedaan gemaakt.");
  expect(api.lastBody(`POST ${base}/g1/undo-choice`)).toEqual({ event_id: "event-1" });
  expect(screen.queryByRole("button", { name: "Ongedaan maken" })).toBeNull();
});

it("warns that removing the others is permanent and offers no undo afterwards", async () => {
  render([groupOf([hotels[0], hotels[1]])]);
  api.on("POST", /choose$/, () => ({
    group: groupOf([hotels[0]], "a"),
    event_id: "event-2",
    chosen_id: "a",
    cancelled_ids: [],
    removed_ids: ["b"],
    undoable: false,
  }));
  fireEvent.click(await screen.findByRole("button", { name: "Kies deze: Hotel A" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("radio", { name: "Verwijderen" }));
  expect(within(dialog).getByText(/definitief verwijderd/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Kies deze" }));
  await screen.findByText("Hotel A is gekozen. De andere alternatieven zijn verwijderd.");
  expect(api.lastBody(`POST ${base}/g1/choose`)).toEqual({ member_id: "a", others: "remove" });
  expect(screen.queryByRole("button", { name: "Ongedaan maken" })).toBeNull();
});

it("explains why an undo was refused, in the interface language", async () => {
  render([groupOf([hotels[0], hotels[1]])]);
  api.on("POST", /choose$/, () => ({
    group: groupOf([hotels[0], hotels[1]], "b"),
    event_id: "event-3",
    chosen_id: "b",
    cancelled_ids: ["a"],
    removed_ids: [],
    undoable: true,
  }));
  fireEvent.click(await screen.findByRole("button", { name: "Kies deze: Hotel B" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Kies deze" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Ongedaan maken" }));
  api.failNext = {
    status: 409,
    body: {
      detail: "edited",
      errors: [{ code: "the_alternatives_changed_since_this_choice", params: {}, path: [] }],
    },
  };
  await waitFor(() => expect(api.count(`POST ${base}/g1/undo-choice`)).toBe(1));
  expect(await screen.findByText(/De alternatieven zijn na deze keuze bewerkt/)).toBeTruthy();
});

it("compares the members side by side, including the exact location and notes only the owner sees", async () => {
  const exact = stay("a", "Hotel A", {
    location: {
      id: "loc",
      visibility: "private",
      label: null,
      area_id: "area-1",
      share_address: false,
      display_name: "Hotel A, 1 Xinyi Road",
      address_line1: "1 Xinyi Road",
      locality: "Taipei",
      country_code: "TW",
    } as Stay["location"],
  });
  render([groupOf([exact, hotels[1]])]);
  fireEvent.click(await screen.findByRole("button", { name: "Vergelijken" }));
  const dialog = await screen.findByRole("dialog");
  const table = within(dialog).getByRole("table");
  expect(within(table).getByRole("columnheader", { name: "Hotel A" })).toBeTruthy();
  expect(within(table).getByRole("columnheader", { name: "Hotel B" })).toBeTruthy();
  const row = within(table).getByRole("row", { name: /Exacte locatie/ });
  expect(row.textContent).toContain("1 Xinyi Road");
  expect(within(table).getByText("Quiet room on the 9th floor")).toBeTruthy();
});

it("changes the members of a group and dissolves it after a confirmation", async () => {
  render([groupOf([hotels[0], hotels[1]])]);
  api.on("PATCH", /alternative-groups\/g1$/, () => groupOf(hotels));
  fireEvent.click(await screen.findByRole("button", { name: "Leden bewerken" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Hotel C" }));
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Hotel A" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Groep opslaan" }));
  await screen.findByText("Groep bijgewerkt.");
  expect(api.lastBody(`PATCH ${base}/g1`)).toEqual({
    add_member_ids: ["c"],
    remove_member_ids: ["a"],
  });

  api.on("DELETE", /alternative-groups\/g1$/, () => undefined);
  fireEvent.click(screen.getByRole("button", { name: "Groep opheffen" }));
  const confirm = await screen.findByRole("alertdialog");
  expect(api.count(`DELETE ${base}/g1`)).toBe(0);
  fireEvent.click(within(confirm).getByRole("button", { name: "Groep opheffen" }));
  await screen.findByText("Groep opgeheven.");
  expect(api.count(`DELETE ${base}/g1`)).toBe(1);
});

it("builds a group by hand from loose records and needs two of them", async () => {
  render([]);
  api.on("POST", /alternative-groups$/, () => groupOf([hotels[0], hotels[2]]));
  fireEvent.click(await screen.findByRole("button", { name: "Alternatieven groeperen" }));
  const dialog = await screen.findByRole("dialog");
  const save = within(dialog).getByRole("button", { name: "Groep opslaan" });
  expect(within(dialog).getByText("Kies minstens twee records.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Hotel A" }));
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Hotel C" }));
  fireEvent.click(save);
  await screen.findByText("Alternatieven gegroepeerd.");
  expect(api.lastBody(`POST ${base}`)).toEqual({
    kind: "stay",
    member_ids: ["a", "c"],
    label: null,
  });
});
