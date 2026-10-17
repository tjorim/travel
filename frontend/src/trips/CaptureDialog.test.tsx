// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
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
    {
      id: "t1",
      title: "Exampleland",
      summary: null,
      starts_on: null,
      ends_on: null,
      travel_updates: [],
    },
    {
      id: "t2",
      title: "IJsland",
      summary: null,
      starts_on: null,
      ends_on: null,
      travel_updates: [],
    },
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

it("takes a media-review candidate even though the closed dialog already loaded its stored draft", async () => {
  saveDraft({ ...emptyDraft("t1"), title: "Bewaard concept", notes: "" });
  api = fakeApi()
    .collection("/api/trips/t1/media", [
      {
        id: "m1",
        media_kind: "photo",
        original_filename: "kust.jpg",
        byte_size: 10,
        captured_at: null,
      },
    ])
    .collection("/api/trips/t2/media", []);
  api.on("GET", /^\/api\/trips$/, () => trips);
  const consumed = vi.fn();
  const dialog = (open: boolean, candidate?: Parameters<typeof CaptureDialog>[0]["candidate"]) => (
    <CaptureDialog
      open={open}
      lockedTripId="t1"
      candidate={candidate}
      onCandidateConsumed={consumed}
      onDismiss={() => undefined}
    />
  );
  const view = renderWithOwner(dialog(false));
  // Let the trips arrive so the closed dialog has loaded its stored draft before the candidate is handed over.
  await waitFor(() => expect(api.count("GET /api/trips")).toBeGreaterThan(0));
  await new Promise((resolve) => setTimeout(resolve, 50));

  view.rerender(
    <QueryClientProvider client={view.client}>
      {dialog(true, { tripId: "t1", mediaAssetIds: ["m1"], occurredAt: "2054-11-20T10:15:00Z" })}
    </QueryClientProvider>,
  );
  const title = (await screen.findByLabelText("Titel")) as HTMLInputElement;
  await waitFor(() => expect(title.value).toBe(""));
  expect(
    (await screen.findByRole("checkbox", { name: /kust\.jpg/ })).getAttribute("aria-checked"),
  ).toBe("true");
  expect(consumed).toHaveBeenCalled();
});
