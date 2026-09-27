// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { Area, Location, Trip } from "../tracker-model";
import { LocationManager } from "./LocationManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, travel_updates: [] };
const location = { id: "e1", area_id: "a1", label: null, visibility: "private", share_address: false, display_name: "Beitou Hot Spring, 12 Guangming Road, Taipei", locality: "Taipei", country_code: "TW", address_line1: "12 Guangming Road" } as Location;
const taipei = { id: "a1", label: "Taipei", visibility: "private", country_code: "TW", region: null, latitude: null, longitude: null, timezone: null } as Area;

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi().collection("/api/trips/trip/locations", [location], { update: (row, body) => ({ ...row, ...body }) });
  api.on("PUT", /\/visibility\/location\/e1$/, (body) => body);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); expect(api.unexpected).toEqual([]); });

it("opens saved details and edits the address with an explicit save", async () => {
  renderWithOwner(<LocationManager trip={trip} areas={[taipei]} request={{ id: "e1", token: 1 }} onNeedArea={() => undefined} />);
  expect(await screen.findByText(/Opgeslagen adres: 12 Guangming Road/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  fireEvent.change(screen.getByLabelText("Adresregel 1 (optioneel)"), { target: { value: "14 Guangming Road" } });
  fireEvent.click(screen.getByRole("button", { name: "Locatie opslaan" }));
  await waitFor(() => expect(api.lastBody("PATCH /api/trips/trip/locations/e1")).toMatchObject({ address_line1: "14 Guangming Road", area_id: "a1" }));
});

it("creates a manual location only after saving and keeps address sharing off", async () => {
  api = fakeApi().collection("/api/trips/trip/locations", []);
  renderWithOwner(<LocationManager trip={trip} areas={[taipei]} request={{ areaId: "a1", token: 2 }} onNeedArea={() => undefined} />);
  fireEvent.change(await screen.findByLabelText("Eigen naam (optioneel)"), { target: { value: "Warmwaterbron" } });
  fireEvent.change(screen.getByLabelText("Adresregel 1 (optioneel)"), { target: { value: "12 Guangming Road" } });
  expect(api.count("POST /api/trips/trip/locations")).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Locatie opslaan" }));
  await waitFor(() => expect(api.lastBody("POST /api/trips/trip/locations")).toMatchObject({ area_id: "a1", display_name: "Warmwaterbron", address_line1: "12 Guangming Road" }));
  expect(api.lastBody<Record<string, unknown>>("POST /api/trips/trip/locations")?.share_address).toBeUndefined();
});
