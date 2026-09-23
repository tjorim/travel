// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  __resetOfflineStoreForTests,
  clearOfflineCopies,
  findPinnedCopy,
  getKeyDisclosure,
  isStoragePersisted,
  listOfflineCopies,
  openOfflineCopy,
  pinOfflineCopy,
  removeOfflineCopy,
  requestPersistentStorage,
  revalidateOfflineCopies,
  wipeOfflineData,
  OFFLINE_LEASE_MS,
  type PinInput,
} from "./offline-store";

const OWNER = "owner-sub-1";
const OTHER_OWNER = "owner-sub-2";

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function pinInput(overrides: Partial<PinInput> = {}): PinInput {
  return {
    subject: OWNER,
    resourceKind: "library_document",
    resourceId: "doc-1",
    metadataUrl: "/api/library/documents/doc-1",
    title: "Insurance policy",
    contentType: "application/pdf",
    bytes: bytesOf("private pdf bytes"),
    ...overrides,
  };
}

beforeEach(async () => {
  await __resetOfflineStoreForTests();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await __resetOfflineStoreForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("travel-offline-v1");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});

it("pins a copy and lists it for the owning subject", async () => {
  await pinOfflineCopy(pinInput());
  const copies = await listOfflineCopies(OWNER);
  expect(copies).toHaveLength(1);
  expect(copies[0]).toMatchObject({ title: "Insurance policy", resourceKind: "library_document", resourceId: "doc-1", byteSize: bytesOf("private pdf bytes").byteLength });
});

it("opens a pinned copy and decrypts its original bytes after a simulated reload", async () => {
  await pinOfflineCopy(pinInput({ bytes: bytesOf("hello offline world") }));
  const [summary] = await listOfflineCopies(OWNER);

  // Simulate a page reload: drop the cached IndexedDB connection so the next
  // call reopens the database from scratch, the same as a fresh page load would.
  await __resetOfflineStoreForTests();

  const blob = await openOfflineCopy(OWNER, summary.id);
  expect(await blob.text()).toBe("hello offline world");
  expect(blob.type).toBe("application/pdf");
});

it("keeps explicitly pinned media, map data and itinerary entries private across a simulated reload", async () => {
  await pinOfflineCopy(pinInput({ resourceKind: "media_asset", resourceId: "media-1", title: "Arrival.jpg", contentType: "image/jpeg", bytes: bytesOf("media bytes") }));
  await pinOfflineCopy(pinInput({ resourceKind: "map_route_data", resourceId: "trip-1", title: "Exampleland · map", metadataUrl: "/api/trips/trip-1/offline-map", contentType: "application/json", bytes: bytesOf('{"lines":[]}') }));
  await pinOfflineCopy(pinInput({ resourceKind: "itinerary_entry", resourceId: "entry-1", title: "Arrival", metadataUrl: "/api/trips/trip-1/itinerary-entries/entry-1", contentType: "application/json", bytes: bytesOf('{"title":"Arrival"}') }));

  await __resetOfflineStoreForTests();

  const copies = await listOfflineCopies(OWNER);
  expect(copies.map((copy) => copy.resourceKind).sort()).toEqual(["itinerary_entry", "map_route_data", "media_asset"]);
  await expect((await openOfflineCopy(OWNER, copies.find((copy) => copy.resourceKind === "media_asset")!.id)).text()).resolves.toBe("media bytes");
  await removeOfflineCopy(copies.find((copy) => copy.resourceKind === "map_route_data")!.id);
  expect(await listOfflineCopies(OTHER_OWNER)).toHaveLength(0);
  expect((await listOfflineCopies(OWNER)).map((copy) => copy.resourceKind)).not.toContain("map_route_data");
});

it("removes an individual copy", async () => {
  const pinned = await pinOfflineCopy(pinInput());
  await removeOfflineCopy(pinned.id);
  expect(await listOfflineCopies(OWNER)).toHaveLength(0);
});

it("clears all copies for the current subject without touching another subject's copies", async () => {
  await pinOfflineCopy(pinInput({ subject: OWNER, resourceId: "doc-1" }));
  await pinOfflineCopy(pinInput({ subject: OWNER, resourceId: "doc-2", title: "Second doc" }));
  await pinOfflineCopy(pinInput({ subject: OTHER_OWNER, resourceId: "doc-3", title: "Other owner doc" }));

  await clearOfflineCopies(OWNER);

  expect(await listOfflineCopies(OWNER)).toHaveLength(0);
  expect(await listOfflineCopies(OTHER_OWNER)).toHaveLength(1);
});

it("re-pinning the same resource replaces its content instead of duplicating it", async () => {
  await pinOfflineCopy(pinInput({ bytes: bytesOf("first version") }));
  await pinOfflineCopy(pinInput({ bytes: bytesOf("second version") }));

  const copies = await listOfflineCopies(OWNER);
  expect(copies).toHaveLength(1);
  const blob = await openOfflineCopy(OWNER, copies[0].id);
  expect(await blob.text()).toBe("second version");
});

it("does not let a different subject open or list another owner's pinned copy", async () => {
  const pinned = await pinOfflineCopy(pinInput({ subject: OWNER }));
  expect(await listOfflineCopies(OTHER_OWNER)).toHaveLength(0);
  await expect(openOfflineCopy(OTHER_OWNER, pinned.id)).rejects.toThrow();
});

it("revalidateOfflineCopies removes a copy once the source resource 404s", async () => {
  await pinOfflineCopy(pinInput());
  const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));

  const result = await revalidateOfflineCopies(OWNER, fetchImpl);

  expect(result).toEqual({ checked: 1, removed: 1 });
  expect(await listOfflineCopies(OWNER)).toHaveLength(0);
});

it("revalidateOfflineCopies extends the lease and keeps the copy on a 200", async () => {
  await pinOfflineCopy(pinInput());
  const before = (await listOfflineCopies(OWNER))[0];
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

  await revalidateOfflineCopies(OWNER, fetchImpl);

  const after = (await listOfflineCopies(OWNER))[0];
  expect(after.leaseExpiresAt).toBeGreaterThanOrEqual(before.leaseExpiresAt);
});

it("revalidateOfflineCopies leaves the copy untouched when the fetch fails (offline)", async () => {
  await pinOfflineCopy(pinInput());
  const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

  const result = await revalidateOfflineCopies(OWNER, fetchImpl);

  expect(result).toEqual({ checked: 1, removed: 0 });
  expect(await listOfflineCopies(OWNER)).toHaveLength(1);
});

it("blocks opening and purges a copy once its lease has expired", async () => {
  // Mock only Date.now (not fake timers): IndexedDB's own async scheduling
  // must keep running normally for pin/open to resolve.
  const dateSpy = vi.spyOn(Date, "now").mockReturnValue(0);
  const pinned = await pinOfflineCopy(pinInput());
  dateSpy.mockReturnValue(OFFLINE_LEASE_MS + 1);

  await expect(openOfflineCopy(OWNER, pinned.id)).rejects.toThrow(/verlopen/);
  dateSpy.mockRestore();

  expect(await listOfflineCopies(OWNER)).toHaveLength(0);
});

it("wipeOfflineData removes both the copies and the device key for that subject", async () => {
  await pinOfflineCopy(pinInput());
  expect(await getKeyDisclosure(OWNER)).not.toBeNull();

  await wipeOfflineData(OWNER);

  expect(await listOfflineCopies(OWNER)).toHaveLength(0);
  expect(await getKeyDisclosure(OWNER)).toBeNull();
});

it("findPinnedCopy locates a copy by resource kind and id", async () => {
  await pinOfflineCopy(pinInput({ resourceKind: "emergency_info", resourceId: "entry-1", title: "Mama" }));
  expect(await findPinnedCopy(OWNER, "emergency_info", "entry-1")).toMatchObject({ title: "Mama" });
  expect(await findPinnedCopy(OWNER, "emergency_info", "entry-missing")).toBeNull();
});

it("stores a non-extractable device key by default", async () => {
  await pinOfflineCopy(pinInput());
  const disclosure = await getKeyDisclosure(OWNER);
  expect(disclosure?.exportable).toBe(false);
});

it("requestPersistentStorage and isStoragePersisted return null when the browser lacks the Storage API", async () => {
  expect(await requestPersistentStorage()).toBeNull();
  expect(await isStoragePersisted()).toBeNull();
});

it("requestPersistentStorage and isStoragePersisted delegate to navigator.storage when available", async () => {
  const persist = vi.fn().mockResolvedValue(true);
  const persisted = vi.fn().mockResolvedValue(false);
  vi.stubGlobal("navigator", { ...navigator, storage: { persist, persisted } });

  expect(await requestPersistentStorage()).toBe(true);
  expect(await isStoragePersisted()).toBe(false);
  expect(persist).toHaveBeenCalledOnce();
  expect(persisted).toHaveBeenCalledOnce();
});
