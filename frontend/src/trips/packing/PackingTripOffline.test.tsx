// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "../../auth-context";
import { server } from "../../mocks/server";
import { testToken } from "../../query/test-utils";
import { __resetOfflineStoreForTests, pinOfflineCopy } from "../../offline/offline-store";
import { PackingTripOffline } from "./PackingTripOffline";

afterEach(async () => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  await __resetOfflineStoreForTests();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("travel-offline-v1");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
});

async function save(subject: string, trip: string, label: string, bytes?: string) {
  await pinOfflineCopy({
    subject,
    resourceKind: "packing_list",
    resourceId: label,
    metadataUrl: `/api/trips/${trip}/packing-lists/${label}`,
    title: label,
    contentType: "application/json",
    bytes: new TextEncoder().encode(
      bytes ??
        JSON.stringify({
          list: { id: label, name: label },
          bags: [],
          items: [{ id: label, label, quantity: 1, packed: false, position: 0 }],
          savedAt: Date.now(),
        }),
    ).buffer,
  });
}

function show() {
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ accessToken: testToken("owner-1"), expiresAt: Date.now() + 3_600_000 }),
  );
  server.use(http.get("/api/*", () => HttpResponse.error()));
  return render(
    <AuthProvider>
      <PackingTripOffline tripId="trip-1" onRetry={() => undefined} />
    </AuthProvider>,
  );
}

it("opens only the current owner's trip snapshot without any live metadata", async () => {
  await save("owner-1", "trip-1", "Synthetic raincoat");
  await save("owner-2", "trip-1", "Other owner item");
  await save("owner-1", "trip-10", "Other trip item");
  show();
  await screen.findByRole("checkbox");
  expect(screen.getByRole("checkbox")).toHaveAttribute("aria-disabled", "true");
  expect(screen.queryByText("Other owner item")).toBeNull();
  expect(screen.queryByText("Other trip item")).toBeNull();
  expect(screen.queryByRole("button", { name: "Offline bewaren" })).toBeNull();
});

it("explains when no valid copy remains", async () => {
  show();
  await screen.findByText(/Er is geen geldige opgeslagen paklijst/);
});

it("reports unreadable saved data without mounting an editor", async () => {
  await save("owner-1", "trip-1", "Broken copy", "invalid json");
  show();
  await screen.findByRole("alert");
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("does not reopen an expired snapshot", async () => {
  await save("owner-1", "trip-1", "Expired item");
  const later = Date.now() + 8 * 24 * 60 * 60 * 1000;
  vi.spyOn(Date, "now").mockReturnValue(later);
  show();
  await screen.findByText(/Er is geen geldige opgeslagen paklijst/);
  expect(screen.queryByText("Expired item")).toBeNull();
});
