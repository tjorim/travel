// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { vi, afterEach, beforeEach, expect, it } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import { clearDraft, emptyDraft, readDraft, saveDraft, type Trip } from "../tracker-model";
import { CaptureDialog } from "./CaptureDialog";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

let trips: Trip[];
let api: FakeApi;

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  clearDraft("t1");
  clearDraft("t2");
  trips = [
    { id: "t1", title: "Exampleland", summary: null, starts_on: null, ends_on: null, travel_updates: [] },
    { id: "t2", title: "IJsland", summary: null, starts_on: null, ends_on: null, travel_updates: [] },
  ];
  api = fakeApi().collection("/api/trips/t1/media", []).collection("/api/trips/t2/media", []);
  api.on("GET", /^\/api\/trips$/, () => trips);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearDraft("t1");
  clearDraft("t2");
});

it("locks the dialog to the given trip, showing its name instead of a trip picker", async () => {
  renderWithOwner(<CaptureDialog open lockedTripId="t1" onDismiss={() => undefined} />);
  await screen.findByText("Exampleland", { selector: "strong" });
  expect(screen.queryByLabelText("Reis")).toBeNull();
  expect(screen.getByRole("heading", { name: "Moment vastleggen — Exampleland" })).toBeTruthy();
});

it("never mixes drafts between trips: opening one trip's dialog leaves another trip's draft untouched", async () => {
  saveDraft({ ...emptyDraft("t2"), title: "IJsland concept", notes: "" });
  renderWithOwner(<CaptureDialog open lockedTripId="t1" onDismiss={() => undefined} />);
  const title = (await screen.findByLabelText("Titel")) as HTMLInputElement;
  expect(title.value).toBe("");
  fireEvent.change(title, { target: { value: "Exampleland concept" } });
  await waitFor(() => expect(readDraft("t1")?.title).toBe("Exampleland concept"));
  expect(readDraft("t2")?.title).toBe("IJsland concept");
});
