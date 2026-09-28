// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

import { AuthProvider } from "../auth-context";
import { chooseOption, renderWithOwner, resetOfflineDb } from "../query/test-utils";
import type { OwnerDocument, Trip } from "../tracker-model";
import { DocumentLibraryManager } from "./DocumentLibraryManager";

function fakeAccessToken(subject: string): string {
  const payload = btoa(JSON.stringify({ sub: subject }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
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
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ accessToken: fakeAccessToken("owner-1"), expiresAt: Date.now() + 60_000 }),
  );
}

function stubFetch(
  documents: OwnerDocument[],
  trips: Partial<Trip>[] = [],
): { calls: { url: string; method: string }[] } {
  const state = { documents: documents.slice(), calls: [] as { url: string; method: string }[] };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      state.calls.push({ url, method });
      if (method === "DELETE") {
        state.documents = state.documents.filter((document) => !url.endsWith(document.id));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url === "/api/library/documents")
        return Promise.resolve(new Response(JSON.stringify(state.documents), { status: 200 }));
      if (url === "/api/library/documents/uploads" && method === "POST") {
        const data = init?.body as FormData;
        const created = libraryDocument({
          id: "doc-new",
          title: String(data.get("title")),
          linked_trip_id: (data.get("linked_trip_id") as string | null) ?? null,
          file_url: "/api/library/documents/doc-new/original",
        });
        state.documents = [...state.documents, created];
        return Promise.resolve(new Response(JSON.stringify(created), { status: 201 }));
      }
      if (url === "/api/trips") return Promise.resolve(new Response(JSON.stringify(trips), { status: 200 }));
      const original = state.documents.find((document) => url === document.file_url);
      if (original)
        return Promise.resolve(
          new Response("private pdf bytes", { status: 200, headers: { "Content-Type": original.content_type } }),
        );
      if (url.startsWith("/api/library/documents/"))
        return Promise.resolve(
          new Response(JSON.stringify(state.documents.find((document) => url.endsWith(document.id)) ?? null), {
            status: state.documents.some((document) => url.endsWith(document.id)) ? 200 : 404,
          }),
        );
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  );
  return state;
}

function libraryDocument(overrides: Partial<OwnerDocument> = {}): OwnerDocument {
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
  stubFetch([libraryDocument()]);
  renderWithOwner(
    <AuthProvider>
      <DocumentLibraryManager />
    </AuthProvider>,
  );
  await screen.findByText("Insurance policy");
  expect(screen.getByText((content) => content.includes("policy.pdf"))).toBeTruthy();
});

it("shows the linked trip's title when a document is linked", async () => {
  withSession();
  stubFetch(
    [libraryDocument({ linked_trip_id: "trip-1" })],
    [{ id: "trip-1", title: "Exampleland 2054" } as unknown as Trip],
  );
  renderWithOwner(
    <AuthProvider>
      <DocumentLibraryManager />
    </AuthProvider>,
  );
  const summaries = await screen.findAllByText((content) => content.includes("Exampleland 2054"));
  expect(summaries.some((element) => element.tagName === "SPAN")).toBe(true);
});

it("shows an empty state when the library has no documents", async () => {
  withSession();
  stubFetch([]);
  renderWithOwner(
    <AuthProvider>
      <DocumentLibraryManager />
    </AuthProvider>,
  );
  await screen.findByText("Nog geen documenten. Upload een privébestand wanneer je het wilt bewaren.");
});

it("deletes a document after explicit confirmation", async () => {
  withSession();
  const state = stubFetch([libraryDocument()]);
  renderWithOwner(
    <AuthProvider>
      <DocumentLibraryManager />
    </AuthProvider>,
  );
  await screen.findByText("Insurance policy");

  fireEvent.click(screen.getByRole("button", { name: "Document Insurance policy bekijken" }));
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }));

  await screen.findByText("Nog geen documenten. Upload een privébestand wanneer je het wilt bewaren.");
  expect(state.calls.some((call) => call.method === "DELETE" && call.url === "/api/library/documents/doc-1")).toBe(
    true,
  );
});

it("lets the owner pin a document for offline access and unpin it again", async () => {
  withSession();
  stubFetch([libraryDocument()]);
  renderWithOwner(
    <AuthProvider>
      <DocumentLibraryManager />
    </AuthProvider>,
  );
  await screen.findByText("Insurance policy");

  screen.getByRole("button", { name: "Offline bewaren" }).click();
  await screen.findByText("“Insurance policy” is offline bewaard op dit toestel.");
  await screen.findByRole("button", { name: "Offline verwijderen" });

  screen.getByRole("button", { name: "Offline verwijderen" }).click();
  await screen.findByText("“Insurance policy” is niet langer offline beschikbaar.");
  await screen.findByRole("button", { name: "Offline bewaren" });
});

it("lists an uploaded document at once, linked to its trip, and closes the dialog", async () => {
  withSession();
  const state = stubFetch([], [{ id: "trip-1", title: "Exampleland 2054" } as unknown as Trip]);
  renderWithOwner(
    <AuthProvider>
      <DocumentLibraryManager />
    </AuthProvider>,
  );
  await screen.findByText("Nog geen documenten. Upload een privébestand wanneer je het wilt bewaren.");

  expect(screen.queryByLabelText("Titel")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Nieuw document" }));
  fireEvent.click(screen.getByRole("button", { name: "Document uploaden" }));
  await screen.findByText("Geef het document een titel.");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Reisverzekering" } });
  fireEvent.keyDown(await screen.findByLabelText("Gekoppelde reis (optioneel)"), { key: "ArrowDown" });
  await screen.findByRole("option", { name: "Exampleland 2054" });
  chooseOption("Gekoppelde reis (optioneel)", "Exampleland 2054");
  fireEvent.click(screen.getByRole("button", { name: "Document uploaden" }));
  await screen.findByText("Kies een bestand om te uploaden.");
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File(["x"], "polis.pdf", { type: "application/pdf" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Document uploaden" }));

  await screen.findByText("Reisverzekering");
  expect(screen.getByText((content) => content.includes("Exampleland 2054"), { selector: "span" })).toBeTruthy();
  expect(screen.getByText("Document toegevoegd aan je bibliotheek.")).toBeTruthy();
  expect(screen.queryByLabelText("Titel")).toBeNull();
  expect(state.calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

it("opens a document with the bearer token in the request", async () => {
  withSession();
  const state = stubFetch([libraryDocument()]);
  const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: () => "blob:doc" });
  renderWithOwner(
    <AuthProvider>
      <DocumentLibraryManager />
    </AuthProvider>,
  );
  await screen.findByText("Insurance policy");
  screen.getByRole("button", { name: "Bekijken" }).click();
  await vi.waitFor(() => expect(open).toHaveBeenCalledWith("blob:doc", "_blank", "noopener"));
  expect(state.calls.some((call) => call.url === "/api/library/documents/doc-1/original")).toBe(true);
  Reflect.deleteProperty(URL, "createObjectURL");
});
