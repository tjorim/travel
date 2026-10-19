// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import {
  chooseOption,
  renderWithOwner,
  resetOfflineDb,
  selectedOption,
  testToken,
} from "../query/test-utils";
import type { Area, Location, Stay, Trip, Visit } from "../tracker-model";
import { visitWhen } from "./labels";
import { VisitManager } from "./VisitManager";
import { overnights } from "./visits/model";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const area = (
  id: string,
  label: string,
  latitude: number | null = null,
  longitude: number | null = null,
): Area => ({
  id,
  visibility: "private",
  label,
  country_code: "TW",
  region: null,
  latitude,
  longitude,
  timezone: null,
});
const taipei = area("taipei", "Taipei", 25.03, 121.56),
  tainan = area("tainan", "Tainan");
const spring = {
  id: "spring",
  area_id: "taipei",
  label: null,
  visibility: "private",
  display_name: "Beitou Hot Spring, 12 Guangming Road",
  locality: "Taipei",
  latitude: 25.13,
  longitude: 121.5,
} as unknown as Location;
const trip: Trip = {
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: "2054-11-16",
  ends_on: "2054-11-28",
  travel_updates: [],
};
const visit = (id: string, position: number, overrides: Partial<Visit> = {}): Visit => ({
  id,
  position,
  area: taipei,
  location: null,
  title: null,
  kind: null,
  status: "planned",
  starts_on: null,
  ends_on: null,
  start_time: null,
  end_time: null,
  notes: null,
  summary: null,
  visibility: "private",
  share_time: false,
  share_date_precision: "month",
  ...overrides,
});
const stay = {
  id: "s1",
  check_in_date: "2054-11-16",
  check_out_date: "2054-11-20",
  status: "confirmed",
  property_name: "Hotel Royal",
  location: {},
  area: taipei,
} as unknown as Stay;

let api: FakeApi;
function seed(visits: Visit[] = []) {
  api = fakeApi()
    .collection("/api/trips/trip/visits", visits, {
      create: (body, count) =>
        visit(`new-${count}`, count, {
          title: (body.title as string | null) ?? null,
          starts_on: (body.starts_on as string | null) ?? null,
          start_time: (body.start_time as string | null) ?? null,
          share_time: Boolean(body.share_time),
          area: body.area_id === "tainan" ? tainan : taipei,
          location:
            body.location &&
            (body.location as { existing_location_id?: string }).existing_location_id
              ? spring
              : null,
        }),
      update: (row, body) => ({ ...row, ...body }),
    })
    .collection("/api/trips/trip/areas", [taipei, tainan])
    .collection("/api/trips/trip/locations", [spring])
    .collection("/api/trips/trip/stays", [stay])
    .on("POST", /\/api\/trips\/trip\/visits\/route-check$/, () => []);
}
beforeEach(() => {
  auth.session = { accessToken: testToken() };
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(api.unexpected).toEqual([]);
  await resetOfflineDb();
});

/** Opens the form once the areas and locations it lists have arrived, leaving "Waar" open on them. */
const openNew = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw bezoek" }));
  fireEvent.keyDown(await screen.findByRole("combobox", { name: "Waar" }), { key: "ArrowDown" });
  await screen.findByRole("option", { name: "Tainan (heel gebied)" });
};

it("needs only a place, and says so when there is none", async () => {
  seed();
  renderWithOwner(<VisitManager trip={trip} />);
  await openNew();
  fireEvent.click(screen.getByRole("button", { name: "Bezoek toevoegen" }));
  await screen.findByText("Kies waar het bezoek is: een gebied of een locatie.");
  expect(api.count("POST /api/trips/trip/visits")).toBe(0);

  chooseOption("Waar", "Tainan (heel gebied)");
  fireEvent.click(screen.getByRole("button", { name: "Bezoek toevoegen" }));
  await screen.findByRole("button", { name: "Bezoek Tainan bekijken" });
  expect(api.lastBody("POST /api/trips/trip/visits")).toMatchObject({
    area_id: "tainan",
    location: null,
    starts_on: null,
    start_time: null,
    share_time: false,
    position: 0,
  });
});

it("takes a location from the nested list, a time on a day, and keeps the time private by default", async () => {
  seed();
  renderWithOwner(<VisitManager trip={trip} />);
  await openNew();
  const stationOption = screen.getByRole("option", { name: "Beitou Hot Spring" });
  expect(stationOption.closest("[role=group]")?.textContent).toContain("Taipei");
  chooseOption("Waar", "Beitou Hot Spring");
  fireEvent.change(screen.getByLabelText("Titel (optioneel)"), { target: { value: "Warme bron" } });

  // A time belongs to a day.
  expect((screen.getByLabelText("Begintijd (optioneel)") as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Eerste dag (optioneel)"), {
    target: { value: "2054-11-21" },
  });
  fireEvent.change(screen.getByLabelText("Begintijd (optioneel)"), { target: { value: "18:30" } });
  fireEvent.change(screen.getByLabelText("Eindtijd (optioneel)"), { target: { value: "21:00" } });
  expect(
    screen
      .getByRole("checkbox", { name: /Toon de tijd aan bezoekers/ })
      .getAttribute("aria-checked"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Bezoek toevoegen" }));
  await screen.findByRole("button", { name: "Bezoek Warme bron bekijken" });
  expect(api.lastBody("POST /api/trips/trip/visits")).toMatchObject({
    title: "Warme bron",
    location: { existing_location_id: "spring" },
    starts_on: "2054-11-21",
    ends_on: null,
    start_time: "18:30",
    end_time: "21:00",
    share_time: false,
    share_date_precision: "month",
  });
});

it("chooses to show the time to visitors", async () => {
  seed();
  renderWithOwner(<VisitManager trip={trip} />);
  await openNew();
  chooseOption("Waar", "Taipei (heel gebied)");
  fireEvent.change(screen.getByLabelText("Eerste dag (optioneel)"), {
    target: { value: "2054-11-21" },
  });
  fireEvent.change(screen.getByLabelText("Begintijd (optioneel)"), { target: { value: "10:00" } });
  chooseOption("Datums voor bezoekers", "Volledige datums");
  fireEvent.click(screen.getByRole("checkbox", { name: /Toon de tijd aan bezoekers/ }));
  fireEvent.click(screen.getByRole("button", { name: "Bezoek toevoegen" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/visits")).toMatchObject({
      share_time: true,
      share_date_precision: "day",
      start_time: "10:00",
    }),
  );
});

it("hints, without blocking, that a visit restates an existing route", async () => {
  seed([
    visit("v1", 0, {
      title: "Vertrek EX101",
      starts_on: "2054-11-16",
      possible_route_duplicates: [{ id: "r1", title: "Schiphol → Taoyuan" }],
    }),
    visit("v2", 1, { title: "Lunch", starts_on: "2054-11-16" }),
  ]);
  renderWithOwner(<VisitManager trip={trip} />);
  const notes = await screen.findAllByRole("note");
  expect(notes).toHaveLength(1);
  expect(notes[0].textContent).toContain("Schiphol → Taoyuan");
});

it("warns before saving when the draft visit restates a route, and never blocks the save", async () => {
  seed();
  api.on("POST", /\/api\/trips\/trip\/visits\/route-check$/, (body) =>
    (body as { title: string }).title === "Vertrek EX101"
      ? [{ id: "r1", title: "Schiphol → Taoyuan" }]
      : [],
  );
  renderWithOwner(<VisitManager trip={trip} />);
  await openNew();
  chooseOption("Waar", "Taipei (heel gebied)");
  fireEvent.change(screen.getByLabelText("Eerste dag (optioneel)"), {
    target: { value: "2054-11-16" },
  });
  fireEvent.change(screen.getByLabelText("Titel (optioneel)"), { target: { value: "Lunch" } });
  await new Promise((resolve) => setTimeout(resolve, 700));
  expect(screen.queryByRole("note")).toBeNull();

  fireEvent.change(screen.getByLabelText("Titel (optioneel)"), {
    target: { value: "Vertrek EX101" },
  });
  expect((await screen.findByRole("note", undefined, { timeout: 2000 })).textContent).toContain(
    "Schiphol → Taoyuan",
  );
  expect(api.lastBody("POST /api/trips/trip/visits/route-check")).toMatchObject({
    area_id: "taipei",
    title: "Vertrek EX101",
    starts_on: "2054-11-16",
  });

  fireEvent.click(screen.getByRole("button", { name: "Bezoek toevoegen" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/visits")).toMatchObject({ title: "Vertrek EX101" }),
  );
});

it("rewrites the place only when it changed, and shows where the nights are spent", async () => {
  seed([
    visit("v1", 0, {
      title: "Werken in Linkou",
      kind: "work",
      status: "idea",
      starts_on: "2054-11-18",
      ends_on: "2054-11-24",
    }),
  ]);
  renderWithOwner(<VisitManager trip={trip} />);
  expect(
    (await screen.findAllByText(/Overnachting: Hotel Royal · nog 5 nachten zonder verblijf/))
      .length,
  ).toBeGreaterThan(0);
  expect(
    screen.getByRole("button", { name: "Bezoek Werken in Linkou bekijken" }).textContent,
  ).toContain("Idee · Werk");
  fireEvent.click(screen.getByRole("button", { name: "Bezoek Werken in Linkou bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.keyDown(await screen.findByRole("combobox", { name: "Waar" }), { key: "ArrowDown" });
  await screen.findByRole("option", { name: "Tainan (heel gebied)" });
  expect(selectedOption("Waar")).toBe("Taipei (heel gebied)");
  expect(selectedOption("Status")).toBe("Idee");
  chooseOption("Status", "Bevestigd");
  fireEvent.change(screen.getByLabelText("Notities (optioneel, altijd privé)"), {
    target: { value: "Laptop mee" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Bezoek opslaan" }));
  await screen.findByText("Bezoek opgeslagen.");
  const sent = api.lastBody<Record<string, unknown>>("PATCH /api/trips/trip/visits/v1")!;
  expect(sent).toMatchObject({ notes: "Laptop mee", kind: "work", status: "confirmed" });
  expect(sent).not.toHaveProperty("area_id");
  expect(sent).not.toHaveProperty("location");
});

it("cancels a visit idea and keeps it off the share controls", async () => {
  seed([visit("v1", 0, { title: "Hot springs", status: "idea" })]);
  renderWithOwner(<VisitManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Bezoek Hot springs bekijken" }));
  expect(screen.queryByText(/Een geannuleerd bezoek wordt nooit gedeeld/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(selectedOption("Status")).toBe("Idee");
  chooseOption("Status", "Geannuleerd");
  fireEvent.click(screen.getByRole("button", { name: "Bezoek opslaan" }));
  await screen.findByText("Bezoek opgeslagen.");
  expect(api.lastBody("PATCH /api/trips/trip/visits/v1")).toMatchObject({ status: "cancelled" });
  expect(screen.getByRole("button", { name: "Bezoek Hot springs bekijken" }).textContent).toContain(
    "Geannuleerd",
  );
  fireEvent.click(screen.getByRole("button", { name: "Bezoek Hot springs bekijken" }));
  expect(screen.getByText(/Een geannuleerd bezoek wordt nooit gedeeld/)).toBeTruthy();
});

it("reorders and deletes visits after the in-app confirmation", async () => {
  seed([visit("v1", 0, { title: "Eerste" }), visit("v2", 1, { title: "Tweede" })]);
  renderWithOwner(<VisitManager trip={trip} />);
  await screen.findByRole("button", { name: "Bezoek Eerste bekijken" });
  fireEvent.click(screen.getAllByRole("button", { name: /^Omlaag:/ })[0]);
  await waitFor(() =>
    expect(api.lastBody("PATCH /api/trips/trip/visits/v1")).toEqual({ position: 1 }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Bezoek Tweede bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Bezoek Tweede bekijken" })).toBeNull(),
  );
  expect(api.count("DELETE /api/trips/trip/visits/v2")).toBe(1);
});

it("shows visitor text and private notes in their own labelled sections", async () => {
  seed([
    visit("v1", 0, {
      title: "Belém",
      summary: "Torre de Belém bezoeken",
      notes: "Review demo note — bring a light jacket",
    }),
  ]);
  renderWithOwner(<VisitManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Bezoek Belém bekijken" }));
  await screen.findByText("Torre de Belém bezoeken");
  expect(screen.getByText("Voor bezoekers").tagName).toBe("P");
  expect(screen.getByText("Alleen voor jou").tagName).toBe("H4");
  const privateSection = screen.getByText("Alleen voor jou").closest("div")!;
  expect(within(privateSection).getByText("Review demo note — bring a light jacket")).toBeTruthy();
});

it("skips the visitor heading when there is no visitor text", async () => {
  seed([visit("v1", 0, { title: "Alleen privé", summary: null, notes: "Geheime aantekening" })]);
  renderWithOwner(<VisitManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Bezoek Alleen privé bekijken" }));
  await screen.findByText("Geheime aantekening");
  expect(screen.queryByText("Voor bezoekers")).toBeNull();
});

it("says so when there is no private note", async () => {
  seed([visit("v2", 0, { title: "Alleen tekst", summary: "Voor bezoekers tekst", notes: null })]);
  renderWithOwner(<VisitManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Bezoek Alleen tekst bekijken" }));
  await screen.findByText("Geen privénotitie.");
});

it("describes when a visit is, and which nights a stay covers", () => {
  expect(visitWhen(visit("v", 0))).toBe("Nog geen dag");
  expect(
    visitWhen(
      visit("v", 0, { starts_on: "2054-11-21", start_time: "18:30:00", end_time: "21:00:00" }),
    ),
  ).toMatch(/18:30–21:00$/);
  expect(overnights({ starts_on: "2054-11-18", ends_on: "2054-11-24" }, [stay], trip)).toEqual({
    stays: [stay],
    uncovered: 5,
  });
  expect(overnights({ starts_on: null, ends_on: null }, [stay], trip)).toEqual({
    stays: [],
    uncovered: 0,
  });
});
