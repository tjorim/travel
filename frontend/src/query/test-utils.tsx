import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

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
