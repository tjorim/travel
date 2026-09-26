// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, resetOfflineDb, testToken } from "../query/test-utils";
import type { Area, Location, Stay, Trip, Visit } from "../tracker-model";
import { VisitManager, overnights, visitWhen } from "./VisitManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const area = (id: string, label: string, latitude: number | null = null, longitude: number | null = null): Area => ({ id, visibility: "private", label, country_code: "TW", region: null, latitude, longitude, timezone: null });
const taipei = area("taipei", "Taipei", 25.03, 121.56), tainan = area("tainan", "Tainan");
const spring = { id: "spring", area_id: "taipei", label: null, visibility: "private", display_name: "Beitou Hot Spring, 12 Guangming Road", locality: "Taipei", latitude: 25.13, longitude: 121.5 } as unknown as Location;
const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: "2054-11-16", ends_on: "2054-11-28", travel_updates: [] };
const visit = (id: string, position: number, overrides: Partial<Visit> = {}): Visit => ({
  id, position, area: taipei, location: null, title: null, kind: null, status: "planned", starts_on: null, ends_on: null, start_time: null, end_time: null,
  notes: null, summary: null, visibility: "private", share_time: false, share_date_precision: "month", ...overrides,
});
const stay = { id: "s1", check_in_date: "2054-11-16", check_out_date: "2054-11-20", status: "booked", property_name: "Hotel Royal", location: {}, area: taipei } as unknown as Stay;

let api: FakeApi;
function seed(visits: Visit[] = []) {
  api = fakeApi()
    .collection("/api/trips/trip/visits", visits, {
      create: (body, count) => visit(`new-${count}`, count, { title: (body.title as string | null) ?? null, starts_on: (body.starts_on as string | null) ?? null, start_time: (body.start_time as string | null) ?? null, share_time: Boolean(body.share_time), area: (body.area_id === "tainan" ? tainan : taipei), location: body.location && (body.location as { existing_location_id?: string }).existing_location_id ? spring : null }),
      update: (row, body) => ({ ...row, ...body }),
    })
    .collection("/api/trips/trip/areas", [taipei, tainan])
    .collection("/api/trips/trip/locations", [spring])
    .collection("/api/trips/trip/stays", [stay]);
}
beforeEach(() => { auth.session = { accessToken: testToken() }; });
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expect(api.unexpected).toEqual([]); await resetOfflineDb(); });

/** Opens the form once the areas and locations it lists have arrived. */
const openNew = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw bezoek" }));
  await screen.findByRole("option", { name: "Tainan (heel gebied)" });
};

it("needs only a place, and says so when there is none", async () => {
  seed();
  renderWithOwner(<VisitManager trip={trip} />);
  await openNew();
  fireEvent.click(screen.getByRole("button", { name: "Bezoek toevoegen" }));
  await screen.findByText("Kies waar het bezoek is: een gebied of een locatie.");
  expect(api.count("POST /api/trips/trip/visits")).toBe(0);

  fireEvent.change(screen.getByLabelText("Waar"), { target: { value: "area:tainan" } });
  fireEvent.click(screen.getByRole("button", { name: "Bezoek toevoegen" }));
  await screen.findByRole("button", { name: "Bezoek Tainan bekijken" });
  expect(api.lastBody("POST /api/trips/trip/visits")).toMatchObject({ area_id: "tainan", location: null, starts_on: null, start_time: null, share_time: false, position: 0 });
});

it("takes a location from the nested list, a time on a day, and keeps the time private by default", async () => {
  seed();
  renderWithOwner(<VisitManager trip={trip} />);
  await openNew();
  const where = screen.getByLabelText("Waar") as HTMLSelectElement;
  expect(within(where.querySelector("optgroup[label='Taipei']") as HTMLElement).getByText("Beitou Hot Spring")).toBeTruthy();
  fireEvent.change(where, { target: { value: "location:spring" } });
  fireEvent.change(screen.getByLabelText("Titel (optioneel)"), { target: { value: "Warme bron" } });

  // A time belongs to a day.
  expect((screen.getByLabelText("Begintijd (optioneel)") as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Eerste dag (optioneel)"), { target: { value: "2054-11-21" } });
  fireEvent.change(screen.getByLabelText("Begintijd (optioneel)"), { target: { value: "18:30" } });
  fireEvent.change(screen.getByLabelText("Eindtijd (optioneel)"), { target: { value: "21:00" } });
  expect((screen.getByLabelText(/Toon de tijd aan bezoekers/) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Bezoek toevoegen" }));
  await screen.findByRole("button", { name: "Bezoek Warme bron bekijken" });
  expect(api.lastBody("POST /api/trips/trip/visits")).toMatchObject({
    title: "Warme bron", location: { existing_location_id: "spring" }, starts_on: "2054-11-21", ends_on: null, start_time: "18:30", end_time: "21:00", share_time: false, share_date_precision: "month",
  });
});

it("chooses to show the time to visitors", async () => {
  seed();
  renderWithOwner(<VisitManager trip={trip} />);
  await openNew();
  fireEvent.change(screen.getByLabelText("Waar"), { target: { value: "area:taipei" } });
  fireEvent.change(screen.getByLabelText("Eerste dag (optioneel)"), { target: { value: "2054-11-21" } });
  fireEvent.change(screen.getByLabelText("Begintijd (optioneel)"), { target: { value: "10:00" } });
  fireEvent.change(screen.getByLabelText("Datums voor bezoekers"), { target: { value: "day" } });
  fireEvent.click(screen.getByLabelText(/Toon de tijd aan bezoekers/));
  fireEvent.click(screen.getByRole("button", { name: "Bezoek toevoegen" }));
  await waitFor(() => expect(api.lastBody("POST /api/trips/trip/visits")).toMatchObject({ share_time: true, share_date_precision: "day", start_time: "10:00" }));
});

it("rewrites the place only when it changed, and shows where the nights are spent", async () => {
  seed([visit("v1", 0, { title: "Werken in Linkou", kind: "work", status: "idea", starts_on: "2054-11-18", ends_on: "2054-11-24" })]);
  renderWithOwner(<VisitManager trip={trip} />);
  expect((await screen.findAllByText(/Overnachting: Hotel Royal · nog 5 nachten zonder verblijf/)).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Bezoek Werken in Linkou bekijken" }).textContent).toContain("Idee · Werk");
  fireEvent.click(screen.getByRole("button", { name: "Bezoek Werken in Linkou bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  await screen.findByRole("option", { name: "Tainan (heel gebied)" });
  expect((screen.getByLabelText("Waar") as HTMLSelectElement).value).toBe("area:taipei");
  expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("idea");
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "confirmed" } });
  fireEvent.change(screen.getByLabelText("Notities (optioneel, altijd privé)"), { target: { value: "Laptop mee" } });
  fireEvent.click(screen.getByRole("button", { name: "Bezoek opslaan" }));
  await screen.findByText("Bezoek opgeslagen.");
  const sent = api.lastBody<Record<string, unknown>>("PATCH /api/trips/trip/visits/v1")!;
  expect(sent).toMatchObject({ notes: "Laptop mee", kind: "work", status: "confirmed" });
  expect(sent).not.toHaveProperty("area_id");
  expect(sent).not.toHaveProperty("location");
});

it("reorders and deletes visits after the in-app confirmation", async () => {
  seed([visit("v1", 0, { title: "Eerste" }), visit("v2", 1, { title: "Tweede" })]);
  renderWithOwner(<VisitManager trip={trip} />);
  await screen.findByRole("button", { name: "Bezoek Eerste bekijken" });
  fireEvent.click(screen.getAllByRole("button", { name: "Omlaag" })[0]);
  await waitFor(() => expect(api.lastBody("PATCH /api/trips/trip/visits/v1")).toEqual({ position: 1 }));

  fireEvent.click(screen.getByRole("button", { name: "Bezoek Tweede bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Bezoek Tweede bekijken" })).toBeNull());
  expect(api.count("DELETE /api/trips/trip/visits/v2")).toBe(1);
});

it("describes when a visit is, and which nights a stay covers", () => {
  expect(visitWhen(visit("v", 0))).toBe("Nog geen dag");
  expect(visitWhen(visit("v", 0, { starts_on: "2054-11-21", start_time: "18:30:00", end_time: "21:00:00" }))).toMatch(/18:30–21:00$/);
  expect(overnights({ starts_on: "2054-11-18", ends_on: "2054-11-24" }, [stay], trip)).toEqual({ stays: [stay], uncovered: 5 });
  expect(overnights({ starts_on: null, ends_on: null }, [stay], trip)).toEqual({ stays: [], uncovered: 0 });
});
