// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { MomentExcerptManager } from "./MomentExcerptManager";

const auth = vi.hoisted(() => ({ session: { accessToken: "token" } }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip = { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, visibility: "private" as const, publication_state: "draft" as const, route_stages: [], highlights: [], moments: [], moment_excerpts: [{ id: "excerpt", source_moment_id: null, broad_place_id: null, date_precision: "day" as const, story_date: null, title: "Aankomst", body: "De eerste avond." }] };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens a record detail before editing and confirms deletion in-app", async () => {
  const onChange = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))));
  render(<MomentExcerptManager trip={trip} broadPlaces={[]} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Uittreksel Aankomst bekijken" }));
  expect(await screen.findByRole("heading", { name: "Aankomst" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("heading", { name: "Uittreksel bewerken" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Late aankomst" } });
  fireEvent.click(screen.getByRole("button", { name: /Uittreksel bewerken sluiten/ }));
  expect(screen.getByText("Wijzigingen verwerpen?")).toBeTruthy();
});

it("starts Create with a clean draft and keeps input after a failed submit", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ detail: "Opslaan mislukt" }), { status: 422, headers: { "Content-Type": "application/json" } }))));
  render(<MomentExcerptManager trip={trip} broadPlaces={[]} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Nieuw uittreksel" }));
  expect(screen.getByRole("heading", { name: "Uittreksel maken" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Nieuw verhaal" } });
  fireEvent.change(screen.getByLabelText("Uittreksel"), { target: { value: "Tekst" } });
  fireEvent.click(screen.getByRole("button", { name: "Uittreksel maken" }));
  expect(await screen.findByText("Opslaan mislukt")).toBeTruthy();
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Nieuw verhaal");
});

it("saves a clean Create draft and refreshes only this manager", async () => {
  const onChange = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.endsWith("/moment-excerpts")) return Promise.resolve(new Response(JSON.stringify({ id: "new" }), { status: 201 }));
    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
  }));
  render(<MomentExcerptManager trip={{ ...trip, moment_excerpts: [] }} broadPlaces={[]} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Nieuw uittreksel" }));
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Nieuw verhaal" } });
  fireEvent.change(screen.getByLabelText("Uittreksel"), { target: { value: "Tekst" } });
  fireEvent.click(screen.getByRole("button", { name: "Uittreksel maken" }));
  await screen.findByText("Uittreksel opgeslagen. Het is nog niet gedeeld.");
  expect(onChange).toHaveBeenCalledOnce();
});

it("sends DELETE only after the in-app confirmation", async () => {
  const fetcher = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal("fetch", fetcher);
  render(<MomentExcerptManager trip={trip} broadPlaces={[]} onChange={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByRole("button", { name: "Uittreksel Aankomst bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "Verwijderen" })[1]!);
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledWith("/api/trips/trip/moment-excerpts/excerpt", expect.objectContaining({ method: "DELETE" }));
});
