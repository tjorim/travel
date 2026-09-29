import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider, type AnyRoute } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
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
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  return client;
}

export function renderWithOwner(ui: ReactElement, client = testClient()) {
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

/** Renders a route tree behind a memory-history router, for pages that read params, search or navigation state. */
export function renderRoutesWithOwner(routeTree: AnyRoute, initialEntries: string[], client = testClient()) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries }) });
  return {
    client,
    router,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
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

/** The visible text of a search combobox's current choice, by its accessible label. */
export function selectedOption(label: string): string {
  return (screen.getByRole("combobox", { name: label }) as HTMLInputElement).value;
}

/** Opens the search combobox labelled `label` and chooses the option named `optionName`. */
export function chooseOption(label: string, optionName: string | RegExp) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: optionName }));
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
