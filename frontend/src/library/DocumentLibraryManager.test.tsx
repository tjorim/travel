// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AuthProvider } from "../auth-context";
import { __resetOfflineStoreForTests } from "../offline/offline-store";
import type { OwnerDocument, Trip } from "../tracker-model";
import { DocumentLibraryManager } from "./DocumentLibraryManager";

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

function stubFetch(documents: OwnerDocument[], trips: Partial<Trip>[] = []): { calls: { url: string; method: string }[] } {
  const state = { documents: documents.slice(), calls: [] as { url: string; method: string }[] };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    state.calls.push({ url, method });
    if (method === "DELETE") {
      state.documents = state.documents.filter((document) => !url.endsWith(document.id));
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url === "/api/library/documents") return Promise.resolve(new Response(JSON.stringify(state.documents), { status: 200 }));
    if (url === "/api/trips") return Promise.resolve(new Response(JSON.stringify(trips), { status: 200 }));
    const original = state.documents.find((document) => url === document.file_url);
    if (original) return Promise.resolve(new Response("private pdf bytes", { status: 200, headers: { "Content-Type": original.content_type } }));
    if (url.startsWith("/api/library/documents/")) return Promise.resolve(new Response(JSON.stringify(state.documents.find((document) => url.endsWith(document.id)) ?? null), { status: state.documents.some((document) => url.endsWith(document.id)) ? 200 : 404 }));
    return Promise.resolve(new Response(null, { status: 404 }));
  }));
  return state;
}

function document(overrides: Partial<OwnerDocument> = {}): OwnerDocument {
  return {
    id: "doc-1",
    document_kind: "other",
    title: "Insurance policy",
    byte_size: 512,
    content_type: "application/pdf",
    original_filename: "policy.pdf",
    linked_trip_id: null,
    created_at: "2054-01-01T00:00:00Z",
    file_url: "/api/library/documents/doc-1/original",
    ...overrides,
  };
}

it("lists owner-wide documents without needing a trip", async () => {
  withSession();
  stubFetch([document()]);
  render(<AuthProvider><DocumentLibraryManager /></AuthProvider>);
  await screen.findByText("Insurance policy");
  expect(screen.getByText((content) => content.includes("policy.pdf"))).toBeTruthy();
});

it("shows the linked trip's title when a document is linked", async () => {
  withSession();
  stubFetch(
    [document({ linked_trip_id: "trip-1" })],
    [{ id: "trip-1", title: "Exampleland 2054" } as unknown as Trip],
  );
  render(<AuthProvider><DocumentLibraryManager /></AuthProvider>);
  const summaries = await screen.findAllByText((content) => content.includes("Exampleland 2054"));
  expect(summaries.some((element) => element.tagName === "SPAN")).toBe(true);
});

it("shows an empty state when the library has no documents", async () => {
  withSession();
  stubFetch([]);
  render(<AuthProvider><DocumentLibraryManager /></AuthProvider>);
  await screen.findByText("Nog geen documenten. Upload een privébestand wanneer je het wilt bewaren.");
});

it("deletes a document after explicit confirmation", async () => {
  withSession();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const state = stubFetch([document()]);
  render(<AuthProvider><DocumentLibraryManager /></AuthProvider>);
  await screen.findByText("Insurance policy");

  screen.getByRole("button", { name: "Verwijderen" }).click();

  await screen.findByText("Nog geen documenten. Upload een privébestand wanneer je het wilt bewaren.");
  expect(state.calls.some((call) => call.method === "DELETE" && call.url === "/api/library/documents/doc-1")).toBe(true);
});

it("lets the owner pin a document for offline access and unpin it again", async () => {
  withSession();
  stubFetch([document()]);
  render(<AuthProvider><DocumentLibraryManager /></AuthProvider>);
  await screen.findByText("Insurance policy");

  screen.getByRole("button", { name: "Offline bewaren" }).click();
  await screen.findByText("“Insurance policy” is offline bewaard op dit toestel.");
  await screen.findByRole("button", { name: "Offline verwijderen" });

  screen.getByRole("button", { name: "Offline verwijderen" }).click();
  await screen.findByText("“Insurance policy” is niet langer offline beschikbaar.");
  await screen.findByRole("button", { name: "Offline bewaren" });
});
