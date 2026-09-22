// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AuthProvider } from "../auth-context";
import { __resetOfflineStoreForTests } from "../offline/offline-store";
import type { EmergencyInfoEntry } from "../tracker-model";
import { EmergencyInfoManager } from "./EmergencyInfoManager";

function fakeAccessToken(subject: string): string {
  const payload = btoa(JSON.stringify({ sub: subject })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `header.${payload}.signature`;
}

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  await __resetOfflineStoreForTests();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("travel-offline-v1");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

function withSession(): void {
  sessionStorage.setItem("travel-tracker-session", JSON.stringify({ accessToken: fakeAccessToken("owner-1"), expiresAt: Date.now() + 60_000 }));
}

function stubFetch(entries: EmergencyInfoEntry[]): { calls: { url: string; method: string }[] } {
  const state = { entries: entries.slice(), calls: [] as { url: string; method: string }[] };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    state.calls.push({ url, method });
    if (method === "DELETE") {
      state.entries = state.entries.filter((entry) => !url.endsWith(entry.id));
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url === "/api/library/emergency-info") return Promise.resolve(new Response(JSON.stringify(state.entries), { status: 200 }));
    return Promise.resolve(new Response(null, { status: 404 }));
  }));
  return state;
}

function entry(overrides: Partial<EmergencyInfoEntry> = {}): EmergencyInfoEntry {
  return {
    id: "entry-1",
    kind: "contact",
    label: "Mom",
    value: "+32 470 00 00 00",
    notes: null,
    created_at: "2054-01-01T00:00:00Z",
    ...overrides,
  };
}

it("lists emergency-info entries without needing a trip", async () => {
  withSession();
  stubFetch([entry()]);
  render(<AuthProvider><EmergencyInfoManager /></AuthProvider>);
  await screen.findByText("Mom");
  expect(screen.getByText((content) => content.includes("+32 470 00 00 00"))).toBeTruthy();
});

it("shows an empty state without any emergency-info entry", async () => {
  withSession();
  stubFetch([]);
  render(<AuthProvider><EmergencyInfoManager /></AuthProvider>);
  await screen.findByText("Nog geen noodinformatie. Voeg een contact, nummer of medische notitie toe.");
});

it("deletes an entry after explicit confirmation", async () => {
  withSession();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const state = stubFetch([entry()]);
  render(<AuthProvider><EmergencyInfoManager /></AuthProvider>);
  await screen.findByText("Mom");

  screen.getByRole("button", { name: "Verwijderen" }).click();

  await screen.findByText("Nog geen noodinformatie. Voeg een contact, nummer of medische notitie toe.");
  expect(state.calls.some((call) => call.method === "DELETE" && call.url === "/api/library/emergency-info/entry-1")).toBe(true);
});

it("lets the owner pin an emergency-info entry for offline access and unpin it again", async () => {
  withSession();
  stubFetch([entry()]);
  render(<AuthProvider><EmergencyInfoManager /></AuthProvider>);
  await screen.findByText("Mom");

  screen.getByRole("button", { name: "Offline bewaren" }).click();
  await screen.findByText("“Mom” is offline bewaard op dit toestel.");
  await screen.findByRole("button", { name: "Offline verwijderen" });

  screen.getByRole("button", { name: "Offline verwijderen" }).click();
  await screen.findByText("“Mom” is niet langer offline beschikbaar.");
  await screen.findByRole("button", { name: "Offline bewaren" });
});
