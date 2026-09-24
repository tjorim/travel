// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { AuthProvider } from "../auth-context";
import { renderWithOwner, resetOfflineDb } from "../query/test-utils";
import type { EmergencyInfoEntry } from "../tracker-model";
import { EmergencyInfoManager } from "./EmergencyInfoManager";

function fakeAccessToken(subject: string): string {
  const payload = btoa(JSON.stringify({ sub: subject })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `header.${payload}.signature`;
}

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  await resetOfflineDb();
});

function withSession(): void {
  sessionStorage.setItem("travel-tracker-session", JSON.stringify({ accessToken: fakeAccessToken("owner-1"), expiresAt: Date.now() + 60_000 }));
}

function stubFetch(entries: EmergencyInfoEntry[]): { calls: { url: string; method: string; body?: Record<string, unknown> }[]; entries: EmergencyInfoEntry[]; failNext: { status: number; body: unknown } | null } {
  const state = { entries: entries.slice(), calls: [] as { url: string; method: string; body?: Record<string, unknown> }[], failNext: null as { status: number; body: unknown } | null };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    state.calls.push({ url, method, body });
    if (method !== "GET" && state.failNext) { const failure = state.failNext; state.failNext = null; return Promise.resolve(new Response(JSON.stringify(failure.body), { status: failure.status })); }
    if (method === "POST" && url === "/api/library/emergency-info") {
      const created = entry({ id: `entry-${state.entries.length + 1}`, ...(body as Partial<EmergencyInfoEntry>) });
      state.entries = [...state.entries, created];
      return Promise.resolve(new Response(JSON.stringify(created), { status: 201 }));
    }
    if (method === "PATCH") {
      state.entries = state.entries.map((item) => url.endsWith(item.id) ? { ...item, ...(body as Partial<EmergencyInfoEntry>) } : item);
      return Promise.resolve(new Response(JSON.stringify(state.entries.find((item) => url.endsWith(item.id))), { status: 200 }));
    }
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
  renderWithOwner(<AuthProvider><EmergencyInfoManager /></AuthProvider>);
  await screen.findByText("Mom");
  expect(screen.getByText((content) => content.includes("+32 470 00 00 00"))).toBeTruthy();
});

it("shows an empty state without any emergency-info entry", async () => {
  withSession();
  stubFetch([]);
  renderWithOwner(<AuthProvider><EmergencyInfoManager /></AuthProvider>);
  await screen.findByText("Nog geen noodinformatie. Voeg een contact, nummer of medische notitie toe.");
});

it("deletes an entry after explicit confirmation", async () => {
  withSession();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const state = stubFetch([entry()]);
  renderWithOwner(<AuthProvider><EmergencyInfoManager /></AuthProvider>);
  await screen.findByText("Mom");

  screen.getByRole("button", { name: "Verwijderen" }).click();

  await screen.findByText("Nog geen noodinformatie. Voeg een contact, nummer of medische notitie toe.");
  expect(state.calls.some((call) => call.method === "DELETE" && call.url === "/api/library/emergency-info/entry-1")).toBe(true);
});

it("lets the owner pin an emergency-info entry for offline access and unpin it again", async () => {
  withSession();
  stubFetch([entry()]);
  renderWithOwner(<AuthProvider><EmergencyInfoManager /></AuthProvider>);
  await screen.findByText("Mom");

  screen.getByRole("button", { name: "Offline bewaren" }).click();
  await screen.findByText("“Mom” is offline bewaard op dit toestel.");
  await screen.findByRole("button", { name: "Offline verwijderen" });

  screen.getByRole("button", { name: "Offline verwijderen" }).click();
  await screen.findByText("“Mom” is niet langer offline beschikbaar.");
  await screen.findByRole("button", { name: "Offline bewaren" });
});

it("opens the editor with the saved entry and shows the edited one at once", async () => {
  withSession();
  stubFetch([entry(), entry({ id: "entry-2", label: "Ambassade", value: "+886 2 0000 0000", notes: "Kantooruren" })]);
  renderWithOwner(<AuthProvider><EmergencyInfoManager /></AuthProvider>);
  await screen.findByText("Ambassade");
  fireEvent.click(screen.getAllByRole("button", { name: "Bewerken" })[1]);
  expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("Ambassade");
  expect((screen.getByLabelText("Waarde") as HTMLInputElement).value).toBe("+886 2 0000 0000");
  expect((screen.getByLabelText("Notities (optioneel)") as HTMLTextAreaElement).value).toBe("Kantooruren");
  fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Ambassade Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
  await screen.findByText("Ambassade Taipei");
  expect(screen.queryByText("Ambassade")).toBeNull();
  expect(screen.getByText("Noodinformatie opgeslagen.")).toBeTruthy();
  // The form is back to adding a new entry.
  expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("button", { name: "Toevoegen" })).toBeTruthy();
});

it("adds an entry after validating the required fields, and keeps the input when the server refuses", async () => {
  withSession();
  const state = stubFetch([]);
  renderWithOwner(<AuthProvider><EmergencyInfoManager /></AuthProvider>);
  await screen.findByText("Nog geen noodinformatie. Voeg een contact, nummer of medische notitie toe.");
  fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
  await screen.findByText("Geef de invoer een label.");
  await screen.findByText("Vul een waarde in.");
  expect(state.calls.some((call) => call.method === "POST")).toBe(false);

  fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Huisarts" } });
  fireEvent.change(screen.getByLabelText("Waarde"), { target: { value: "+32 3 000 00 00" } });
  state.failNext = { status: 422, body: { detail: [{ loc: ["body", "value"], msg: "Ongeldig nummer." }] } };
  fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
  await screen.findByText("Ongeldig nummer.", { selector: ".field-error" });
  expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("Huisarts");

  fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
  await screen.findByText("Huisarts", { selector: "strong" });
  await waitFor(() => expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe(""));
});
