// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import { VisibilityControl } from "./visibility";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

let api: FakeApi;
beforeEach(() => { auth.session = { accessToken: testToken() }; api = fakeApi(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); expect(api.unexpected).toEqual([]); });

it("offers the same three choices for every kind and saves the chosen one at once", async () => {
  api.on("PUT", /\/visibility\/visit\/s1$/, (body) => body);
  renderWithOwner(<VisibilityControl tripId="trip" kind="visit" id="s1" value="private" name="Noordkust" />);
  const control = screen.getByLabelText("Zichtbaarheid van Noordkust") as HTMLSelectElement;
  expect([...control.options].map((option) => option.value)).toEqual(["private", "everyone", "custom"]);
  fireEvent.change(control, { target: { value: "custom" } });
  await waitFor(() => expect(api.lastBody("PUT /api/trips/trip/visibility/visit/s1")).toEqual({ visibility: "custom" }));
});

it("shows the server's reason when a record cannot be shared yet", async () => {
  api.on("PUT", /\/visibility\/location\/e1$/, (body) => body);
  api.failNext = { status: 422, body: { detail: "Give this location a public name before sharing it" } };
  renderWithOwner(<VisibilityControl tripId="trip" kind="location" id="e1" value="private" name="Hotel" />);
  fireEvent.change(screen.getByLabelText("Zichtbaarheid van Hotel"), { target: { value: "everyone" } });
  expect(await screen.findByRole("alert")).toBeTruthy();
});

it("gives a photo attached to a reisupdate no choice of its own", () => {
  renderWithOwner(<VisibilityControl tripId="trip" kind="media_derivative" id="x1" value="private" name="kust.jpg" followsUpdate="Aankomst" />);
  expect(screen.queryByLabelText("Zichtbaarheid van kust.jpg")).toBeNull();
  expect(screen.getByText(/gedeeld samen met reisupdate “Aankomst”/)).toBeTruthy();
});
