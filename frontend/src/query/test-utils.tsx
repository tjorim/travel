import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { __resetOfflineStoreForTests } from "../offline/offline-store";
import { createOwnerQueryClient } from "./client";

/** An unsigned, JWT-shaped token: enough for the client-side subject decode. */
export function testToken(subject = "owner-1"): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replaceAll("=", "");
  return `${encode({ alg: "none" })}.${encode({ sub: subject })}.`;
}

export function testClient(options?: Parameters<typeof createOwnerQueryClient>[0]) {
  const client = createOwnerQueryClient(options);
  // Keep failing reads final and fast in tests.
  client.setDefaultOptions({ ...client.getDefaultOptions(), queries: { ...client.getDefaultOptions().queries, retry: false } });
  return client;
}

export function renderWithOwner(ui: ReactElement, client = testClient()) {
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

/** jsdom has no object URLs; give a test one and remove it again with `restoreObjectUrls`. */
export function stubObjectUrls(url = "blob:test") {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: () => url });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: () => undefined });
}

export function restoreObjectUrls() {
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
}

/** Empties the device-scoped offline store between tests (needs `fake-indexeddb/auto`). */
export async function resetOfflineDb() {
  await __resetOfflineStoreForTests();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("travel-offline-v1");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
