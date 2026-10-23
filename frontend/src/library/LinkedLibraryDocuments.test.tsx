// @vitest-environment happy-dom
import { createRootRoute } from "@tanstack/react-router";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { ownerKeys } from "../query/keys";
import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import { LinkedLibraryDocuments } from "./LinkedLibraryDocuments";

const routeTree = createRootRoute({ component: () => <LinkedLibraryDocuments tripId="trip" /> });
const renderLinked = () => renderRoutesWithOwner(routeTree, ["/"]);

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const document = (id: string, title: string) => ({
  id,
  title,
  byte_size: 2048,
  original_filename: `${id}.pdf`,
});
let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("lists the library documents linked to this trip", async () => {
  api = fakeApi().collection("/api/library/documents?linked_trip_id=trip", [
    document("d1", "Verzekering"),
  ]);
  renderLinked();
  await screen.findByText("Verzekering");
  expect(screen.getByRole("link", { name: "Naar bibliotheek" })).toBeTruthy();
});

it("shows nothing without linked documents, or when they cannot be read", async () => {
  api = fakeApi().collection("/api/library/documents?linked_trip_id=trip", []);
  const { container } = renderLinked();
  await vi.waitFor(() =>
    expect(api.count("GET /api/library/documents?linked_trip_id=trip")).toBe(1),
  );
  expect(container.textContent).toBe("");
  cleanup();

  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ detail: "kapot" }), { status: 500 })),
    ),
  );
  const failing = renderLinked();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(failing.container.textContent).toBe("");
});

it("follows a change to the library documents without a reload", async () => {
  api = fakeApi().collection("/api/library/documents?linked_trip_id=trip", [
    document("d1", "Verzekering"),
  ]);
  const { client } = renderLinked();
  await screen.findByText("Verzekering");
  api.push("/api/library/documents?linked_trip_id=trip", document("d2", "Visum"));
  // A library write invalidates the library documents key, which the trip's linked list is nested under.
  await act(async () => {
    await client.invalidateQueries({ queryKey: ownerKeys.library("owner-1", "documents") });
  });
  await screen.findByText("Visum");
});
