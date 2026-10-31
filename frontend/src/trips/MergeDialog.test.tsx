// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { changeLocale } from "../locale";
import { fakeApi, type FakeApi } from "../query/fake-api";
import { chooseOption, renderWithOwner, selectedOption, testToken } from "../query/test-utils";
import { answerConfirmation } from "../test-confirm";
import type { Area, Location, Trip } from "../tracker-model";
import { AreaManager } from "./AreaManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = {
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [],
};
const area = (id: string, label: string): Area => ({
  id,
  label,
  visibility: "private",
  country_code: "TW",
  region: null,
  latitude: null,
  longitude: null,
  timezone: null,
});
const taoyuan = area("taoyuan", "Taoyuan");
const taipei = area("taipei", "Taipei");
const airport = (id: string, areaId: string) =>
  ({
    id,
    area_id: areaId,
    label: null,
    visibility: "private",
    share_address: false,
    display_name: "Taoyuan Airport",
    locality: "Taoyuan",
    country_code: "TW",
  }) as Location;
const preview = {
  keep_id: "air-1",
  applied: false,
  duplicates: [
    {
      id: "air-2",
      label: null,
      display_name: "Taoyuan Airport",
      area_id: "taipei",
      visits: 2,
      stays: 0,
      routes: 1,
      travel_updates: 3,
      narrowed_audiences: ["public page", "link 'Familie'"],
      widened: [],
    },
  ],
  // The server's English prose is never shown.
  warnings: ["SERVER PROSE reaches public page"],
};

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi()
    .collection("/api/trips/trip/areas", [taoyuan, taipei])
    .collection("/api/trips/trip/locations", [
      airport("air-1", "taoyuan"),
      airport("air-2", "taipei"),
    ])
    .collection("/api/trips/trip/stays", [])
    .collection("/api/trips/trip/routes", [])
    .collection("/api/trips/trip/visits", [])
    .value("/api/trips/trip/public-projection", {
      trip_id: "trip",
      surface_state: "unpublished",
      scope: { items: [] },
      slug: null,
    })
    .value("/api/trips/trip/share-links", []);
  api.on("POST", /\/locations\/merge$/, (body) => {
    const { confirm, duplicate_ids } = body as { confirm: boolean; duplicate_ids: string[] };
    if (confirm) {
      const rows = api.rows("/api/trips/trip/locations");
      rows.splice(0, rows.length, ...rows.filter((row) => !duplicate_ids.includes(row.id)));
    }
    return { ...preview, applied: confirm };
  });
});
afterEach(() => {
  cleanup();
  act(() => changeLocale("nl"));
  vi.unstubAllGlobals();
  expect(api.unexpected).toEqual([]);
});

const MERGE = "POST /api/trips/trip/locations/merge";
const confirmed = () => api.requests.filter((request) => request === MERGE).length;

async function openSuggestion() {
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Samenvoegen bekijken: Taoyuan Airport/ }),
  );
  return await screen.findByRole("dialog", { name: "Locaties samenvoegen" });
}

it("suggests likely duplicates without acting on them", async () => {
  renderWithOwner(<AreaManager trip={trip} />);
  const suggestion = await screen.findByRole("button", {
    name: /Samenvoegen bekijken: Taoyuan Airport/,
  });
  expect(screen.getByText("Mogelijk dubbele locaties")).toBeTruthy();
  expect(screen.getByText(/dezelfde naam/)).toBeTruthy();
  expect(screen.queryByText("Mogelijk dubbele gebieden")).toBeNull();
  expect(api.requests.filter((request) => request.startsWith("POST"))).toEqual([]);
  // Reviewing a suggestion opens the merge dialog on top of the kept location.
  fireEvent.click(suggestion);
  expect(await screen.findByRole("dialog", { name: "Locaties samenvoegen" })).toBeTruthy();
});

it("previews in Dutch, then merges only after an explicit confirmation", async () => {
  const dialog = await openSuggestion();
  expect(selectedOption("Locatie die je bewaart")).toContain("Taoyuan Airport");
  // Reviewing a suggestion selects its duplicates; the owner still sees the preview before anything merges.
  expect(within(dialog).getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
  expect(within(dialog).getByText(/Waarschijnlijk dubbel: dezelfde naam/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorbeeld bekijken" }));

  expect(await within(dialog).findByText("Dit gebeurt er bij het samenvoegen")).toBeTruthy();
  expect(api.lastBody(MERGE)).toEqual({
    keep_id: "air-1",
    duplicate_ids: ["air-2"],
    confirm: false,
  });
  expect(within(dialog).getByText("Bezoeken die verhuizen: 2")).toBeTruthy();
  expect(within(dialog).getByText("Routes die verhuizen: 1")).toBeTruthy();
  expect(within(dialog).getByText("Reisupdates die verhuizen: 3")).toBeTruthy();
  expect(
    within(dialog).getByText(
      /bereikt nu publieke pagina, deellink “Familie”, maar de bewaarde locatie niet/,
    ),
  ).toBeTruthy();
  expect(
    within(dialog).getByText(/verhuizen naar het gebied van de bewaarde locatie: Taoyuan/),
  ).toBeTruthy();
  expect(within(dialog).getByText(/kan niet ongedaan worden gemaakt/)).toBeTruthy();
  expect(document.body.textContent).not.toContain("SERVER PROSE");

  fireEvent.click(within(dialog).getByRole("button", { name: "Samenvoegen" }));
  // Nothing is applied before the second, explicit confirmation.
  expect(api.count(MERGE)).toBe(1);
  await answerConfirmation("Definitief samenvoegen");
  await waitFor(() => expect(api.count(MERGE)).toBe(2));
  expect(api.lastBody(MERGE)).toEqual({
    keep_id: "air-1",
    duplicate_ids: ["air-2"],
    confirm: true,
  });

  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Locaties samenvoegen" })).toBeNull(),
  );
  expect(await screen.findByText("1 locatie samengevoegd.")).toBeTruthy();
  expect(api.rows("/api/trips/trip/locations").map((row) => row.id)).toEqual(["air-1"]);
});

it("shows the preview in English when the locale changes", async () => {
  const dialog = await openSuggestion();
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorbeeld bekijken" }));
  await within(dialog).findByText("Dit gebeurt er bij het samenvoegen");
  act(() => changeLocale("en"));
  expect(within(dialog).getByText("What the merge does")).toBeTruthy();
  expect(
    within(dialog).getByText(
      /currently reaches public page, share link “Familie”, but the kept location does not/,
    ),
  ).toBeTruthy();
});

it("changes nothing when the owner cancels, at the preview or at the confirmation", async () => {
  const dialog = await openSuggestion();
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorbeeld bekijken" }));
  await within(dialog).findByText("Dit gebeurt er bij het samenvoegen");

  fireEvent.click(within(dialog).getByRole("button", { name: "Samenvoegen" }));
  const prompt = await screen.findByRole("alertdialog");
  fireEvent.click(within(prompt).getByRole("button", { name: "Annuleren" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(within(dialog).getByText("Dit gebeurt er bij het samenvoegen")).toBeTruthy();

  fireEvent.click(within(dialog).getByRole("button", { name: "Terug" }));
  expect(within(dialog).getByRole("button", { name: "Voorbeeld bekijken" })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Locaties samenvoegen" })).toBeNull(),
  );

  expect(api.requests.filter((request) => request === MERGE)).toHaveLength(1);
  expect(api.lastBody(MERGE)).toMatchObject({ confirm: false });
  expect(api.rows("/api/trips/trip/locations")).toHaveLength(2);
});

it("closes on Escape and returns focus to the control that opened it", async () => {
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click((await screen.findAllByRole("button", { name: /^Taoyuan Airport/ }))[0]);
  const opener = await screen.findByRole("button", { name: "Samenvoegen met andere locaties" });
  opener.focus();
  fireEvent.click(opener);
  await screen.findByRole("dialog", { name: "Locaties samenvoegen" });
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Locaties samenvoegen" })).toBeNull(),
  );
  expect(screen.getByRole("dialog", { name: "Locatie" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it("lets the owner choose what to keep and what to merge", async () => {
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click((await screen.findAllByRole("button", { name: /^Taoyuan Airport/ }))[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Samenvoegen met andere locaties" }));
  const dialog = await screen.findByRole("dialog", { name: "Locaties samenvoegen" });
  expect(
    within(dialog).getByRole("button", { name: "Voorbeeld bekijken" }).hasAttribute("disabled"),
  ).toBe(true);
  chooseOption("Locatie die je bewaart", /Taipei/);
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorbeeld bekijken" }));
  await within(dialog).findByText("Dit gebeurt er bij het samenvoegen");
  expect(api.lastBody(MERGE)).toEqual({
    keep_id: "air-2",
    duplicate_ids: ["air-1"],
    confirm: false,
  });
});

it("shows a failed preview inside the dialog and keeps the choice", async () => {
  const dialog = await openSuggestion();
  api.failNext = { status: 500, body: { detail: "boom", errors: [] } };
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorbeeld bekijken" }));
  const failure = await within(dialog).findByText(
    /Het voorbeeld van het samenvoegen kon niet worden geladen/,
  );
  expect(failure.getAttribute("role")).toBe("alert");
  expect(within(dialog).getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
  expect(document.body.textContent).not.toContain("boom");
});

it("shows a failed merge inside the dialog, keeps the preview and changes nothing", async () => {
  const dialog = await openSuggestion();
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorbeeld bekijken" }));
  await within(dialog).findByText("Dit gebeurt er bij het samenvoegen");
  api.failNext = { status: 500, body: { detail: "boom", errors: [] } };
  fireEvent.click(within(dialog).getByRole("button", { name: "Samenvoegen" }));
  await answerConfirmation("Definitief samenvoegen");
  const failure = await within(dialog).findByText(/De locaties konden niet worden samengevoegd/);
  expect(failure.getAttribute("role")).toBe("alert");
  expect(within(dialog).getByText("Dit gebeurt er bij het samenvoegen")).toBeTruthy();
  expect(api.rows("/api/trips/trip/locations")).toHaveLength(2);
  expect(confirmed()).toBe(2);
});

it("offers the merge from a refused delete", async () => {
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click((await screen.findAllByRole("button", { name: /^Taoyuan Airport/ }))[0]);
  api.failNext = {
    status: 409,
    body: {
      detail: "in use",
      errors: [{ code: "resource_in_use", path: [], params: { count: 2, visits: 2 } }],
    },
  };
  fireEvent.click(await screen.findByRole("button", { name: "Verwijderen" }));
  await answerConfirmation();
  expect(await screen.findByText(/wordt nog gebruikt door 2 onderdelen/)).toBeTruthy();
  expect(screen.getByText(/Voeg deze locatie liever samen met een andere/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Samenvoegen met andere locaties" }));
  expect(await screen.findByRole("dialog", { name: "Locaties samenvoegen" })).toBeTruthy();
});

it("merges duplicate areas and points at the city-level locations that follow", async () => {
  api.on("POST", /\/areas\/merge$/, (body) => ({
    keep_id: "taoyuan",
    applied: (body as { confirm: boolean }).confirm,
    duplicates: [
      {
        id: "taipei",
        label: "Taipei",
        locations: 1,
        visits: 4,
        routes: 0,
        travel_updates: 0,
        narrowed_audiences: ["link 'Familie'"],
        widened: [],
      },
    ],
    city_level_location_ids: ["air-1", "air-2"],
    warnings: ["SERVER PROSE"],
  }));
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied Taoyuan bekijken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Samenvoegen met andere gebieden" }));
  const dialog = await screen.findByRole("dialog", { name: "Gebieden samenvoegen" });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorbeeld bekijken" }));
  expect(await within(dialog).findByText("Locaties die verhuizen: 1")).toBeTruthy();
  expect(api.lastBody("POST /api/trips/trip/areas/merge")).toEqual({
    keep_id: "taoyuan",
    duplicate_ids: ["taipei"],
    confirm: false,
  });
  expect(
    within(dialog).getByText(/Taipei bereikt nu deellink “Familie”, maar het bewaarde gebied niet/),
  ).toBeTruthy();
  expect(
    within(dialog).getByText(/2 locaties in het samengevoegde gebied noemen alleen de stad/),
  ).toBeTruthy();
  expect(document.body.textContent).not.toContain("SERVER PROSE");

  fireEvent.click(within(dialog).getByRole("button", { name: "Samenvoegen" }));
  await answerConfirmation("Definitief samenvoegen");
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/areas/merge")).toMatchObject({ confirm: true }),
  );
  expect(await screen.findByText("1 gebied samengevoegd.")).toBeTruthy();
});

const widening = [
  { audience: "public", label: null, stays: 1, visits: 2, routes: 0, travel_updates: 0 },
  { audience: "link:abc", label: "Familie", stays: 0, visits: 0, routes: 1, travel_updates: 1 },
];
const withWidening = (duplicate: object) => ({
  ...preview,
  duplicates: [{ ...preview.duplicates[0], narrowed_audiences: [], ...duplicate }],
});

async function previewWidening() {
  const dialog = await openSuggestion();
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorbeeld bekijken" }));
  await within(dialog).findByText("Dit gebeurt er bij het samenvoegen");
  return dialog;
}

it("lists who sees more and keeps Merge disabled until that is acknowledged", async () => {
  api.on("POST", /\/locations\/merge$/, (body) => ({
    ...withWidening({ widened: widening }),
    applied: (body as { confirm: boolean }).confirm,
  }));
  const dialog = await previewWidening();
  const region = within(dialog).getByRole("region", { name: "Bezoekers die meer te zien krijgen" });
  expect(within(region).getByText(/publieke naam en het exacte punt/)).toBeTruthy();
  expect(within(region).getByText("publieke pagina: 1 verblijf, 2 bezoeken")).toBeTruthy();
  expect(within(region).getByText("deellink “Familie”: 1 route, 1 reisupdate")).toBeTruthy();
  expect(within(dialog).queryByText(/Geen waarschuwingen/)).toBeNull();

  const merge = within(dialog).getByRole("button", { name: "Samenvoegen" });
  expect(merge.hasAttribute("disabled")).toBe(true);
  const accept = within(region).getByRole("checkbox", {
    name: "Ik begrijp dat deze bezoekers na het samenvoegen meer zien",
  });
  fireEvent.click(accept);
  await waitFor(() => expect(merge.hasAttribute("disabled")).toBe(false));
  fireEvent.click(merge);
  await answerConfirmation("Definitief samenvoegen");
  await waitFor(() => expect(api.count(MERGE)).toBe(2));
  expect(api.lastBody(MERGE)).toEqual({
    keep_id: "air-1",
    duplicate_ids: ["air-2"],
    confirm: true,
    confirm_widening: true,
  });
  expect(await screen.findByText("1 locatie samengevoegd.")).toBeTruthy();
});

it("names the audiences in English and asks again after going back", async () => {
  api.on("POST", /\/locations\/merge$/, () => withWidening({ widened: widening }));
  act(() => changeLocale("en"));
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Review merge: Taoyuan Airport|Samenvoegen bekijken/,
    }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Merge locations" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Preview merge" }));
  const region = await within(dialog).findByRole("region", { name: "Visitors who will see more" });
  expect(within(region).getByText("public page: 1 stay, 2 visits")).toBeTruthy();
  fireEvent.click(within(region).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Preview merge" }));
  const again = await within(dialog).findByRole("region", { name: "Visitors who will see more" });
  expect(within(again).getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
});

it("shows what a stale preview missed when the server refuses an unacknowledged merge", async () => {
  let widens = false;
  api.on("POST", /\/locations\/merge$/, () => withWidening({ widened: widens ? widening : [] }));
  const dialog = await previewWidening();
  widens = true;
  api.failNext = {
    status: 409,
    body: {
      detail: { code: "merge_widening_needs_acknowledgement", duplicates: [] },
      errors: [{ code: "merge_widening_needs_acknowledgement", params: {}, path: [] }],
    },
  };
  fireEvent.click(within(dialog).getByRole("button", { name: "Samenvoegen" }));
  await answerConfirmation("Definitief samenvoegen");
  // The refusal turns into a fresh preview that lists the audiences, rather than a bare failure.
  const region = await within(dialog).findByRole("region", {
    name: "Bezoekers die meer te zien krijgen",
  });
  expect(region).toBeTruthy();
  expect(within(dialog).queryByRole("alert")).toBeNull();
  expect(within(dialog).getByRole("button", { name: "Samenvoegen" }).hasAttribute("disabled")).toBe(
    true,
  );
  expect(api.rows("/api/trips/trip/locations")).toHaveLength(2);
});

it("explains the area point an area merge newly shows", async () => {
  api.on("POST", /\/areas\/merge$/, (body) => ({
    keep_id: "taoyuan",
    applied: (body as { confirm: boolean }).confirm,
    duplicates: [
      {
        id: "taipei",
        label: "Taipei",
        locations: 0,
        visits: 1,
        routes: 0,
        travel_updates: 0,
        narrowed_audiences: [],
        widened: [widening[0]],
      },
    ],
    city_level_location_ids: [],
    warnings: [],
  }));
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied Taoyuan bekijken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Samenvoegen met andere gebieden" }));
  const dialog = await screen.findByRole("dialog", { name: "Gebieden samenvoegen" });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorbeeld bekijken" }));
  const region = await within(dialog).findByRole("region", {
    name: "Bezoekers die meer te zien krijgen",
  });
  expect(within(region).getByText(/afgeronde kaartpunt van het bewaarde gebied/)).toBeTruthy();
  fireEvent.click(within(region).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Samenvoegen" }));
  await answerConfirmation("Definitief samenvoegen");
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/areas/merge")).toMatchObject({
      confirm: true,
      confirm_widening: true,
    }),
  );
});

const record = (kind: string, id: string, extra: object = {}) => ({
  kind,
  id,
  label: null,
  starts_on: "2054-11-01",
  visibility: "everyone",
  widened_for: [{ audience: "public", label: null }],
  hides_from: [],
  custom_picks: 0,
  make_private: false,
  ...extra,
});
const records = [
  record("stay", "stay-1", {
    label: "Hotel Zuid",
    hides_from: [{ audience: "link:abc", label: "Familie" }],
  }),
  record("stay", "stay-2", { starts_on: "2054-11-05", visibility: "custom", custom_picks: 2 }),
  record("visit", "visit-1", { label: "Wandeling", starts_on: null }),
];
const choiceWidened = [
  { audience: "public", label: null, stays: 2, visits: 1, routes: 0, travel_updates: 0 },
];
const withRecords = (list: object[], widened: object[] = choiceWidened) =>
  withWidening({ widened, widened_records: list });

function previewRecords(list: object[] = records) {
  api.on("POST", /\/locations\/merge$/, (body) => ({
    ...withRecords(list),
    applied: (body as { confirm: boolean }).confirm,
  }));
  return previewWidening();
}

it("lists each newly shown record by kind and sends nothing hidden unless it is ticked", async () => {
  const dialog = await previewRecords();
  const region = within(dialog).getByRole("region", { name: "Bezoekers die meer te zien krijgen" });
  const stays = within(region).getByRole("group", { name: "Eerst privé maken: 2 verblijven" });
  const visits = within(region).getByRole("group", { name: "Eerst privé maken: 1 bezoek" });
  expect(within(stays).getAllByRole("checkbox")).toHaveLength(2);
  expect(within(visits).getAllByRole("checkbox")).toHaveLength(1);
  // Hiding is never preselected, and each row says what it would also cost.
  for (const box of within(region).getAllByRole("checkbox").slice(0, 3)) {
    expect(box.getAttribute("aria-checked")).toBe("false");
  }
  expect(within(stays).getAllByText(/Nieuw zichtbaar voor publieke pagina\./)).toHaveLength(2);
  expect(within(stays).getByText(/verbergt het ook voor deellink “Familie”/)).toBeTruthy();
  expect(within(stays).getByText(/voorgoed uit 2 aangepaste deelselecties/)).toBeTruthy();
  expect(
    within(stays).getByRole("checkbox", { name: "Maak Hotel Zuid · 1 nov 2054 eerst privé" }),
  ).toBeTruthy();
  expect(
    within(stays).getByRole("checkbox", { name: "Maak Verblijf · 5 nov 2054 eerst privé" }),
  ).toBeTruthy();
  expect(within(visits).getByRole("checkbox", { name: "Maak Wandeling eerst privé" })).toBeTruthy();

  fireEvent.click(within(region).getByRole("checkbox", { name: /Ik begrijp/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Samenvoegen" }));
  await answerConfirmation("Definitief samenvoegen");
  await waitFor(() => expect(api.count(MERGE)).toBe(2));
  expect(api.lastBody(MERGE)).toEqual({
    keep_id: "air-1",
    duplicate_ids: ["air-2"],
    confirm: true,
    confirm_widening: true,
  });
});

it("makes only the ticked records private and still asks about the rest", async () => {
  const dialog = await previewRecords();
  const region = within(dialog).getByRole("region", { name: "Bezoekers die meer te zien krijgen" });
  expect(within(region).getByText("publieke pagina: 2 verblijven, 1 bezoek")).toBeTruthy();
  fireEvent.click(within(region).getByRole("checkbox", { name: /Ik begrijp/ }));
  fireEvent.click(within(region).getByRole("checkbox", { name: "Maak Wandeling eerst privé" }));
  // The choice changes what is left, so the earlier acknowledgement no longer counts.
  expect(within(region).getByText("publieke pagina: 2 verblijven")).toBeTruthy();
  const merge = within(dialog).getByRole("button", { name: "Samenvoegen" });
  expect(merge.hasAttribute("disabled")).toBe(true);
  fireEvent.click(within(region).getByRole("checkbox", { name: /Ik begrijp/ }));
  await waitFor(() => expect(merge.hasAttribute("disabled")).toBe(false));
  fireEvent.click(merge);

  const prompt = await screen.findByRole("alertdialog");
  expect(within(prompt).getByText(/1 record wordt eerst privé gemaakt/)).toBeTruthy();
  expect(prompt.textContent).not.toContain("deelselectie");
  fireEvent.click(within(prompt).getByRole("button", { name: "Definitief samenvoegen" }));
  await waitFor(() => expect(api.count(MERGE)).toBe(2));
  expect(api.lastBody(MERGE)).toEqual({
    keep_id: "air-1",
    duplicate_ids: ["air-2"],
    confirm: true,
    make_private: [{ kind: "visit", id: "visit-1" }],
    confirm_widening: true,
  });
});

it("needs no acknowledgement once every newly shown record is made private, and says what that costs", async () => {
  const dialog = await previewRecords();
  const region = within(dialog).getByRole("region", { name: "Bezoekers die meer te zien krijgen" });
  for (const box of within(region).getAllByRole("checkbox").slice(0, 3)) fireEvent.click(box);
  expect(within(region).queryByRole("checkbox", { name: /Ik begrijp/ })).toBeNull();
  expect(
    within(region).getByText(/Elk record dat meer zou tonen, wordt eerst privé gemaakt/),
  ).toBeTruthy();
  const merge = within(dialog).getByRole("button", { name: "Samenvoegen" });
  expect(merge.hasAttribute("disabled")).toBe(false);
  fireEvent.click(merge);

  const prompt = await screen.findByRole("alertdialog");
  expect(within(prompt).getByText(/3 records worden eerst privé gemaakt/)).toBeTruthy();
  expect(
    within(prompt).getByText(/2 aangepaste deelselecties worden voorgoed verwijderd/),
  ).toBeTruthy();
  fireEvent.click(within(prompt).getByRole("button", { name: "Definitief samenvoegen" }));
  await waitFor(() => expect(api.count(MERGE)).toBe(2));
  expect(api.lastBody(MERGE)).toEqual({
    keep_id: "air-1",
    duplicate_ids: ["air-2"],
    confirm: true,
    make_private: [
      { kind: "stay", id: "stay-1" },
      { kind: "stay", id: "stay-2" },
      { kind: "visit", id: "visit-1" },
    ],
  });
});

it("refreshes the preview and drops a choice the server no longer offers", async () => {
  let list = records;
  api.on("POST", /\/locations\/merge$/, () => withRecords(list));
  const dialog = await previewWidening();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Maak Wandeling eerst privé" }));
  list = records.slice(0, 2);
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /Ik begrijp/ }));
  api.failNext = {
    status: 409,
    body: {
      detail: {
        code: "merge_private_choice_is_stale",
        records: [{ kind: "visit", id: "visit-1" }],
      },
      errors: [{ code: "merge_private_choice_is_stale", params: {}, path: [] }],
    },
  };
  fireEvent.click(within(dialog).getByRole("button", { name: "Samenvoegen" }));
  await answerConfirmation("Definitief samenvoegen");

  expect(
    await within(dialog).findByText(/Het delen is veranderd sinds het voorbeeld/),
  ).toBeTruthy();
  expect(within(dialog).queryByRole("checkbox", { name: "Maak Wandeling eerst privé" })).toBeNull();
  expect(within(dialog).getByRole("button", { name: "Samenvoegen" }).hasAttribute("disabled")).toBe(
    true,
  );
  expect(api.rows("/api/trips/trip/locations")).toHaveLength(2);
});

it("keeps a long list usable: grouped, every row reachable by keyboard, in English", async () => {
  const many = Array.from({ length: 60 }, (_, index) => record("stay", `stay-${index}`));
  act(() => changeLocale("en"));
  api.on("POST", /\/locations\/merge$/, () =>
    withRecords(many, [{ ...choiceWidened[0], stays: 60, visits: 0 }]),
  );
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Review merge: Taoyuan Airport/ }));
  const dialog = await screen.findByRole("dialog", { name: "Merge locations" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Preview merge" }));
  const group = await within(dialog).findByRole("group", { name: "Make private first: 60 stays" });
  const boxes = within(group).getAllByRole("checkbox");
  expect(boxes).toHaveLength(60);
  expect(boxes.every((box) => box.getAttribute("tabindex") !== "-1")).toBe(true);
  expect(
    within(group).getAllByRole("checkbox", { name: "Make Stay · 1 Nov 2054 private first" }),
  ).toBeTruthy();
  expect(within(dialog).getAllByRole("group")).toHaveLength(1);
});

it("offers the same per-record choice when merging areas", async () => {
  api.on("POST", /\/areas\/merge$/, (body) => ({
    keep_id: "taoyuan",
    applied: (body as { confirm: boolean }).confirm,
    duplicates: [
      {
        id: "taipei",
        label: "Taipei",
        locations: 0,
        visits: 1,
        routes: 1,
        travel_updates: 0,
        narrowed_audiences: [],
        widened: [{ ...choiceWidened[0], stays: 0, visits: 1, routes: 1 }],
        widened_records: [
          record("visit", "visit-1", { label: "Wandeling" }),
          record("route", "route-1", { label: "Trein" }),
        ],
      },
    ],
    city_level_location_ids: [],
    warnings: [],
  }));
  renderWithOwner(<AreaManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Gebied Taoyuan bekijken" }));
  fireEvent.click(await screen.findByRole("button", { name: "Samenvoegen met andere gebieden" }));
  const dialog = await screen.findByRole("dialog", { name: "Gebieden samenvoegen" });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorbeeld bekijken" }));
  const region = await within(dialog).findByRole("region", {
    name: "Bezoekers die meer te zien krijgen",
  });
  fireEvent.click(
    within(region).getByRole("checkbox", { name: "Maak Trein · 1 nov 2054 eerst privé" }),
  );
  expect(within(region).getByText("publieke pagina: 1 bezoek")).toBeTruthy();
  fireEvent.click(within(region).getByRole("checkbox", { name: /Ik begrijp/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Samenvoegen" }));
  await answerConfirmation("Definitief samenvoegen");
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/areas/merge")).toMatchObject({
      confirm: true,
      confirm_widening: true,
      make_private: [{ kind: "route", id: "route-1" }],
    }),
  );
});
