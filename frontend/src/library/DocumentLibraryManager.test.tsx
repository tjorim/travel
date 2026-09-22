// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AuthProvider } from "../auth-context";
import type { OwnerDocument, Trip } from "../tracker-model";
import { DocumentLibraryManager } from "./DocumentLibraryManager";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function withSession(): void {
  sessionStorage.setItem("travel-tracker-session", JSON.stringify({ accessToken: "test-token", expiresAt: Date.now() + 60_000 }));
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
