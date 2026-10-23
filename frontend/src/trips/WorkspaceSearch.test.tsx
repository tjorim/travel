// @vitest-environment happy-dom
import { createRootRoute } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderRoutesWithOwner, testToken } from "../query/test-utils";
import { WorkspaceSearch } from "./WorkspaceSearch";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

let api: FakeApi | null = null;
beforeEach(() => {
  auth.session = null;
  api = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (api) expect(api.unexpected).toEqual([]);
});

/** The popup opens after the key press has been handled, so the option is awaited. */
async function choose(optionName: string) {
  fireEvent.keyDown(await screen.findByRole("combobox", { name: "Ga naar" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

const render = () =>
  renderRoutesWithOwner(createRootRoute({ component: () => <WorkspaceSearch tripId="t1" /> }), [
    "/",
  ]);

it("offers every tab and every block inside a tab", async () => {
  render();
  fireEvent.keyDown(await screen.findByRole("combobox", { name: "Ga naar" }), {
    key: "ArrowDown",
  });
  for (const name of ["Overzicht", "Plan › Verblijven", "Voorbereiden › Documenten", "Verhaal"])
    expect(await screen.findByRole("option", { name })).toBeTruthy();
});

it("goes to a block with its hash, and asks it to expand", async () => {
  const { router } = render();
  await screen.findByRole("combobox", { name: "Ga naar" });
  await choose("Plan › Verblijven");
  await waitFor(() => expect(router.state.location.pathname).toBe("/trips/t1/plan"));
  expect(router.state.location.hash).toBe("stays");
  expect(router.state.location.state.openSection?.id).toBe("stays");
});

it("goes to a tab that has no blocks without a hash", async () => {
  const { router } = render();
  await screen.findByRole("combobox", { name: "Ga naar" });
  await choose("Inpakken");
  await waitFor(() => expect(router.state.location.pathname).toBe("/trips/t1/packing"));
  expect(router.state.location.hash).toBe("");
});

const area = { id: "a1", label: "Taipei", visibility: "private" };

/** A trip with a stay, a task and a travel update, and a photo library big enough to overflow one kind's results. */
function signedIn() {
  auth.session = { accessToken: testToken() };
  const photo = (index: number) => ({
    id: `m${index}`,
    media_kind: "photo",
    original_filename: `Strand ${index}.jpg`,
  });
  api = fakeApi();
  api.on("GET", /^\/api\/trips$/, () => [
    {
      id: "t1",
      title: "Exampleland",
      travel_updates: [{ id: "u1", title: "Aankomst in Taipei", occurred_at: "2054-11-16" }],
    },
  ]);
  api.collection("/api/trips/t1/areas", [area]);
  api.collection("/api/trips/t1/locations", []);
  api.collection("/api/trips/t1/visits", []);
  api.collection("/api/trips/t1/routes", []);
  api.collection("/api/trips/t1/stays", [
    { id: "s1", property_name: "Café Hotel Taipei", area, location: {} },
  ]);
  api.collection("/api/trips/t1/trip-tasks", [{ id: "k1", title: "Visum regelen" }]);
  api.collection("/api/trips/t1/documents", []);
  api.collection(
    "/api/trips/t1/media",
    Array.from({ length: 7 }, (_, index) => photo(index + 1)),
  );
}

async function search(query: string) {
  fireEvent.change(await screen.findByRole("combobox", { name: "Ga naar" }), {
    target: { value: query },
  });
}

it("finds a record by its title, whatever the accents, and labels it with its tab and block", async () => {
  signedIn();
  const { router } = render();
  await waitFor(() => expect(api!.count("GET /api/trips/t1/media")).toBe(1));
  await search("cafe hotel");
  fireEvent.click(
    await screen.findByRole("option", { name: "Plan › Verblijven › Café Hotel Taipei" }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/trips/t1/plan"));
  expect(router.state.location.state.openRecord).toMatchObject({ kind: "stay", id: "s1" });
});

it("opens a task in Prepare and a travel update in Story", async () => {
  signedIn();
  const { router } = render();
  await waitFor(() => expect(api!.count("GET /api/trips/t1/media")).toBe(1));
  await search("visum");
  fireEvent.click(
    await screen.findByRole("option", { name: "Voorbereiden › Nog te regelen › Visum regelen" }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/trips/t1/prepare"));
  expect(router.state.location.state.openRecord).toMatchObject({ kind: "task", id: "k1" });

  await search("aankomst");
  fireEvent.click(
    await screen.findByRole("option", { name: "Verhaal › Reisupdates › Aankomst in Taipei" }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/trips/t1/story"));
  expect(router.state.location.state.openRecord).toMatchObject({ kind: "update", id: "u1" });
});

it("shows a few photos and counts the rest instead of listing a whole library", async () => {
  signedIn();
  render();
  await waitFor(() => expect(api!.count("GET /api/trips/t1/media")).toBe(1));
  await search("strand");
  expect(
    await screen.findAllByRole("option", { name: /Verhaal › Mediabibliotheek › Strand/ }),
  ).toHaveLength(5);
  const more = screen.getByRole("option", { name: /Nog 2 in Verhaal › Mediabibliotheek/ });
  expect(more.getAttribute("aria-disabled")).toBe("true");
});

it("sends no request that carries the search words", async () => {
  signedIn();
  render();
  await waitFor(() => expect(api!.count("GET /api/trips/t1/media")).toBe(1));
  await search("visum");
  await screen.findByRole("option", { name: /Visum regelen/ });
  expect(api!.requests.filter((request) => /visum/i.test(request))).toEqual([]);
});
