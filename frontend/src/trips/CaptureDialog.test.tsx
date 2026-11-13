// @vitest-environment happy-dom
import { mockCaptureLocks } from "../capture-draft-test-utils";
import { http, HttpResponse } from "msw/http";
import { server } from "../mocks/server";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { vi, afterEach, beforeEach, expect, it } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import { emptyDraft, readDraft, saveDraft } from "../capture-draft";
import { type Trip } from "../api-types";
import { CaptureDialog } from "./CaptureDialog";

const auth = vi.hoisted(() => ({
  session: null as { accessToken: string; expiresAt: number } | null,
}));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

let trips: Trip[];
let api: FakeApi;

/** Date and time, the private note, linked library photos and the location sit under "Meer". */
const openMore = async () => {
  const trigger = await screen.findByRole("button", { name: /^Meer/ });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
};

beforeEach(() => {
  mockCaptureLocks();
  auth.session = { accessToken: testToken(), expiresAt: Date.now() + 3600000 };
  localStorage.clear();
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ ...auth.session, expiresAt: Date.now() + 3600000 }),
  );
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  trips = [
    {
      owner_subject: "owner-1",
      cover_derivative_id: null,
      cover_url: null,
      summary_html: null,
      id: "t1",
      title: "Exampleland",
      summary: null,
      starts_on: null,
      ends_on: null,
      travel_updates: [],
    },
    {
      owner_subject: "owner-1",
      cover_derivative_id: null,
      cover_url: null,
      summary_html: null,
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
});

it("locks the dialog to the given trip, showing its name instead of a trip picker", async () => {
  renderWithOwner(<CaptureDialog open lockedTripId="t1" onDismiss={() => undefined} />);
  await screen.findByText("Exampleland", { selector: "strong" });
  expect(screen.queryByLabelText("Reis")).toBeNull();
  expect(screen.getByRole("heading", { name: "Moment vastleggen — Exampleland" })).toBeTruthy();
});

it("never mixes drafts between trips: opening one trip's dialog leaves another trip's draft untouched", async () => {
  await saveDraft({ ...emptyDraft("t2"), title: "IJsland concept", notes: "" });
  renderWithOwner(<CaptureDialog open lockedTripId="t1" onDismiss={() => undefined} />);
  const title = (await screen.findByLabelText("Titel")) as HTMLInputElement;
  expect(title.value).toBe("");
  fireEvent.change(title, { target: { value: "Exampleland concept" } });
  await waitFor(() => expect(readDraft("t1")?.title).toBe("Exampleland concept"));
  expect(readDraft("t2")?.title).toBe("IJsland concept");
});

it("takes a media-review candidate even though the closed dialog already loaded its stored draft", async () => {
  await saveDraft({ ...emptyDraft("t1"), title: "Bewaard concept", notes: "" });
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
  await openMore();
  expect(
    (await screen.findByRole("checkbox", { name: /kust\.jpg/ })).getAttribute("aria-checked"),
  ).toBe("true");
  expect(consumed).toHaveBeenCalled();
});

const place = {
  display_name: "Taipei Main Station",
  osm_element_type: "way",
  osm_element_id: 1,
  latitude: 25.04,
  longitude: 121.51,
};

it("asks for at least two characters, then searches, lists results and keeps the chosen place in the draft", async () => {
  api.on("POST", /^\/api\/trips\/t1\/places\/search$/, () => ({
    results: [place],
    attribution: "OpenStreetMap",
    attribution_url: "https://www.openstreetmap.org/copyright",
  }));
  renderWithOwner(<CaptureDialog open lockedTripId="t1" onDismiss={() => undefined} />);
  await openMore();
  const query = await screen.findByLabelText("Zoek locatie");
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  expect(await screen.findByText(/minstens twee tekens/)).toBeTruthy();

  fireEvent.change(query, { target: { value: "Taipei" } });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Taipei Main Station" }));

  expect(await screen.findByText(/Locatie geselecteerd/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Taipei Main Station" })).toBeNull();
  expect(api.lastBody("POST /api/trips/t1/places/search")).toEqual({ query: "Taipei" });
});

it("offers a linked photo's capture date and place as private suggestions", async () => {
  api = fakeApi().collection("/api/trips/t1/media", [
    {
      id: "m1",
      media_kind: "photo",
      original_filename: "kust.jpg",
      byte_size: 10,
      captured_at: "2054-11-20T10:15:00Z",
      captured_local: false,
      gps: { latitude: 25.04, longitude: 121.51 },
    },
  ]);
  api.on("GET", /^\/api\/trips$/, () => trips);
  api.on("POST", /^\/api\/trips\/t1\/places\/reverse$/, () => ({
    results: [place],
    attribution: "OpenStreetMap",
    attribution_url: "https://www.openstreetmap.org/copyright",
  }));
  renderWithOwner(<CaptureDialog open lockedTripId="t1" onDismiss={() => undefined} />);
  await openMore();
  fireEvent.click(await screen.findByRole("checkbox", { name: /kust\.jpg/ }));

  fireEvent.click(await screen.findByRole("button", { name: "Gebruik opnamedatum" }));
  expect(await screen.findByText(/Opnamedatum als voorstel overgenomen/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Zoek plaats bij foto" }));
  expect(await screen.findByRole("button", { name: "Taipei Main Station" })).toBeTruthy();
  expect(api.lastBody("POST /api/trips/t1/places/reverse")).toEqual({
    latitude: 25.04,
    longitude: 121.51,
  });

  fireEvent.click(screen.getByRole("button", { name: "Voorstel negeren" }));
  expect(screen.queryByRole("button", { name: "Gebruik opnamedatum" })).toBeNull();
});

it("remounts capture on an account transition so A's in-memory fields cannot become B's draft", async () => {
  const view = renderWithOwner(
    <CaptureDialog open lockedTripId="t1" onDismiss={() => undefined} />,
  );
  const title = await screen.findByLabelText("Titel");
  fireEvent.change(title, { target: { value: "Synthetic A private draft" } });
  await waitFor(() => expect(readDraft("t1")?.title).toBe("Synthetic A private draft"));
  auth.session = { accessToken: testToken("owner-B"), expiresAt: Date.now() + 3600000 };
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ ...auth.session, expiresAt: Date.now() + 3600000 }),
  );
  view.rerender(
    <QueryClientProvider client={view.client}>
      <CaptureDialog open lockedTripId="t1" onDismiss={() => undefined} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByLabelText("Titel")).toHaveValue(""));
  expect(readDraft("t1")).toBeNull();
  expect(api.count("POST /api/trips/t1/travel-updates")).toBe(0);
});

it("keeps edits in memory and reports an unavailable local save without Web Locks", async () => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  renderWithOwner(<CaptureDialog open lockedTripId="t1" onDismiss={() => undefined} />);
  const title = await screen.findByLabelText("Titel");
  fireEvent.change(title, { target: { value: "Synthetic in-memory draft" } });
  await screen.findByText(
    "Concept niet op dit apparaat bewaard. Houd dit formulier open of sla het online op in je privéreis.",
  );
  expect(title).toHaveValue("Synthetic in-memory draft");
  expect(readDraft("t1")).toBeNull();
  expect(api.count("POST /api/trips/t1/travel-updates")).toBe(0);
});

it("keeps another tab's newer draft when a delayed server save succeeds", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let submitted = false;
  server.use(
    http.post("*/api/trips/t1/travel-updates", async () => {
      submitted = true;
      await pending;
      return HttpResponse.json({
        id: "saved",
        occurred_at: "2054-11-01T12:00:00Z",
        date_precision: "day",
        title: "Submitted",
        body: "",
        private_notes: null,
        area_id: null,
        location: null,
        media_asset_ids: [],
        visibility: "private",
      });
    }),
  );
  renderWithOwner(<CaptureDialog open lockedTripId="t1" onDismiss={() => undefined} />);
  fireEvent.change(await screen.findByLabelText("Titel"), { target: { value: "Submitted" } });
  await waitFor(() => expect(readDraft("t1")?.title).toBe("Submitted"));
  fireEvent.click(screen.getByRole("button", { name: "Reisupdate opslaan" }));
  await waitFor(() => expect(submitted).toBe(true));
  await saveDraft({ ...readDraft("t1")!, title: "Other tab newer" });
  finish();
  await screen.findByText(
    "Opgeslagen in je privéreis. Het lokale concept is behouden omdat het gewijzigd is of niet kon worden gewist.",
  );
  expect(readDraft("t1")?.title).toBe("Other tab newer");
});
it("restores a locked trip's draft before allowing its initial empty form to persist", async () => {
  await saveDraft({ ...emptyDraft("t1"), title: "Synthetic locked trip draft" });
  renderWithOwner(<CaptureDialog open lockedTripId="t1" onDismiss={() => undefined} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Titel")).toHaveValue("Synthetic locked trip draft"),
  );
  await waitFor(() => expect(readDraft("t1")?.title).toBe("Synthetic locked trip draft"));
});
