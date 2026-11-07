// @vitest-environment happy-dom
import { mockCaptureLocks } from "../capture-draft-test-utils";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dayjs } from "../dayjs";
import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, restoreObjectUrls, stubObjectUrls, testToken } from "../query/test-utils";
import { emptyDraft, readDraft, saveDraft, type Trip } from "../tracker-model";
import { CaptureDialog } from "./CaptureDialog";

const auth = vi.hoisted(() => ({
  session: null as { accessToken: string; expiresAt: number } | null,
}));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const day = (offset: number) => dayjs().add(offset, "day").format("YYYY-MM-DD");
const trip = (
  id: string,
  title: string,
  starts_on: string | null,
  ends_on: string | null,
): Trip => ({
  id,
  title,
  summary: null,
  starts_on,
  ends_on,
  travel_updates: [],
});

const photo = (id: string, name: string) => ({
  id,
  media_kind: "photo",
  original_filename: name,
  byte_size: 10,
  captured_at: null,
  captured_local: false,
  gps: null,
  file_url: `/api/trips/t1/media/${id}/file`,
  thumbnail_url: `/api/trips/t1/media/${id}/thumbnail`,
});

let trips: Trip[];
let api: FakeApi;

function mount(props: Partial<Parameters<typeof CaptureDialog>[0]> = {}) {
  return renderWithOwner(
    <CaptureDialog open lockedTripId="t1" onDismiss={() => undefined} {...props} />,
  );
}
const chooser = () => screen.getByLabelText("Foto’s kiezen", { selector: "input" });
const choose = (...files: File[]) => fireEvent.change(chooser(), { target: { files } });
const jpeg = (name: string, modified = 1) =>
  new File(["synthetic"], name, { type: "image/jpeg", lastModified: modified });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Reisupdate opslaan" }));

beforeEach(() => {
  mockCaptureLocks();
  stubObjectUrls();
  auth.session = { accessToken: testToken(), expiresAt: Date.now() + 3600000 };
  localStorage.clear();
  sessionStorage.setItem("travel-tracker-session", JSON.stringify(auth.session));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  trips = [trip("t1", "Exampleland", null, null), trip("t2", "IJsland", null, null)];
  api = fakeApi()
    .collection("/api/trips/t1/media", [])
    .collection("/api/trips/t2/media", [])
    .collection("/api/trips/t1/travel-updates", [])
    .collection("/api/trips/t2/travel-updates", []);
  api.on("GET", /^\/api\/trips$/, () => trips);
  api.on("GET", /\/thumbnail$/, () => ({}));
  api.on("POST", /^\/api\/trips\/t1\/media\/uploads$/, (body) => {
    const name = (body as FormData).get("file") as File;
    return api.push(
      "/api/trips/t1/media",
      photo(`up-${api.rows("/api/trips/t1/media").length}`, name.name),
    );
  });
});

afterEach(() => {
  cleanup();
  restoreObjectUrls();
  vi.restoreAllMocks();
  expect(api.unexpected).toEqual([]);
});

it("puts photos first, then one line, then the folded More section and Save", async () => {
  mount();
  const title = await screen.findByLabelText("Titel");
  const photos = screen.getByRole("group", { name: "Foto’s" });
  const more = screen.getByRole("button", { name: /^Meer/ });
  const saveButton = screen.getByRole("button", { name: "Reisupdate opslaan" });
  const before = (first: Element, second: Element) =>
    Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(before(photos, title)).toBe(true);
  expect(before(title, more)).toBe(true);
  expect(before(more, saveButton)).toBe(true);
  // The language switch no longer sits above everything else.
  expect(before(saveButton, screen.getByRole("radiogroup", { name: "Taal", hidden: true }))).toBe(
    false,
  );
});

it("folds language, connection, the full privacy text, date and time, note and location under More", async () => {
  mount();
  await screen.findByLabelText("Titel");
  const more = screen.getByRole("button", { name: /^Meer/ });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  for (const hidden of [
    screen.queryByRole("textbox", { name: /Privénotitie/ }),
    screen.queryByRole("radiogroup", { name: "Taal" }),
    screen.queryByRole("textbox", { name: "Zoek locatie" }),
    screen.queryByRole("group", { name: "Datum en tijd" }),
    screen.queryByText(/Verbonden — je kiest zelf/, { ignore: "[hidden] *" }),
  ])
    expect(hidden).toBeNull();
  // Privacy is never folded away: a short form sits beside Save.
  const short = screen.getByText("Privé — alleen jij ziet dit, foto’s ook.");
  expect(short.closest("[hidden]")).toBeNull();

  fireEvent.click(more);
  expect(more.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("textbox", { name: /Privénotitie/ })).toBeTruthy();
  expect(screen.getByRole("radiogroup", { name: "Taal" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Zoek locatie" })).toBeTruthy();
  expect(screen.getByText(/Verbonden — je kiest zelf/)).toBeTruthy();
  expect(screen.getByRole("complementary", { name: "Delen van deze reisupdate" })).toBeTruthy();
  expect(screen.getByText(/Een nieuwe reisupdate is privé/)).toBeTruthy();
});

it("opens and closes More from the keyboard, right after the line", async () => {
  const user = userEvent.setup();
  mount();
  const title = await screen.findByLabelText("Titel");
  const more = screen.getByRole("button", { name: /^Meer/ });
  title.focus();
  await user.tab();
  expect(document.activeElement).toBe(more);
  await user.keyboard("{Enter}");
  expect(more.getAttribute("aria-expanded")).toBe("true");
  await user.keyboard(" ");
  expect(more.getAttribute("aria-expanded")).toBe("false");
  // The tab order past a folded More (straight to Save) needs real layout; e2e/capture-photo-first covers it.
});

it("saves one photo and one line with nothing but the line typed", async () => {
  mount();
  await screen.findByLabelText("Titel");
  choose(jpeg("kust.jpg"));
  const remove = await screen.findByRole("button", { name: "kust.jpg uit deze update halen" });
  expect(remove).toBeTruthy();
  expect(api.lastBody<FormData>("POST /api/trips/t1/media/uploads")!.get("file")).toBeInstanceOf(
    File,
  );
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Zonsondergang" } });
  save();
  await screen.findByText("Reisupdate opgeslagen.");
  expect(api.lastBody("POST /api/trips/t1/travel-updates")).toMatchObject({
    title: "Zonsondergang",
    private_notes: null,
    media_asset_ids: ["up-0"],
  });
  // The saved update stays private; Capture sends no visibility and no publication.
  expect(Object.keys(api.lastBody("POST /api/trips/t1/travel-updates")!)).not.toContain(
    "visibility",
  );
  expect(readDraft("t1")).toBeNull();
  expect(screen.queryByRole("button", { name: /uit deze update halen/ })).toBeNull();
});

it("uploads a photo picked twice once and links it once", async () => {
  mount();
  await screen.findByLabelText("Titel");
  choose(jpeg("kust.jpg"), jpeg("kust.jpg"));
  await screen.findByRole("button", { name: "kust.jpg uit deze update halen" });
  choose(jpeg("kust.jpg"));
  expect(api.count("POST /api/trips/t1/media/uploads")).toBe(1);
  expect(screen.getAllByRole("button", { name: "kust.jpg uit deze update halen" })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Kust" } });
  await waitFor(() => expect(readDraft("t1")?.mediaAssetIds).toEqual(["up-0"]));
});

it("takes a photo out of the update without deleting it from the library", async () => {
  mount();
  await screen.findByLabelText("Titel");
  choose(jpeg("kust.jpg"));
  fireEvent.click(await screen.findByRole("button", { name: "kust.jpg uit deze update halen" }));
  expect(screen.queryByRole("button", { name: /uit deze update halen/ })).toBeNull();
  expect(api.requests.filter((request) => request.startsWith("DELETE"))).toEqual([]);
  expect(api.rows("/api/trips/t1/media")).toHaveLength(1);
});

it("keeps a failed upload visible, blocks Save until it is retried or removed", async () => {
  mount();
  await screen.findByLabelText("Titel");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Kust" } });
  api.failNext = { status: 500, body: {} };
  choose(jpeg("kust.jpg"));
  const alert = await screen.findByText(/kust\.jpg kon niet worden geüpload/);
  expect(alert).toBeTruthy();
  save();
  await screen.findByText(/Een foto is niet geüpload/);
  expect(api.count("POST /api/trips/t1/travel-updates")).toBe(0);

  fireEvent.click(screen.getByRole("button", { name: "kust.jpg opnieuw uploaden" }));
  await screen.findByRole("button", { name: "kust.jpg uit deze update halen" });
  expect(screen.queryByText(/kon niet worden geüpload/)).toBeNull();
  save();
  await screen.findByText("Reisupdate opgeslagen.");
  expect(api.lastBody("POST /api/trips/t1/travel-updates")).toMatchObject({
    media_asset_ids: ["up-0"],
  });
});

it("lets a failed upload be removed and then saves without it", async () => {
  mount();
  await screen.findByLabelText("Titel");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Kust" } });
  api.failNext = { status: 500, body: {} };
  choose(jpeg("kust.jpg"));
  await screen.findByText(/kust\.jpg kon niet worden geüpload/);
  fireEvent.click(screen.getByRole("button", { name: "kust.jpg uit deze update halen" }));
  save();
  await screen.findByText("Reisupdate opgeslagen.");
  expect(api.lastBody("POST /api/trips/t1/travel-updates")).toMatchObject({ media_asset_ids: [] });
});

it("restores a draft with its photos as thumbnails and keeps them in the local draft", async () => {
  api.collection("/api/trips/t1/media", [photo("m1", "kust.jpg"), photo("m2", "markt.jpg")]);
  await saveDraft({ ...emptyDraft("t1"), title: "Bewaard", mediaAssetIds: ["m1", "m2"] });
  mount();
  await waitFor(() => expect(screen.getByLabelText("Titel")).toHaveValue("Bewaard"));
  expect(
    await screen.findByRole("button", { name: "kust.jpg uit deze update halen" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "markt.jpg uit deze update halen" })).toBeTruthy();
  const thumbnails = within(screen.getByRole("group", { name: "Foto’s" })).getAllByRole("listitem");
  expect(thumbnails).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: "kust.jpg uit deze update halen" }));
  await waitFor(() => expect(readDraft("t1")?.mediaAssetIds).toEqual(["m2"]));
});

it("asks before discarding a draft that holds photos", async () => {
  const dismissed = vi.fn();
  mount({ onDismiss: dismissed });
  await screen.findByLabelText("Titel");
  choose(jpeg("kust.jpg"));
  await screen.findByRole("button", { name: "kust.jpg uit deze update halen" });
  fireEvent.click(screen.getByRole("button", { name: "Moment vastleggen — Exampleland sluiten" }));
  expect(await screen.findByRole("alertdialog", { name: "Wijzigingen verwerpen?" })).toBeTruthy();
  expect(dismissed).not.toHaveBeenCalled();
});

it("cannot add photos while offline and says the note stays a draft", async () => {
  mount();
  await screen.findByLabelText("Titel");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(await screen.findByRole("button", { name: "Foto’s kiezen" })).toBeDisabled();
  expect(screen.getByText(/Foto’s toevoegen kan alleen online/)).toBeTruthy();
  expect(screen.getByText(/Offline — concepten blijven lokaal/)).toBeTruthy();
});

it("starts the global entry on the trip underway, not the first trip the API lists", async () => {
  trips = [
    trip("t1", "Later", day(30), day(40)),
    trip("t2", "Nu onderweg", day(-2), day(5)),
    trip("t3", "Voorbij", day(-90), day(-80)),
  ];
  api.collection("/api/trips/t3/media", []).collection("/api/trips/t3/travel-updates", []);
  mount({ lockedTripId: null });
  await screen.findByLabelText("Titel");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Aangekomen" } });
  save();
  await screen.findByText("Reisupdate opgeslagen.");
  expect(api.count("POST /api/trips/t2/travel-updates")).toBe(1);
  expect(api.count("POST /api/trips/t1/travel-updates")).toBe(0);
});

it("starts on the next upcoming trip when none is underway", async () => {
  trips = [
    trip("t1", "Ver weg", day(60), day(70)),
    trip("t2", "Binnenkort", day(10), day(20)),
    trip("t3", "Voorbij", day(-90), day(-80)),
  ];
  api.collection("/api/trips/t3/media", []).collection("/api/trips/t3/travel-updates", []);
  mount({ lockedTripId: null });
  await screen.findByLabelText("Titel");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Pakken" } });
  save();
  await screen.findByText("Reisupdate opgeslagen.");
  expect(api.count("POST /api/trips/t2/travel-updates")).toBe(1);
});

it("starts on the trip captured into last when nothing is underway or upcoming", async () => {
  trips = [
    { ...trip("t1", "Oud", day(-200), day(-190)) },
    {
      ...trip("t2", "Recent", day(-100), day(-90)),
      travel_updates: [
        {
          id: "u1",
          occurred_at: `${day(-92)}T10:00:00Z`,
          date_precision: "day",
          title: "Dag",
          body: "",
          private_notes: null,
          area_id: null,
          location: null,
          media_asset_ids: [],
          visibility: "private",
        },
      ],
    },
  ];
  mount({ lockedTripId: null });
  await screen.findByLabelText("Titel");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Terug" } });
  save();
  await screen.findByText("Reisupdate opgeslagen.");
  expect(api.count("POST /api/trips/t2/travel-updates")).toBe(1);
});

it("shows an unsent draft of another trip before the trip underway", async () => {
  trips = [trip("t1", "Eerder", day(-90), day(-80)), trip("t2", "Nu onderweg", day(-2), day(5))];
  await saveDraft({ ...emptyDraft("t1"), title: "Nog niet verstuurd" });
  mount({ lockedTripId: null });
  await waitFor(() => expect(screen.getByLabelText("Titel")).toHaveValue("Nog niet verstuurd"));
});

it("opens More on its own when a hidden field has the problem", async () => {
  mount();
  const title = await screen.findByLabelText("Titel");
  fireEvent.change(title, { target: { value: "Kust" } });
  fireEvent.click(screen.getByRole("button", { name: /^Meer/ }));
  const time = within(screen.getByRole("group", { name: /Datum en tijd/ })).getAllByRole(
    "textbox",
  )[0];
  fireEvent.change(time, { target: { value: "" } });
  fireEvent.blur(time);
  fireEvent.click(screen.getByRole("button", { name: /^Meer/ }));
  expect(screen.getByRole("button", { name: /^Meer/ }).getAttribute("aria-expanded")).toBe("false");
  save();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^Meer/ }).getAttribute("aria-expanded")).toBe(
      "true",
    ),
  );
  expect(api.count("POST /api/trips/t1/travel-updates")).toBe(0);
});
