// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { BroadPlaceManager } from "./BroadPlaceManager";
import { StayManager } from "./StayManager";
import { TransportLegManager } from "./TransportLegManager";

const auth = vi.hoisted(() => ({ session: { accessToken: "token" } }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip = { id: "trip", title: "Exampleland", summary: null, starts_on: "2054-11-16", ends_on: null, visibility: "private" as const, publication_state: "draft" as const, route_stages: [], highlights: [], moments: [], moment_excerpts: [] };
const broadPlace = { id: "broad", label: "Taipei", country_code: "TW", region: "Taipei City", latitude: 25.03, longitude: 121.56, timezone: "Asia/Taipei" };
const stay = { id: "stay", check_in_date: "2054-11-16", check_out_date: "2054-11-18", check_in_time: null, check_out_time: null, status: "booked" as const, property_name: "Hotel", website_url: null, booking_reference: "ABC", contact_details: null, notes: null, place: null, broad_place: broadPlace };
const leg = { id: "leg", kind: "flight" as const, status: "booked" as const, departure_place: { locality: "Brussels", display_name: "BRU" }, arrival_place: { locality: "Taipei", display_name: "TPE" }, departs_at: "2054-11-16T09:00:00Z", arrives_at: "2054-11-16T21:00:00Z", departure_timezone: "Europe/Brussels", arrival_timezone: "Asia/Taipei", carrier: null, service_reference: null, travel_class: null, booking_reference: "REF", notes: null, document_asset_ids: [] };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens a broad place in detail before its editor", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify([broadPlace]), { status: 200 }))));
  render(<BroadPlaceManager trip={trip} onChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Brede plaats Taipei bekijken" }));
  expect(screen.getByRole("heading", { name: "Taipei" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Brede plaats bewerken" })).toBeTruthy();
});

it("opens a stay in private detail before editing", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.endsWith("broad-stay-cards") ? [] : [stay]), { status: 200 }))));
  render(<StayManager trip={trip} broadPlaces={[broadPlace]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Hotel/ }));
  expect(screen.getByText("Boekingsreferentie: ABC")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Verblijf bewerken" })).toBeTruthy();
});

it("opens transport detail before its editor", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.endsWith("documents") ? [] : [leg]), { status: 200 }))));
  render(<TransportLegManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Vlucht: Brussels/ }));
  expect(screen.getByText("Boekingsreferentie: REF")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Transportonderdeel bewerken" })).toBeTruthy();
});
