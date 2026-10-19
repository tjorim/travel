// @vitest-environment jsdom
import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Boundary } from "./Boundary";
import { useCapture } from "./capture-context";
import { renderRoutesWithOwner, testToken } from "./query/test-utils";

const auth = vi.hoisted(() => ({
  session: null as { accessToken: string; expiresAt: number } | null,
  setSession: () => undefined,
}));
vi.mock("./auth-context", () => ({ useAuth: () => auth }));
vi.mock("./Preferences", () => ({ Preferences: () => null }));
vi.mock("./trips/CaptureDialog", () => ({
  CaptureDialog: ({
    open,
    lockedTripId,
    candidate,
  }: {
    open: boolean;
    lockedTripId?: string | null;
    candidate?: { mediaAssetIds: string[] } | null;
  }) =>
    open ? (
      <p role="dialog" aria-label="Vastleggen">
        {`locked:${lockedTripId ?? "none"} candidate:${candidate?.mediaAssetIds.join(",") ?? "none"}`}
      </p>
    ) : null,
}));

beforeEach(() => {
  auth.session = { accessToken: testToken(), expiresAt: Date.now() + 60_000 };
});
afterEach(cleanup);

function render(path: string) {
  const root = createRootRoute({
    component: () => (
      <Boundary>
        <Outlet />
      </Boundary>
    ),
  });
  const page = (id: string) =>
    createRoute({ getParentRoute: () => root, path: id, component: () => <p>pagina</p> });
  return renderRoutesWithOwner(
    root.addChildren([page("/"), page("trips"), page("trips/$tripId/$section")]),
    [path],
  );
}

it("has the site-wide places only: Start, Trips, Library and Settings", async () => {
  render("/trips");
  const nav = within(await screen.findByRole("navigation", { name: "App navigatie" }));
  expect(nav.getAllByRole("link").map((link) => link.textContent)).toEqual([
    "Start",
    "Reizen",
    "Bibliotheek",
    "Instellingen",
  ]);
});

it("keeps Trips highlighted while the owner is inside a trip", async () => {
  render("/trips/t1/plan");
  const nav = within(await screen.findByRole("navigation", { name: "App navigatie" }));
  expect(nav.getByRole("link", { name: "Reizen" }).getAttribute("aria-current")).toBe("page");
  expect(nav.getByRole("link", { name: "Start" }).getAttribute("aria-current")).toBeNull();
});

it("opens the capture dialog without a trip when the owner is not in one", async () => {
  render("/trips");
  fireEvent.click(await screen.findByRole("button", { name: "Vastleggen" }));
  expect((await screen.findByRole("dialog")).textContent).toBe("locked:none candidate:none");
});

it("opens the capture dialog locked to the trip the owner is in", async () => {
  render("/trips/t1/plan");
  fireEvent.click(await screen.findByRole("button", { name: "Vastleggen in deze reis" }));
  await waitFor(() =>
    expect(screen.getByRole("dialog").textContent).toBe("locked:t1 candidate:none"),
  );
});

it("lets a page start the dialog from a media candidate for its trip", async () => {
  const root = createRootRoute({
    component: () => (
      <Boundary>
        <Outlet />
      </Boundary>
    ),
  });
  function Page() {
    const openCapture = useCapture();
    return (
      <button
        type="button"
        onClick={() =>
          openCapture({
            tripId: "t1",
            candidate: { tripId: "t1", mediaAssetIds: ["m1", "m2"] },
          })
        }
      >
        Kandidaat
      </button>
    );
  }
  renderRoutesWithOwner(
    root.addChildren([createRoute({ getParentRoute: () => root, path: "/", component: Page })]),
    ["/"],
  );
  fireEvent.click(await screen.findByRole("button", { name: "Kandidaat" }));
  await waitFor(() =>
    expect(screen.getByRole("dialog").textContent).toBe("locked:t1 candidate:m1,m2"),
  );
});

it("opens the account popover from its trigger and returns focus when Escape closes it", async () => {
  render("/trips");
  const trigger = await screen.findByRole("button", { name: "Account" });
  fireEvent.click(trigger);
  expect(await screen.findByRole("button", { name: "Afmelden" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Afmelden" })).toBeNull());
  expect(document.activeElement).toBe(trigger);
});
