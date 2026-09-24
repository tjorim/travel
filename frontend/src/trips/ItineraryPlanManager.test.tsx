// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, resetOfflineDb, testToken } from "../query/test-utils";
import { answerConfirmation } from "../test-confirm";
import type { ItineraryEntry, Stay, Trip } from "../tracker-model";
import { ItineraryPlanManager } from "./ItineraryPlanManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: "2054-11-16", ends_on: "2054-11-20", visibility: "private", publication_state: "draft", route_stages: [], highlights: [], moments: [], moment_excerpts: [] };
const entry = (id: string, title: string, position: number, extra: Partial<ItineraryEntry> = {}): ItineraryEntry => ({ id, title, position, day_date: "2054-11-16", end_date: null, kind: null, tentative: false, notes: null, linked_kind: null, linked_id: null, ...extra } as ItineraryEntry);
const stay = { id: "s1", check_in_date: "2054-11-16", check_out_date: "2054-11-18", check_in_time: null, check_out_time: null, status: "booked", property_name: "Hotel", website_url: null, booking_reference: null, contact_details: null, notes: null, place: null, broad_place: null } as Stay;

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi()
    .collection("/api/trips/trip/itinerary-entries", [entry("a", "Aankomst", 0), entry("b", "Stadswandeling", 1)])
    .collection("/api/trips/trip/stays", [stay])
    .collection("/api/trips/trip/transport-legs", [])
    .collection("/api/trips/trip/places", [])
    .collection("/api/trips/trip/documents", []);
});
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expect(api.unexpected).toEqual([]); await resetOfflineDb(); });

const titles = () => screen.getAllByRole("article").map((row) => row.querySelector("strong")?.textContent);

it("shows an edited step at once with its saved values in the form, and resets the form afterwards", async () => {
  renderWithOwner(<ItineraryPlanManager trip={trip} />);
  await screen.findByText("Aankomst");
  fireEvent.click(screen.getAllByRole("button", { name: "Bewerken" })[0]);
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Aankomst");
  expect((screen.getByLabelText("Eerste dag (optioneel)") as HTMLInputElement).value).toBe("2054-11-16");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Aankomst Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Stap opslaan" }));
  await screen.findByText("Aankomst Taipei");
  expect(screen.queryByText("Aankomst")).toBeNull();
  expect(screen.getByText("Planningsstap opgeslagen.")).toBeTruthy();
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("button", { name: "Stap toevoegen" })).toBeTruthy();
});

it("adds a step at the end without a revision prop", async () => {
  renderWithOwner(<ItineraryPlanManager trip={trip} />);
  await screen.findByText("Aankomst");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Vertrek" } });
  fireEvent.click(screen.getByRole("button", { name: "Stap toevoegen" }));
  await screen.findByText("Vertrek");
  expect(titles()).toEqual(["Aankomst", "Stadswandeling", "Vertrek"]);
  expect(api.lastBody("POST /api/trips/trip/itinerary-entries")).toMatchObject({ title: "Vertrek", position: 2 });
});

it("removes a deleted step after the in-app confirmation", async () => {
  renderWithOwner(<ItineraryPlanManager trip={trip} />);
  await screen.findByText("Stadswandeling");
  fireEvent.click(screen.getAllByRole("button", { name: "Verwijderen" })[1]);
  await answerConfirmation();
  await waitFor(() => expect(screen.queryByText("Stadswandeling")).toBeNull());
  expect(screen.getByText("Planningsstap verwijderd.")).toBeTruthy();
  expect(titles()).toEqual(["Aankomst"]);
});

it("does not delete when the confirmation is declined", async () => {
  renderWithOwner(<ItineraryPlanManager trip={trip} />);
  await screen.findByText("Stadswandeling");
  fireEvent.click(screen.getAllByRole("button", { name: "Verwijderen" })[1]);
  await answerConfirmation("Annuleren");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(api.count("DELETE /api/trips/trip/itinerary-entries/b")).toBe(0);
});

it("reorders steps from the refetched list", async () => {
  api.on("PATCH", /^\/api\/trips\/trip\/itinerary-entries\/a$/, (body) => {
    const rows = api.rows("/api/trips/trip/itinerary-entries");
    rows.reverse().forEach((row, index) => { row.position = index; });
    return { ...rows[1], ...(body as object) };
  });
  renderWithOwner(<ItineraryPlanManager trip={trip} />);
  await screen.findByText("Aankomst");
  fireEvent.click(screen.getAllByRole("button", { name: "Omlaag" })[0]);
  await waitFor(() => expect(titles()).toEqual(["Stadswandeling", "Aankomst"]));
  expect(api.lastBody("PATCH /api/trips/trip/itinerary-entries/a")).toEqual({ position: 1 });
});

it("links a step to a stay read from the shared query, and insists on a target", async () => {
  renderWithOwner(<ItineraryPlanManager trip={trip} />);
  await screen.findByText("Aankomst");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Inchecken" } });
  fireEvent.change(screen.getByLabelText("Gekoppeld type (optioneel)"), { target: { value: "stay" } });
  fireEvent.click(screen.getByRole("button", { name: "Stap toevoegen" }));
  await screen.findByText("Kies een gekoppeld onderdeel of laat het gekoppelde type leeg.");
  expect(api.count("POST /api/trips/trip/itinerary-entries")).toBe(0);
  fireEvent.change(screen.getByLabelText("Gekoppeld onderdeel"), { target: { value: "s1" } });
  fireEvent.click(screen.getByRole("button", { name: "Stap toevoegen" }));
  await screen.findByText("Verblijf: Hotel · 16 nov – 17 nov");
  expect(api.lastBody("POST /api/trips/trip/itinerary-entries")).toMatchObject({ linked_kind: "stay", linked_id: "s1" });
});

it("refuses a last day before the first day", async () => {
  renderWithOwner(<ItineraryPlanManager trip={trip} />);
  await screen.findByText("Aankomst");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Uitstap" } });
  fireEvent.change(screen.getByLabelText("Eerste dag (optioneel)"), { target: { value: "2054-11-18" } });
  fireEvent.change(screen.getByLabelText("Laatste dag (optioneel)"), { target: { value: "2054-11-17" } });
  fireEvent.click(screen.getByRole("button", { name: "Stap toevoegen" }));
  await screen.findByText("De laatste dag volgt op de eerste dag.");
  expect(api.count("POST /api/trips/trip/itinerary-entries")).toBe(0);
});
