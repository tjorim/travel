import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { AuthProvider } from "@/app/providers/auth-context";
import { changeLocale } from "@/i18n/locale";
import { DocumentManager } from "@/features/documents/DocumentManager";
import { EmergencyInfoManager } from "@/features/library/EmergencyInfoManager";
import { server } from "@/mocks/server";
import { renderWithOwner, resetOfflineDb } from "../../utils/query-test-utils";
import { answerConfirmation } from "../../utils/test-confirm";
import { OfflineManager } from "@/features/library/OfflineManager";
import { listOfflineCopies } from "@/lib/offline-store";

const SUBJECT = "owner-1";

function fakeAccessToken(subject: string): string {
  const payload = btoa(JSON.stringify({ sub: subject }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `header.${payload}.signature`;
}

function withSession(): void {
  sessionStorage.setItem(
    "travel-session",
    JSON.stringify({ accessToken: fakeAccessToken(SUBJECT), expiresAt: Date.now() + 60_000 }),
  );
}

const document: Api.DocumentResponse = {
  id: "doc-1",
  document_kind: "other",
  title: "Insurance policy",
  byte_size: 512,
  content_type: "application/pdf",
  original_filename: "policy.pdf",
  trip_id: null,
  created_at: "2054-01-01T00:00:00Z",
  file_url: "/api/documents/doc-1/original",
};
const contact: Api.EmergencyInfoEntryResponse = {
  updated_at: "2054-01-01T00:00:00Z",
  notes_html: null,
  notes_text: null,
  id: "entry-1",
  kind: "contact",
  label: "Mom",
  value: "+32 470 00 00 00",
  notes: null,
  created_at: "2054-01-01T00:00:00Z",
};

function serveLibrary(): void {
  server.use(
    http.get("/api/documents", () => HttpResponse.json<Api.DocumentResponse[]>([document])),
    http.get("/api/documents/doc-1", () => HttpResponse.json<Api.DocumentResponse>(document)),
    http.get("/api/documents/doc-1/original", () =>
      HttpResponse.arrayBuffer(new TextEncoder().encode("private pdf bytes").buffer, {
        headers: { "Content-Type": "application/pdf" },
      }),
    ),
    http.get("/api/library/emergency-info", () =>
      HttpResponse.json<Api.EmergencyInfoEntryResponse[]>([contact]),
    ),
    http.get("/api/library/emergency-info/entry-1", () =>
      HttpResponse.json<Api.EmergencyInfoEntryResponse>(contact),
    ),
    http.get("/api/trips", () => HttpResponse.json<Api.TripSummaryResponse[]>([])),
  );
}

function renderLibrary() {
  return renderWithOwner(
    <AuthProvider>
      <DocumentManager />
      <EmergencyInfoManager />
      <OfflineManager />
    </AuthProvider>,
  );
}

function sections() {
  return {
    documents: within(screen.getByRole("region", { name: /documenten/i })),
    emergency: within(document_section("emergency-info-title")),
    offline: within(document_section("offline-title")),
  };
}
function document_section(titleId: string): HTMLElement {
  const heading = globalThis.document.getElementById(titleId);
  if (!heading) throw new Error(`missing ${titleId}`);
  return heading.closest("section") as HTMLElement;
}

beforeEach(() => {
  withSession();
  serveLibrary();
  act(() => changeLocale("nl"));
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  act(() => changeLocale("nl"));
  await resetOfflineDb();
});

it("keeps every mounted consumer in step as copies are saved, removed and cleared", async () => {
  vi.stubGlobal("navigator", {
    ...navigator,
    onLine: true,
    storage: {
      persist: vi.fn().mockResolvedValue(false),
      persisted: vi.fn().mockResolvedValue(false),
    },
  });
  renderLibrary();
  const { emergency, offline } = sections();
  await emergency.findByText("Mom");
  await offline.findByText("Nog geen offline kopieën.");

  // Pin from Emergency information: the Offline section follows without a reload.
  fireEvent.click(emergency.getByRole("button", { name: "Offline bewaren" }));
  await emergency.findByRole("button", { name: "Offline verwijderen" });
  await offline.findByText("Mom");
  expect(offline.queryByText("Nog geen offline kopieën.")).toBeNull();
  await offline.findByText(/Je browser heeft geen persistente opslag/);

  // Pin from Documents.
  const documents = within(screen.getByText("Insurance policy").closest("section") as HTMLElement);
  fireEvent.click(documents.getByRole("button", { name: "Offline bewaren" }));
  await documents.findByRole("button", { name: "Offline verwijderen" });
  await offline.findByText("Insurance policy");
  expect(await listOfflineCopies(SUBJECT)).toHaveLength(2);

  // Remove from Emergency information, then from the Offline section: siblings follow both ways.
  fireEvent.click(emergency.getByRole("button", { name: "Offline verwijderen" }));
  await emergency.findByRole("button", { name: "Offline bewaren" });
  await waitFor(() => expect(offline.queryByText("Mom")).toBeNull());
  expect(documents.getByRole("button", { name: "Offline verwijderen" })).toBeTruthy();

  const row = offline.getByText("Insurance policy").closest("article") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "Verwijderen" }));
  await answerConfirmation("Niet meer bewaren");
  await documents.findByRole("button", { name: "Offline bewaren" });
  await waitFor(() => expect(offline.queryByText("Insurance policy")).toBeNull());
  expect(offline.queryByRole("button", { name: "Alles wissen" })).toBeNull();

  // Repeat, then Clear all empties every consumer, including the storage warning.
  fireEvent.click(emergency.getByRole("button", { name: "Offline bewaren" }));
  await emergency.findByRole("button", { name: "Offline verwijderen" });
  fireEvent.click(documents.getByRole("button", { name: "Offline bewaren" }));
  await documents.findByRole("button", { name: "Offline verwijderen" });
  await offline.findByText("Insurance policy");

  fireEvent.click(offline.getByRole("button", { name: "Alles wissen" }));
  await answerConfirmation("Alles wissen");
  await offline.findByText("Alle offline kopieën op dit toestel zijn verwijderd.");
  await emergency.findByRole("button", { name: "Offline bewaren" });
  await documents.findByRole("button", { name: "Offline bewaren" });
  expect(offline.queryByText(/Je browser heeft geen persistente opslag/)).toBeNull();
  expect(offline.queryByRole("button", { name: "Alles wissen" })).toBeNull();
});

it("leaves every consumer on the previous state when a save fails", async () => {
  server.use(http.get("/api/documents/doc-1/original", () => HttpResponse.error()));
  renderLibrary();
  const documents = within(
    (await screen.findByText("Insurance policy")).closest("section") as HTMLElement,
  );
  const { offline } = sections();
  fireEvent.click(documents.getByRole("button", { name: "Offline bewaren" }));
  await documents.findByRole("status");
  expect(documents.getByRole("button", { name: "Offline bewaren" })).toBeTruthy();
  await offline.findByText("Nog geen offline kopieën.");
});

it("updates mounted consumers when revalidation deletes a copy", async () => {
  const { pinOfflineCopy } = await import("@/lib/offline-store");
  await pinOfflineCopy({
    subject: SUBJECT,
    resourceKind: "library_document",
    resourceId: "doc-1",
    metadataUrl: "/api/documents/doc-1",
    title: "Insurance policy",
    contentType: "application/pdf",
    bytes: new TextEncoder().encode("x").buffer as ArrayBuffer,
  });
  renderLibrary();
  const { offline } = sections();
  await offline.findByRole("button", { name: "Alles wissen" });
  const documents = within(
    (await screen.findAllByText("Insurance policy"))[0].closest("section") as HTMLElement,
  );
  await documents.findByRole("button", { name: "Offline verwijderen" });

  const { revalidateOfflineCopies } = await import("@/lib/offline-store");
  await revalidateOfflineCopies(SUBJECT, () =>
    Promise.resolve(new Response(null, { status: 404 })),
  );

  await documents.findByRole("button", { name: "Offline bewaren" });
  await waitFor(() => expect(offline.queryByRole("button", { name: "Alles wissen" })).toBeNull());
});
