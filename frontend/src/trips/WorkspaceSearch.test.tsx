// @vitest-environment jsdom
import { createRootRoute } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { renderRoutesWithOwner } from "../query/test-utils";
import { WorkspaceSearch } from "./WorkspaceSearch";

afterEach(cleanup);

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
