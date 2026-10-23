// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AuthProvider } from "../auth-context";
import { answerConfirmation } from "../test-confirm";
import { OfflineManager } from "./OfflineManager";
import { __resetOfflineStoreForTests, pinOfflineCopy } from "./offline-store";

function fakeAccessToken(subject: string): string {
  const payload = btoa(JSON.stringify({ sub: subject }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `header.${payload}.signature`;
}

const SUBJECT = "owner-1";

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  await __resetOfflineStoreForTests();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("travel-offline-v1");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

function withSession(): void {
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ accessToken: fakeAccessToken(SUBJECT), expiresAt: Date.now() + 60_000 }),
  );
}

function stubMetadataFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id: "doc-1" }), { status: 200 }))),
  );
}

it("shows an empty state without any pinned copies", async () => {
  withSession();
  stubMetadataFetch();
  render(
    <AuthProvider>
      <OfflineManager />
    </AuthProvider>,
  );
  await screen.findByText("Nog geen offline kopieën.");
});

it("lists a pinned document, opens it, and removes it individually", async () => {
  withSession();
  stubMetadataFetch();
  await pinOfflineCopy({
    subject: SUBJECT,
    resourceKind: "library_document",
    resourceId: "doc-1",
    metadataUrl: "/api/library/documents/doc-1",
    title: "Insurance policy",
    contentType: "application/pdf",
    bytes: new TextEncoder().encode("private pdf bytes").buffer as ArrayBuffer,
  });

  const openSpy = vi.fn();
  vi.stubGlobal("open", openSpy);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  render(
    <AuthProvider>
      <OfflineManager />
    </AuthProvider>,
  );
  await screen.findByText("Insurance policy");

  screen.getByRole("button", { name: "Bekijken" }).click();
  await vi.waitFor(() => expect(openSpy).toHaveBeenCalled());

  screen.getByRole("button", { name: "Verwijderen" }).click();
  await answerConfirmation("Niet meer bewaren");
  await screen.findByText("“Insurance policy” is niet langer offline beschikbaar.");
  expect(screen.queryByText("Insurance policy")).toBeNull();
});

it("shows an emergency-info snapshot inline instead of opening a new tab", async () => {
  withSession();
  stubMetadataFetch();
  await pinOfflineCopy({
    subject: SUBJECT,
    resourceKind: "emergency_info",
    resourceId: "entry-1",
    metadataUrl: "/api/library/emergency-info/entry-1",
    title: "Mom",
    contentType: "application/json",
    bytes: new TextEncoder().encode(
      JSON.stringify({ label: "Mom", value: "+32 470 00 00 00" }, null, 2),
    ).buffer as ArrayBuffer,
  });

  const openSpy = vi.fn();
  vi.stubGlobal("open", openSpy);
  render(
    <AuthProvider>
      <OfflineManager />
    </AuthProvider>,
  );
  await screen.findByText("Mom");

  screen.getByRole("button", { name: "Bekijken" }).click();
  await screen.findByText((content) => content.includes("+32 470 00 00 00"));
  expect(openSpy).not.toHaveBeenCalled();
});

it("opens a packing copy as a read-only list", async () => {
  withSession();
  stubMetadataFetch();
  await pinOfflineCopy({
    subject: SUBJECT,
    resourceKind: "packing_list",
    resourceId: "list-1",
    metadataUrl: "/api/trips/trip-1/packing-lists/list-1",
    title: "Exampleland · Paklijst",
    contentType: "application/json",
    bytes: new TextEncoder().encode(
      JSON.stringify({
        list: { id: "list-1", name: "Paklijst" },
        bags: [{ id: "bag-1", name: "Handbagage", position: 0 }],
        items: [
          {
            id: "item-1",
            label: "Paspoort",
            quantity: 1,
            category: "Documenten",
            bag_id: "bag-1",
            position: 0,
            packed: true,
            notes: null,
            last_minute: false,
          },
        ],
        savedAt: Date.now(),
      }),
    ).buffer as ArrayBuffer,
  });
  render(
    <AuthProvider>
      <OfflineManager />
    </AuthProvider>,
  );
  await screen.findByText("Exampleland · Paklijst");
  screen.getByRole("button", { name: "Bekijken" }).click();
  const checkbox = await screen.findByRole("checkbox", { name: "Paspoort ingepakt" });
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  expect(checkbox.getAttribute("aria-disabled")).toBe("true");
  expect(
    screen.getByText(/Voor afvinken, verplaatsen en bewerken is een verbinding nodig/),
  ).toBeTruthy();
});

it("clears every pinned copy on this device after confirmation", async () => {
  withSession();
  stubMetadataFetch();
  await pinOfflineCopy({
    subject: SUBJECT,
    resourceKind: "library_document",
    resourceId: "doc-1",
    metadataUrl: "/api/library/documents/doc-1",
    title: "Insurance policy",
    contentType: "application/pdf",
    bytes: new TextEncoder().encode("bytes").buffer as ArrayBuffer,
  });
  await pinOfflineCopy({
    subject: SUBJECT,
    resourceKind: "emergency_info",
    resourceId: "entry-1",
    metadataUrl: "/api/library/emergency-info/entry-1",
    title: "Mom",
    contentType: "application/json",
    bytes: new TextEncoder().encode("{}").buffer as ArrayBuffer,
  });

  render(
    <AuthProvider>
      <OfflineManager />
    </AuthProvider>,
  );
  await screen.findByText("Insurance policy");

  screen.getByRole("button", { name: "Alles wissen" }).click();
  await answerConfirmation("Alles wissen");
  await screen.findByText("Alle offline kopieën op dit toestel zijn verwijderd.");
  await screen.findByText(
    "Zet “Offline bewaren” aan bij een document, noodinformatie, medium, kaart, bezoek of paklijst om het hier te laten verschijnen.",
  );
  expect(screen.queryByText("Insurance policy")).toBeNull();
  expect(screen.queryByText("Mom")).toBeNull();
});

it("shows a disclosure when the browser declines persistent storage", async () => {
  withSession();
  stubMetadataFetch();
  vi.stubGlobal("navigator", {
    ...navigator,
    onLine: true,
    storage: {
      persist: vi.fn().mockResolvedValue(false),
      persisted: vi.fn().mockResolvedValue(false),
    },
  });
  await pinOfflineCopy({
    subject: SUBJECT,
    resourceKind: "library_document",
    resourceId: "doc-1",
    metadataUrl: "/api/library/documents/doc-1",
    title: "Insurance policy",
    contentType: "application/pdf",
    bytes: new TextEncoder().encode("bytes").buffer as ArrayBuffer,
  });

  render(
    <AuthProvider>
      <OfflineManager />
    </AuthProvider>,
  );

  await screen.findByText(
    "Je browser heeft geen persistente opslag toegekend voor deze offline kopieën; ze kunnen automatisch worden opgeruimd bij weinig opslagruimte op dit toestel.",
  );
});

it("tells the owner their copies are pending revalidation while offline", async () => {
  withSession();
  Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
  render(
    <AuthProvider>
      <OfflineManager />
    </AuthProvider>,
  );
  await screen.findByText(
    "Je bent offline. Kopieën worden opnieuw gecontroleerd zodra je weer verbinding hebt.",
  );
});
