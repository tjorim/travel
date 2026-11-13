// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { ownerKeys } from "../query/keys";
import { chooseOption, renderWithOwner, selectedOption, testToken } from "../query/test-utils";
import { answerConfirmation } from "../test-confirm";
import type {
  OverviewAudience,
  PublicProjectionStatus,
  ShareLink,
  ShareScope,
  Trip,
  TripOverview,
} from "../api-types";
import type { ProjectionDocument } from "../api-types";
import { PublicationManager } from "./PublicationManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));
vi.mock("./RenderedPreview", () => ({ RenderedPreview: () => <p>Weergegeven preview</p> }));

const scope = (items: ShareScope["items"] = []): ShareScope => ({
  schema_version: "travel/share-scope@1",
  trip: { title: true, summary: true, dates: null },
  items,
});
const trip: Trip = {
  owner_subject: "owner-1",
  cover_derivative_id: null,
  cover_url: null,
  summary_html: null,
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [
    {
      area: null,
      body_html: null,
      private_notes_html: null,
      id: "u1",
      occurred_at: "2054-11-16T10:00:00Z",
      timezone: "UTC",
      local_date: "2054-11-16",
      share_date_precision: "day",
      title: "Privé dagboek",
      body: "Geheim",
      private_notes: null,
      area_id: null,
      location: null,
      media_asset_ids: [],
      visibility: "private",
    },
    {
      area: null,
      body_html: null,
      private_notes_html: null,
      id: "u2",
      occurred_at: "2054-11-16T10:00:00Z",
      timezone: "UTC",
      local_date: "2054-11-16",
      share_date_precision: "day",
      title: "Aankomst",
      body: "Geland",
      private_notes: null,
      area_id: null,
      location: null,
      media_asset_ids: [],
      visibility: "everyone",
    },
    {
      area: null,
      body_html: null,
      private_notes_html: null,
      id: "u3",
      occurred_at: "2054-11-16T10:00:00Z",
      timezone: "UTC",
      local_date: "2054-11-16",
      share_date_precision: "day",
      title: "Stad ↔ natuur",
      body: "Bos",
      private_notes: null,
      area_id: null,
      location: null,
      media_asset_ids: [],
      visibility: "custom",
    },
  ],
};
const link = (id: string, label: string, state: ShareLink["state"] = "draft"): ShareLink =>
  ({
    revision: 1,
    id,
    series_id: id,
    label,
    state,
    token: null,
    expires_at: null,
    scope: scope(),
  }) as ShareLink;

let api: FakeApi;
let status: PublicProjectionStatus;
let overview: TripOverview;
const audience = (overrides: Partial<OverviewAudience> = {}): OverviewAudience => ({
  kind: "public",
  id: null,
  label: "public",
  state: "unpublished",
  live: false,
  shares_title: true,
  shares_summary: true,
  dates_precision: null,
  date_precision: null,
  record_precision: {},
  scope_items: 0,
  delivered: { visits: 0, places: 0, stays: 0, routes: 0, updates: 0, media: 0 },
  without_map_point: { visits: 0, stays: 0, updates: 0 },
  shows_cover: false,
  numbers: {},
  excluded: 0,
  excluded_also_hides: {},
  preset: null,
  preset_exceptions: 0,
  ...overrides,
});
const SECRET = "secret-token-123";

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  status = {
    revision: 1,
    trip_id: "trip",
    slug: "exampleland",
    surface_state: "unpublished",
    scope: scope(),
  } as unknown as PublicProjectionStatus;
  overview = {
    title: "Titel",
    starts_on: null,
    ends_on: null,
    trip_id: "trip",
    counts: {},
    visibility: {},
    audiences: [audience()],
    warnings: [],
  };
  api = fakeApi()
    .collection("/api/trips/trip/share-links", [link("l1", "Familie")], {
      create: (body, count) => link(`l${count + 1}`, String(body.label)),
    })
    .collection("/api/trips/trip/areas", [{ id: "b1", label: "Taipei", visibility: "custom" }])
    .collection("/api/trips/trip/locations", [
      {
        id: "e1",
        label: "Warme bron van Beitou",
        display_name: "Beitou Hot Spring, 12 Guangming Road",
        visibility: "custom",
      },
      { id: "e2", label: null, display_name: "Hotel, 1 Main Street", visibility: "private" },
    ])
    .collection("/api/trips/trip/visits", [
      {
        id: "v1",
        title: "Noordkust",
        area: { label: "Taipei" },
        location: null,
        visibility: "custom",
      },
    ])
    .collection("/api/trips/trip/stays", [])
    .collection("/api/trips/trip/routes", [
      {
        id: "leg1",
        mode: "flight",
        label: null,
        departure_area: { label: "Zaventem", country_code: "BE" },
        arrival_area: { label: "Taoyuan", country_code: "TW" },
        visibility: "custom",
      },
    ])
    .collection("/api/trips/trip/media", [{ id: "p1", original_filename: "kust.jpg" }])
    .collection("/api/trips/trip/media/p1/derivatives", [
      {
        id: "x1",
        review_state: "approved",
        purpose: "share",
        visibility: "custom",
        travel_update_id: null,
      },
      {
        id: "x2",
        review_state: "pending",
        purpose: "share",
        visibility: "private",
        travel_update_id: null,
      },
    ])
    .collection("/api/trips/trip/documents", [])
    .collection("/api/trips/trip/travel-updates", trip.travel_updates);
  server.use(http.get("/api/trips/trip/audit-events", () => HttpResponse.json([])));
  api.on("PUT", /\/visibility\/[^/]+\/[^/]+$/, (body) => body);
  api.on("POST", /\/share-scope\/exclusion-review$/, () => ({
    excluded: [],
    also_hidden: {},
    stale: 0,
    baseline: [],
  }));
  api.on("GET", /^\/api\/trips\/trip\/public-projection$/, () => status);
  api.on("GET", /^\/api\/trips\/trip\/overview$/, () => overview);
  // Every preview asks what it shows of the future; a test that expects a line overrides this.
  api.on("POST", /\/future-disclosure$/, () => ({ transport: 0, day_dates: 0 }));
  api.on("PUT", /^\/api\/trips\/trip\/public-projection$/, (body) => {
    status = { ...status, scope: body as ShareScope };
    return status;
  });
  api.on("POST", /^\/api\/trips\/trip\/public-projection\/publish$/, () => {
    status = { ...status, surface_state: "published" };
    return status;
  });
  api.on("POST", /^\/api\/trips\/trip\/public-projection\/unpublish$/, () => {
    status = { ...status, surface_state: "unpublished" };
    return status;
  });
  api.on(
    "POST",
    /\/preview$/,
    () =>
      ({
        title: "Exampleland",
        summary: null,
        dates: null,
        visits: [],
        places: [],
        updates: [],
        stays: [],
        media: [],
        routes: [],
      }) as unknown as ProjectionDocument,
  );
  api.on("POST", /\/share-links\/([^/]+)\/(activate|rotate)$/, (_body, match) => {
    const rows = api.rows("/api/trips/trip/share-links");
    const row = rows.find((item) => item.id === match[1])!;
    row.state = "active";
    row.token = SECRET;
    return row;
  });
  api.on("POST", /\/share-links\/([^/]+)\/revoke$/, (_body, match) => {
    const row = api.rows("/api/trips/trip/share-links").find((item) => item.id === match[1])!;
    row.state = "revoked";
    return row;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(api.unexpected).toEqual([]);
});

const publicScope = () => within(screen.getByRole("group", { name: "Wat iedereen mag zien" }));
/** Opens a disclosure by its button unless it is open already. */
async function openDisclosure(scope: ReturnType<typeof within>, title: string) {
  const trigger = await scope.findByRole("button", { name: new RegExp(`^${title}`) });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  return trigger;
}
async function openPublicGroup(title: string) {
  // Records chosen for one audience sit under Advanced, then in one section per kind.
  await openDisclosure(publicScope(), "Geavanceerd");
  const trigger = await publicScope().findByRole("button", { name: new RegExp(`^${title}`) });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  return within(trigger.closest("[data-disclosure]")!);
}

it("offers private and custom records, but not everyone's or unreviewed copies, for an audience to choose", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  await publicScope().findByText("Stad ↔ natuur");
  await waitFor(() => expect(publicScope().getByText("kust.jpg")).toBeTruthy());
  // A still-private record can be chosen directly; the pending copy, the everyone update and the unnamed private location cannot.
  expect(publicScope().getAllByText("Goedgekeurde foto")).toHaveLength(1);
  expect(publicScope().getByText("Privé dagboek")).toBeTruthy();
  expect(publicScope().queryByText("Aankomst")).toBeNull();
  expect(publicScope().queryByText(/Hotel, 1 Main/)).toBeNull();
  // A named location is offered under its public name, never its display name.
  expect(publicScope().getByText("Warme bron van Beitou")).toBeTruthy();
  expect(screen.queryByText(/12 Guangming Road/)).toBeNull();
});

it("says what reaches every audience anyway and offers no field checklist", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const scopeEditor = publicScope();
  await scopeEditor.findByText("Reisupdates");
  expect(
    scopeEditor.getByText(
      /1 voor iedereen verschijnt hier altijd; 1 privé kun je onder Geavanceerd aanvinken/,
    ),
  ).toBeTruthy();
  await openPublicGroup("Reisupdates");
  fireEvent.click(scopeEditor.getByRole("checkbox", { name: /Stad ↔ natuur/ }));
  expect(scopeEditor.queryByLabelText("title")).toBeNull();
  expect(scopeEditor.queryByLabelText("body")).toBeNull();
});

it('checking a still-private record for an audience promotes it to "Zelf kiezen" before including it', async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  await openPublicGroup("Reisupdates");
  const checkbox = await publicScope().findByRole("checkbox", { name: /Privé dagboek/ });
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(checkbox);
  await waitFor(() =>
    expect(api.lastBody("PUT /api/trips/trip/visibility/travel_update/u1")).toEqual({
      visibility: "custom",
    }),
  );
  await waitFor(() =>
    expect(
      publicScope()
        .getByRole("checkbox", { name: /Privé dagboek/ })
        .getAttribute("aria-checked"),
    ).toBe("true"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Keuze bewaren" }));
  await screen.findByText("Keuze bewaard. Niet-geselecteerde inhoud blijft privé.");
  expect(api.lastBody<ShareScope>("PUT /api/trips/trip/public-projection")!.items).toEqual(
    expect.arrayContaining([{ kind: "travel_update", id: "u1" }]),
  );
});

it("sets who sees a record from Delen with the same control as its own editor", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const visibility = within(screen.getByRole("region", { name: "Delen" }));
  fireEvent.click(await visibility.findByRole("button", { name: /^Reisupdates.*staat op/ }));
  await screen.findByLabelText("Zichtbaarheid van Aankomst");
  expect(selectedOption("Zichtbaarheid van Aankomst")).toBe("Iedereen — alle bezoekers");
  chooseOption("Zichtbaarheid van Aankomst", "Privé — alleen ik");
  await waitFor(() =>
    expect(api.lastBody("PUT /api/trips/trip/visibility/travel_update/u2")).toEqual({
      visibility: "private",
    }),
  );
});

it("offers a redacted route summary, without the owner-only booking fields", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const transport = await openPublicGroup("Routes");
  expect(transport.getByText("Vlucht: Zaventem → Taoyuan")).toBeTruthy();
  expect(
    transport.getByText(/de planning.*nooit boekingscode, reisklasse, notities of documenten/i),
  ).toBeTruthy();
  fireEvent.click(transport.getByRole("button", { name: "Alles kiezen" }));
  fireEvent.click(screen.getByRole("button", { name: "Keuze bewaren" }));
  await screen.findByText("Keuze bewaard. Niet-geselecteerde inhoud blijft privé.");
  // No fields to pick: the scope names the record only.
  expect(api.lastBody<ShareScope>("PUT /api/trips/trip/public-projection")!.items).toEqual([
    { kind: "route", id: "leg1" },
  ]);
});

it("groups records into collapsed sections with a count, and chooses or clears a whole section", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const group = async (title: string) =>
    within(
      (await publicScope().findByRole("button", { name: new RegExp(`^${title}`) })).closest(
        "[data-disclosure]",
      )!,
    );
  const updates = await openPublicGroup("Reisupdates");
  // The group lists the still-private update alongside the already-custom one; the everyone update stays out.
  expect(updates.getByText("0 van 2 gekozen")).toBeTruthy();
  expect(
    (updates.getByRole("button", { name: "Niets kiezen" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(updates.getByRole("button", { name: "Alles kiezen" }));
  await waitFor(() => expect(updates.getByText("2 van 2 gekozen")).toBeTruthy());
  expect(
    updates.getByRole("checkbox", { name: /Stad ↔ natuur/ }).getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    updates.getByRole("checkbox", { name: /Privé dagboek/ }).getAttribute("aria-checked"),
  ).toBe("true");
  expect(api.lastBody("PUT /api/trips/trip/visibility/travel_update/u1")).toEqual({
    visibility: "custom",
  });
  fireEvent.click(updates.getByRole("button", { name: "Niets kiezen" }));
  expect(updates.getByText("0 van 2 gekozen")).toBeTruthy();
  // The other sections are untouched.
  expect((await group("Gebieden")).getByText("0 van 1 gekozen")).toBeTruthy();
  expect((await group("Locaties")).getByText("0 van 1 gekozen")).toBeTruthy();
});

it("chooses what it can when one record cannot be shared yet, and says which one was left out", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const updates = await openPublicGroup("Reisupdates");
  api.failNext = {
    status: 422,
    body: {
      detail: "sharing diagnostic",
      errors: [
        { code: "write_the_text_for_visitors_before_sharing_this_update", path: [], params: {} },
      ],
    },
  };
  fireEvent.click(updates.getByRole("button", { name: "Alles kiezen" }));
  await waitFor(() => expect(updates.getByText("1 van 2 gekozen")).toBeTruthy());
  expect(
    await screen.findByText(
      /1 onderdeel is niet gekozen: “.+”\. Schrijf eerst de tekst voor bezoekers voordat je deze reisupdate deelt\./,
    ),
  ).toBeTruthy();
});

it("shows no link editor until a link is started or chosen, and says so when there are no links", async () => {
  api.collection("/api/trips/trip/share-links", []);
  renderWithOwner(<PublicationManager trip={trip} />);
  await screen.findByText(/Nog geen deellinks/);
  expect(screen.queryByLabelText("Naam van de link")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Nieuwe link" }));
  const dialog = screen.getByRole("dialog", { name: "Deellink toevoegen" });
  expect(within(dialog).getByLabelText("Naam van de link")).toBeTruthy();
});

it("groups a rotated URL under its current link instead of listing it as another link", async () => {
  api.collection("/api/trips/trip/share-links", [
    { ...link("l2", "Familie", "active"), series_id: "l1", token: SECRET },
    link("l1", "Familie", "revoked"),
  ]);
  renderWithOwner(<PublicationManager trip={trip} />);
  const history = await screen.findByRole("button", { name: "1 eerdere versie bekijken" });
  const disclosure = history.parentElement!;
  expect(disclosure.parentElement!.querySelectorAll(":scope > button")).toHaveLength(1);
  expect(history.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(history);
  expect(history.getAttribute("aria-expanded")).toBe("true");
});

it("asks before discarding an unsaved link scope when changing editors", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Familie/ }));
  fireEvent.change(screen.getByLabelText("Naam van de link"), {
    target: { value: "Familie en vrienden" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Deellink bewerken sluiten" }));
  expect(await screen.findByText("Wijzigingen verwerpen?")).toBeTruthy();
  expect((screen.getByLabelText("Naam van de link") as HTMLInputElement).value).toBe(
    "Familie en vrienden",
  );
  await answerConfirmation("Wijzigingen verwerpen");
  fireEvent.click(screen.getByRole("button", { name: "Nieuwe link" }));
  await waitFor(() =>
    expect((screen.getByLabelText("Naam van de link") as HTMLInputElement).value).toBe(""),
  );
});

it("saves the chosen public scope and shows the server's copy afterwards", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const checkbox = (await openPublicGroup("Reisupdates")).getByRole("checkbox", {
    name: /Stad ↔ natuur/,
  });
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Keuze bewaren" }));
  await screen.findByText("Keuze bewaard. Niet-geselecteerde inhoud blijft privé.");
  expect(api.lastBody<ShareScope>("PUT /api/trips/trip/public-projection")!.items).toEqual([
    { kind: "travel_update", id: "u3" },
  ]);
  expect(
    publicScope()
      .getByRole("checkbox", { name: /Stad ↔ natuur/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
});

it("keeps unsaved public scope edits when the server copy is refreshed", async () => {
  const { client } = renderWithOwner(<PublicationManager trip={trip} />);
  await openPublicGroup("Reisupdates");
  fireEvent.click(
    await within(await screen.findByRole("group", { name: "Wat iedereen mag zien" })).findByRole(
      "checkbox",
      {
        name: /Stad ↔ natuur/,
      },
    ),
  );
  status = { ...status, scope: { ...scope(), trip: { title: false, summary: true, dates: null } } };
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ownerKeys.tripResource("owner-1", "trip", "public-projection"),
    });
  });
  expect(
    publicScope()
      .getByRole("checkbox", { name: /Stad ↔ natuur/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
});

it("publishes and withdraws the public page", async () => {
  server.use(
    http.get("/api/trips/trip/audit-events", () =>
      HttpResponse.json(
        status.surface_state === "published"
          ? [
              {
                id: "published",
                kind: "public_projection.publish",
                target_type: "public_surface",
                target_id: "trip",
                occurred_at: "2026-10-30T10:00:00Z",
                details: {},
              },
            ]
          : [],
      ),
    ),
  );
  renderWithOwner(<PublicationManager trip={trip} />);
  const publish = await screen.findByRole("button", { name: "Met iedereen delen" });
  await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("link", { name: "Open publieke pagina" })).toBeNull();
  await screen.findByText("Er zijn nog geen deelwijzigingen vastgelegd.");
  fireEvent.click(publish);
  await screen.findByText("Openbare pagina gepubliceerd.");
  const open = await screen.findByRole("link", { name: "Open publieke pagina" });
  expect(open.getAttribute("href")).toBe(`${window.location.origin}/trips/exampleland`);
  expect(screen.getByText(`${window.location.origin}/trips/exampleland`)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Kopieer link" })).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Niet meer met iedereen delen" }));
  await screen.findByText("Publieke pagina ingetrokken.");
  await screen.findByText("Er zijn nog geen deelwijzigingen vastgelegd.");
  expect(screen.getByRole("button", { name: "Met iedereen delen" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Open publieke pagina" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Kopieer link" })).toBeNull();
});

it("previews the unsaved public selection without saving it, keeping the draft", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const editor = await screen.findByRole("group", { name: "Wat iedereen mag zien" });
  fireEvent.click(within(editor).getByRole("checkbox", { name: "Samenvatting" }));
  fireEvent.click(screen.getByRole("button", { name: "Bekijk als bezoeker" }));
  const dialog = await screen.findByRole("dialog", { name: "Publieke preview" });
  expect(within(dialog).getByText("Weergegeven preview")).toBeTruthy();
  expect(within(dialog).getByText(/Dit voorbeeld toont je huidige selectie/)).toBeTruthy();
  expect(api.count("PUT /api/trips/trip/public-projection")).toBe(0);
  expect(api.count("POST /api/trips/trip/public-projection/preview")).toBe(1);
  expect(
    api.lastBody<ShareScope>("POST /api/trips/trip/public-projection/preview")?.trip.summary,
  ).toBe(false);
  // The live scope is untouched and the edit is still pending.
  expect(status.scope.trip.summary).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Publieke preview sluiten" }));
  expect(
    within(screen.getByRole("group", { name: "Wat iedereen mag zien" }))
      .getByRole("checkbox", { name: "Samenvatting" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  expect(screen.getByRole("button", { name: "Keuze bewaren" })).toBeTruthy();
});

it("reports a failed public preview and keeps the unsaved selection", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const editor = await screen.findByRole("group", { name: "Wat iedereen mag zien" });
  fireEvent.click(within(editor).getByRole("checkbox", { name: "Samenvatting" }));
  server.use(
    http.post("/api/trips/trip/public-projection/preview", () =>
      HttpResponse.json({ detail: "x" }, { status: 503 }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Bekijk als bezoeker" }));
  await screen.findByText(/^Voorbeeld laden lukte niet\./);
  expect(screen.queryByRole("dialog", { name: "Publieke preview" })).toBeNull();
  expect(api.count("PUT /api/trips/trip/public-projection")).toBe(0);
  expect(
    within(screen.getByRole("group", { name: "Wat iedereen mag zien" }))
      .getByRole("checkbox", { name: "Samenvatting" })
      .getAttribute("aria-checked"),
  ).toBe("false");
});

it("previews an existing link's unsaved scope without saving it", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Familie/ }));
  const editor = await screen.findByRole("group", { name: "Scope voor verborgen link" });
  fireEvent.click(within(editor).getByRole("checkbox", { name: "Samenvatting" }));
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld bekijken" }));
  await screen.findByRole("dialog", { name: "Preview van Familie" });
  expect(api.count("PATCH /api/trips/trip/share-links/l1")).toBe(0);
  expect(api.count("POST /api/trips/trip/share-links/l1/preview")).toBe(1);
  expect(
    api.lastBody<ShareScope>("POST /api/trips/trip/share-links/l1/preview")?.trip.summary,
  ).toBe(false);
  expect((api.rows("/api/trips/trip/share-links")[0].scope as ShareScope).trip.summary).toBe(true);
});

it("says a new draft link was saved when its first preview fails", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe link" }));
  fireEvent.change(screen.getByLabelText("Naam van de link"), { target: { value: "Vrienden" } });
  server.use(
    http.post("/api/trips/trip/share-links/l2/preview", () =>
      HttpResponse.json({ detail: "x" }, { status: 503 }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld bekijken" }));
  await screen.findByText(
    "Het concept van de link is opgeslagen, maar het voorbeeld kon niet worden geladen.",
  );
  expect(api.count("POST /api/trips/trip/share-links")).toBe(1);
});

it("saves a new link as a draft, letting its owner preview it before activating it explicitly", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe link" }));
  fireEvent.click(screen.getByRole("button", { name: "Concept opslaan" }));
  await screen.findByText("Geef de link een naam.");
  expect(api.count("POST /api/trips/trip/share-links")).toBe(0);

  fireEvent.change(screen.getByLabelText("Naam van de link"), { target: { value: "Vrienden" } });
  fireEvent.click(screen.getByRole("button", { name: "Concept opslaan" }));
  await screen.findByText(
    "Concept opgeslagen. Bekijk het voorbeeld en activeer de link zodra je tevreden bent.",
  );
  // Saving a new link creates it as a draft: no live capability is minted yet.
  expect(api.count("POST /api/trips/trip/share-links")).toBe(1);
  expect(api.count("POST /api/trips/trip/share-links/l2/activate")).toBe(0);
  expect(screen.getByRole("button", { name: /Vrienden/, hidden: true }).textContent).toContain(
    "concept",
  );

  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld bekijken" }));
  const previewDialog = await screen.findByRole("dialog", { name: "Preview van Vrienden" });
  expect(within(previewDialog).getByText("Weergegeven preview")).toBeTruthy();
  expect(api.count("POST /api/trips/trip/share-links/l2/preview")).toBe(1);
  // Previewing still hasn't activated the link.
  expect(api.count("POST /api/trips/trip/share-links/l2/activate")).toBe(0);
  fireEvent.click(
    within(previewDialog).getByRole("button", { name: "Preview van Vrienden sluiten" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Deellink bewerken sluiten" }));

  fireEvent.click(screen.getByRole("button", { name: /Vrienden/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Activeren" }));
  const reveal = await screen.findByRole("dialog", { name: "Deellink" });
  expect(within(reveal).getByText(`${window.location.origin}/share/${SECRET}`)).toBeTruthy();
  expect(
    screen.getByText("De link is actief en kan later opnieuw worden gekopieerd."),
  ).toBeTruthy();
  expect(api.lastBody("POST /api/trips/trip/share-links/l2/activate")).toEqual({
    expires_in_days: 30,
    reason: null,
  });
  expect(screen.getByRole("button", { name: /Vrienden/, hidden: true }).textContent).toContain(
    "actief",
  );

  fireEvent.click(screen.getByRole("button", { name: "Sluiten" }));
  expect(screen.queryByText(`${window.location.origin}/share/${SECRET}`)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Vrienden/ }));
  fireEvent.click(screen.getByRole("button", { name: "Link tonen" }));
  expect((await screen.findByRole("dialog", { name: "Deellink" })).textContent).toContain(
    `${window.location.origin}/share/${SECRET}`,
  );
});

it("revokes an active link and locks its editor", async () => {
  api.rows("/api/trips/trip/share-links")[0].state = "active";
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Familie/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Link intrekken" }));
  expect(api.count("POST /api/trips/trip/share-links/l1/revoke")).toBe(0);
  await answerConfirmation("Link intrekken");
  await screen.findByText("Deellink ingetrokken.");
  expect((screen.getByLabelText("Naam van de link") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Link opslaan" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByRole("button", { name: /Familie/, hidden: true }).textContent).toContain(
    "ingetrokken",
  );
});

it("saves a renamed link and shows the new name in the list", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Familie/ }));
  expect((screen.getByLabelText("Naam van de link") as HTMLInputElement).value).toBe("Familie");
  fireEvent.change(screen.getByLabelText("Naam van de link"), {
    target: { value: "Familie en vrienden" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Link opslaan" }));
  await screen.findByRole("button", { name: /Familie en vrienden/, hidden: true });
  expect(screen.queryByRole("button", { name: /^Familie ·/ })).toBeNull();
});

it("shows what each audience receives and words the review warnings in Dutch", async () => {
  overview = {
    title: "Titel",
    starts_on: null,
    ends_on: null,
    trip_id: "trip",
    counts: {},
    visibility: {},
    audiences: [
      audience({
        state: "published",
        live: true,
        delivered: { visits: 7, places: 0, stays: 0, routes: 2, updates: 1, media: 0 },
        without_map_point: { visits: 7, stays: 0, updates: 1 },
      }),
      audience({ kind: "share_link", id: "l1", label: "Familie", state: "active", live: true }),
    ],
    warnings: [
      {
        count: null,
        code: "trip_dates_shared",
        severity: "info",
        message: "",
        audience: "public",
        audience_id: null,
        text: "month",
        kind: null,
        id: null,
      },
      {
        count: null,
        code: "map_point_withheld",
        severity: "warning",
        message: "",
        audience: "public",
        audience_id: null,
        text: "7 visits, 1 reisupdate",
        kind: null,
        id: null,
      },
      {
        count: null,
        code: "live_audience_receives_nothing",
        severity: "warning",
        message: "",
        audience: "Familie",
        audience_id: "l1",
        text: null,
        kind: null,
        id: null,
      },
      {
        count: null,
        code: "planning_marker_visible",
        severity: "warning",
        message: "",
        audience: "public",
        audience_id: null,
        text: "Chiayi · concept",
        kind: null,
        id: null,
      },
      {
        count: null,
        code: "cover_not_received",
        severity: "info",
        message: "",
        audience: "public",
        audience_id: null,
        text: null,
        kind: null,
        id: null,
      },
    ],
  };
  renderWithOwner(<PublicationManager trip={trip} />);
  const review = within(await screen.findByRole("list", { name: "Controle voor het delen" }));
  expect(review.getByText(/7 bezoeken, 0 verblijven, 2 routes, 1 reisupdate/)).toBeTruthy();
  expect(
    review.getByText(
      "De pagina voor iedereen krijgt 7 bezoeken, 1 reisupdate zonder kaartpunt, omdat hun gebied niet gedeeld is of geen punt heeft.",
    ),
  ).toBeTruthy();
  expect(
    review.getByText(/Link “Familie” is actief maar krijgt geen enkel onderdeel/),
  ).toBeTruthy();
  expect(review.getByText(/toont “Chiayi · concept”/)).toBeTruthy();
  expect(
    review.getByText(
      /De pagina voor iedereen toont geen omslag omdat het de gekozen omslagfoto niet ontvangt/,
    ),
  ).toBeTruthy();
  expect(
    review.getByText("De pagina voor iedereen toont de reisdatums (alleen maanden)."),
  ).toBeTruthy();
});

it("previews the future transport and day dates of the unsaved public scope, in words", async () => {
  api.on("POST", /^\/api\/trips\/trip\/public-projection\/future-disclosure$/, () => ({
    transport: 2,
    day_dates: 3,
  }));
  renderWithOwner(<PublicationManager trip={trip} />);
  const editor = await screen.findByRole("group", { name: "Wat iedereen mag zien" });
  fireEvent.click(within(editor).getByRole("checkbox", { name: "Samenvatting" }));
  fireEvent.click(screen.getByRole("button", { name: "Bekijk als bezoeker" }));
  const dialog = await screen.findByRole("dialog", { name: "Publieke preview" });
  expect(
    await within(dialog).findByText(
      "De pagina voor iedereen kan vóór de reis lezen wanneer en hoe u reist: 2 vervoersverbindingen met tijd of maatschappij. Zet die routes tot uw vertrek op privé.",
    ),
  ).toBeTruthy();
  expect(
    within(dialog).getByText(
      "De pagina voor iedereen toont datums per dag bij 3 records met een datum vóór de reis. Zet tot uw vertrek “Datums die dit publiek ziet” op maand.",
    ),
  ).toBeTruthy();
  // The candidate is what the review counts; nothing was saved.
  expect(
    api.lastBody<ShareScope>("POST /api/trips/trip/public-projection/future-disclosure")?.items,
  ).toEqual([]);
  expect(api.count("PUT /api/trips/trip/public-projection")).toBe(0);
});

it("retains a draft across a deferred scope conflict and retries with the chosen revision", async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const headers: (string | null)[] = [];
  server.use(
    http.put("/api/trips/trip/public-projection", async ({ request }) => {
      headers.push(request.headers.get("If-Match"));
      const candidate = await request.json();
      if (headers.length === 1) {
        await pending;
        return HttpResponse.json(
          { detail: { code: "scope_revision_conflict", current: { ...status, revision: 2 } } },
          { status: 412 },
        );
      }
      return HttpResponse.json({ ...status, scope: candidate, revision: 3 });
    }),
  );
  renderWithOwner(<PublicationManager trip={trip} />);
  const checkbox = (await openPublicGroup("Reisupdates")).getByRole("checkbox", {
    name: /Stad ↔ natuur/,
  });
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Keuze bewaren" }));
  await waitFor(() => expect(headers).toEqual(['"1"']));
  await act(async () => {
    resolve();
  });
  fireEvent.click(await screen.findByRole("button", { name: "Mijn concept behouden" }));
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Keuze bewaren" }));
  await waitFor(() => expect(headers).toEqual(['"1"', '"2"']));
  await screen.findByText("Keuze bewaard. Niet-geselecteerde inhoud blijft privé.");
});

const DATE_LIMIT = "Datums die dit publiek ziet";

it("sets how precisely the public page shows dates and sends the choice with the scope", async () => {
  status = { ...status, scope: { ...scope(), defaults: { date_precision: "month" } } };
  renderWithOwner(<PublicationManager trip={trip} />);
  await publicScope().findByRole("combobox", { name: DATE_LIMIT });
  await waitFor(() => expect(selectedOption(DATE_LIMIT)).toBe("Maanden"));
  // The explanation says a record's own setting can only make dates coarser.
  expect(publicScope().getByText(/alleen grover maken, nooit preciezer/)).toBeTruthy();

  chooseOption(DATE_LIMIT, "Dagen");
  fireEvent.click(screen.getByRole("button", { name: "Keuze bewaren" }));
  await screen.findByText("Keuze bewaard. Niet-geselecteerde inhoud blijft privé.");
  expect(api.lastBody<ShareScope>("PUT /api/trips/trip/public-projection")!.defaults).toEqual({
    date_precision: "day",
  });

  chooseOption(DATE_LIMIT, "Geen limiet: elk onderdeel bepaalt zelf");
  expect(publicScope().getByText(/alleen de maand/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keuze bewaren" }));
  await waitFor(() =>
    expect(api.lastBody<ShareScope>("PUT /api/trips/trip/public-projection")!.defaults).toEqual({
      date_precision: null,
    }),
  );
});

it("leaves the date setting of an older scope alone: nothing is sent unless the owner changes it", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  await publicScope().findByRole("combobox", { name: DATE_LIMIT });
  await waitFor(() =>
    expect(selectedOption(DATE_LIMIT)).toBe("Geen limiet: elk onderdeel bepaalt zelf"),
  );
  fireEvent.click(
    (await openPublicGroup("Reisupdates")).getByRole("checkbox", { name: /Stad ↔ natuur/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Keuze bewaren" }));
  await screen.findByText("Keuze bewaard. Niet-geselecteerde inhoud blijft privé.");
  expect(api.lastBody<ShareScope>("PUT /api/trips/trip/public-projection")).not.toHaveProperty(
    "defaults",
  );
});

const TRIP_DATES = "Hoe precies mogen de reisdatums zijn?";
const advancedButton = () =>
  publicScope().getByRole("button", { name: /^Geavanceerd/ }) as HTMLButtonElement;

it("keeps Advanced closed while nothing in it differs from the default, with the one date control outside", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  // The audience's date control is a primary control; the older trip-dates control lives under Advanced.
  await publicScope().findByRole("combobox", { name: DATE_LIMIT });
  await waitFor(() => expect(advancedButton().getAttribute("aria-expanded")).toBe("false"));
  expect(publicScope().queryByRole("combobox", { name: TRIP_DATES })).toBeNull();
  expect(publicScope().queryByRole("button", { name: /^Reisupdates/ })).toBeNull();
  fireEvent.click(advancedButton());
  await publicScope().findByRole("combobox", { name: TRIP_DATES });
  expect(selectedOption(TRIP_DATES)).toBe("Niet tonen");
  expect(publicScope().getByRole("button", { name: /^Reisupdates/ })).toBeTruthy();
});

it("opens Advanced by itself when the audience already shows trip dates, and saves them unchanged", async () => {
  status = {
    ...status,
    scope: { ...scope(), trip: { title: true, summary: true, dates: "year" } },
  };
  renderWithOwner(<PublicationManager trip={trip} />);
  await publicScope().findByRole("combobox", { name: TRIP_DATES });
  expect(advancedButton().getAttribute("aria-expanded")).toBe("true");
  expect(selectedOption(TRIP_DATES)).toBe("Alleen het jaar");
  // Editing something else never rewrites the stored trip dates or the audience's date setting.
  fireEvent.click(
    (await openPublicGroup("Reisupdates")).getByRole("checkbox", { name: /Stad ↔ natuur/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Keuze bewaren" }));
  await screen.findByText("Keuze bewaard. Niet-geselecteerde inhoud blijft privé.");
  const sent = api.lastBody<ShareScope>("PUT /api/trips/trip/public-projection")!;
  expect(sent.trip.dates).toBe("year");
  expect(sent).not.toHaveProperty("defaults");
});

it("opens Advanced by itself when the audience already lists records of its own", async () => {
  status = { ...status, scope: scope([{ kind: "travel_update", id: "u1" }]) };
  renderWithOwner(<PublicationManager trip={trip} />);
  await publicScope().findByRole("button", { name: /^Reisupdates/ });
  expect(advancedButton().getAttribute("aria-expanded")).toBe("true");
  expect(publicScope().getByText("Onderdelen alleen voor dit publiek")).toBeTruthy();
});

it("starts a new link at months, and keeps the choice in the previewed scope", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe link" }));
  const editor = within(await screen.findByRole("dialog"));
  await editor.findByRole("combobox", { name: DATE_LIMIT });
  expect(selectedOption(DATE_LIMIT)).toBe("Maanden");
  chooseOption(DATE_LIMIT, "Jaren");
  fireEvent.change(screen.getByLabelText("Naam van de link"), { target: { value: "Vrienden" } });
  fireEvent.click(screen.getByRole("button", { name: "Concept opslaan" }));
  await screen.findByText(/Concept opgeslagen/);
  expect(
    api.lastBody<{ scope: ShareScope }>("POST /api/trips/trip/share-links")!.scope.defaults,
  ).toEqual({
    date_precision: "year",
  });
});

it("starts a new link from the public page unless a preset is chosen, and sends the preset with the creation", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe link" }));
  // The first choice is the public baseline, and a link that does not exist yet has nothing to review.
  expect(screen.getByRole("radio", { name: "Zoals de openbare pagina" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(screen.queryByRole("button", { name: "Voorinstelling bekijken" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Naam van de link"), { target: { value: "Vrienden" } });
  fireEvent.click(screen.getByRole("radio", { name: "Verhaal en route" }));
  expect(screen.getByText(/wordt toegepast wanneer je het concept opslaat/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Concept opslaan" }));
  await waitFor(() => expect(api.count("POST /api/trips/trip/share-links")).toBe(1));
  expect(api.lastBody<{ preset?: string }>("POST /api/trips/trip/share-links")?.preset).toBe(
    "story_and_route",
  );
});

it("sends no preset for a new link that starts as the public page", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe link" }));
  fireEvent.change(screen.getByLabelText("Naam van de link"), { target: { value: "Vrienden" } });
  fireEvent.click(screen.getByRole("button", { name: "Concept opslaan" }));
  await waitFor(() => expect(api.count("POST /api/trips/trip/share-links")).toBe(1));
  expect(api.lastBody("POST /api/trips/trip/share-links")).not.toHaveProperty("preset");
});

it("applies a preset to the public page and loads the scope the server answers with", async () => {
  const review = {
    schema_version: "travel/sharing-preset@1",
    preset: "story_only",
    audience: { id: "public", kind: "public", label: null, live: false },
    applicable: true,
    refusal: null,
    changes: [{ kind: "travel_update", id: "u1", label: "Privé dagboek", action: "promote" }],
    change_counts: { promote: 1 },
    precision: { before: null, after: "month", changed: true, reads_coarser: {} },
    comparison: {
      before: {},
      after: { travel_update: 1 },
      added: { travel_update: 1 },
      removed: {},
      widened: [{ kind: "travel_update", id: "u1", label: "Privé dagboek" }],
      narrowed: [],
    },
    left_as_is: [],
    needs_decision: [],
    replaces_exceptions: [],
    requires_acknowledgement: false,
    fingerprint: "fp",
  };
  api.on("POST", /\/public-projection\/preset\/review$/, () => review);
  api.on("POST", /\/public-projection\/preset$/, () => {
    status = {
      ...status,
      revision: 2,
      scope: scope([{ kind: "travel_update", id: "u1" }]),
      applied_preset: "story_only",
      applied_preset_at: "2054-01-02T00:00:00Z",
      preset_exceptions: { shown: [], hidden: [], count: 0 },
    };
    return { applied: true, review, audience: status };
  });
  renderWithOwner(<PublicationManager trip={trip} />);
  await publicScope().findByText("Stad ↔ natuur");
  fireEvent.click(publicScope().getByRole("radio", { name: "Alleen het verhaal" }));
  fireEvent.click(publicScope().getByRole("button", { name: "Voorinstelling bekijken" }));
  const dialog = await screen.findByRole("alertdialog", {
    name: "“Alleen het verhaal” toepassen?",
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorinstelling toepassen" }));
  await waitFor(() => expect(api.count("POST /api/trips/trip/public-projection/preset")).toBe(1));
  expect(api.lastBody("POST /api/trips/trip/public-projection/preset")).toEqual({
    preset: "story_only",
    fingerprint: "fp",
    confirm_widening: false,
  });
  expect(api.lastHeaders("POST /api/trips/trip/public-projection/preset")?.get("If-Match")).toBe(
    '"1"',
  );
  // The label and the new revision come from the answer; the editor is not left dirty.
  expect(await publicScope().findByText("Alleen het verhaal, geen uitzonderingen")).toBeTruthy();
  fireEvent.click(publicScope().getByRole("checkbox", { name: "Samenvatting" }));
  fireEvent.click(screen.getByRole("button", { name: "Keuze bewaren" }));
  await waitFor(() => expect(api.count("PUT /api/trips/trip/public-projection")).toBe(1));
  expect(api.lastHeaders("PUT /api/trips/trip/public-projection")?.get("If-Match")).toBe('"2"');
});

it("states the preset and its exceptions for each audience in the sharing check", async () => {
  overview = {
    title: "Titel",
    starts_on: null,
    ends_on: null,
    trip_id: "trip",
    counts: {},
    visibility: {},
    audiences: [
      audience({ state: "published", live: true, preset: "story_and_route", preset_exceptions: 2 }),
      audience({
        kind: "share_link",
        id: "l1",
        label: "Familie",
        state: "draft",
        preset: "planned_trip",
        preset_exceptions: 0,
      }),
      audience({ kind: "share_link", id: "l2", label: "Zonder", state: "draft" }),
    ],
    warnings: [],
  };
  renderWithOwner(<PublicationManager trip={trip} />);
  const check = within(await screen.findByRole("list", { name: "Controle voor het delen" }));
  expect(check.getByText("Voorinstelling: Verhaal en route, met 2 uitzonderingen")).toBeTruthy();
  expect(check.getByText("Voorinstelling: Geplande reis, geen uitzonderingen")).toBeTruthy();
  expect(check.getAllByText(/^Voorinstelling:/)).toHaveLength(2);
});

it("states in the sharing check how each audience reads dates and which records are held coarser", async () => {
  overview = {
    title: "Titel",
    starts_on: null,
    ends_on: null,
    trip_id: "trip",
    counts: {},
    visibility: {},
    audiences: [
      audience({
        state: "published",
        live: true,
        date_precision: "day",
        record_precision: {
          visits: {
            by_precision: { day: 9, month: 3 },
            limited_by_record: 3,
            default_applied: 0,
          },
          stays: { by_precision: { day: 4 }, limited_by_record: 0, default_applied: 0 },
        },
      }),
      audience({
        kind: "share_link",
        id: "l1",
        label: "Familie",
        state: "active",
        live: true,
        date_precision: null,
        record_precision: {
          visits: { by_precision: { month: 2 }, limited_by_record: 0, default_applied: 2 },
        },
      }),
    ],
    warnings: [],
  };
  renderWithOwner(<PublicationManager trip={trip} />);
  const check = within(await screen.findByRole("list", { name: "Controle voor het delen" }));
  expect(check.getByText("Datums die dit publiek ziet: dagen.")).toBeTruthy();
  expect(
    check.getByText(
      "Bezoeken: 9 per dag, 3 per maand; 3 grover gehouden door hun eigen instelling",
    ),
  ).toBeTruthy();
  expect(check.getByText("Verblijven: 4 per dag")).toBeTruthy();
  expect(
    check.getByText(
      "Voor dit publiek is geen datumlimiet ingesteld; de eigen instelling van elk onderdeel geldt.",
    ),
  ).toBeTruthy();
  expect(
    check.getByText("Bezoeken: 2 per maand; 2 volgen geen instelling en tonen daarom de maand"),
  ).toBeTruthy();
});

const followResult = (overrides = {}) => ({
  applied: false,
  changed: { visits: 2, stays: 1 },
  audiences: [
    {
      audience: "public",
      label: null,
      widened: { visits: 2, stays: 1 },
      narrowed: { visits: 0, stays: 0 },
    },
  ],
  ...overrides,
});

it("lets visits and stays follow the audience after showing who will see more precise dates", async () => {
  api.on("POST", /\/date-precision\/follow-audience$/, (body) => {
    const request = body as { confirm: boolean };
    return followResult({ applied: request.confirm });
  });
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Precisie van het publiek volgen…" }));
  const dialog = within(await screen.findByRole("alertdialog"));
  expect(dialog.getByText(/Onderdelen die hun eigen datuminstelling loslaten: 3/)).toBeTruthy();
  expect(
    dialog.getByText("De pagina voor iedereen ziet preciezere datums voor 2 bezoeken, 1 verblijf."),
  ).toBeTruthy();
  // Nothing is stored by the check, and the change waits for the owner to accept the widening.
  expect(api.lastBody("POST /api/trips/trip/date-precision/follow-audience")).toEqual({
    kinds: ["visit", "stay"],
    confirm: false,
    confirm_widening: false,
  });
  const confirm = dialog.getByRole("button", { name: "Het publiek volgen" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.click(
    dialog.getByRole("checkbox", { name: /Ik begrijp dat deze bezoekers preciezere datums zien/ }),
  );
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  await screen.findByText("Onderdelen die nu de precisie van het publiek volgen: 3.");
  expect(api.lastBody("POST /api/trips/trip/date-precision/follow-audience")).toEqual({
    kinds: ["visit", "stay"],
    confirm: true,
    confirm_widening: true,
  });
});

it("follows the audience for one kind only, and needs no acknowledgement when nobody sees more", async () => {
  api.on("POST", /\/date-precision\/follow-audience$/, (body) => {
    const request = body as { confirm: boolean };
    return followResult({
      applied: request.confirm,
      changed: { visits: 1, stays: 0 },
      audiences: [
        {
          audience: "link:l1",
          label: "Familie",
          widened: { visits: 0, stays: 0 },
          narrowed: { visits: 1, stays: 0 },
        },
      ],
    });
  });
  renderWithOwner(<PublicationManager trip={trip} />);
  chooseOption("Toepassen op", "Bezoeken");
  fireEvent.click(await screen.findByRole("button", { name: "Precisie van het publiek volgen…" }));
  const dialog = within(await screen.findByRole("alertdialog"));
  expect(dialog.getByText(/Link “Familie” ziet minder precieze datums voor 1 bezoek/)).toBeTruthy();
  expect(dialog.queryByRole("checkbox")).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "Het publiek volgen" }));
  await waitFor(() =>
    expect(api.lastBody("POST /api/trips/trip/date-precision/follow-audience")).toEqual({
      kinds: ["visit"],
      confirm: true,
      confirm_widening: false,
    }),
  );
});

it("says so when no visit or stay has its own date setting", async () => {
  api.on("POST", /\/date-precision\/follow-audience$/, () =>
    followResult({ changed: { visits: 0, stays: 0 }, audiences: [] }),
  );
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Precisie van het publiek volgen…" }));
  await screen.findByText(
    "Geen bezoek of verblijf heeft een eigen datuminstelling; ze volgen het publiek al.",
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(api.count("POST /api/trips/trip/date-precision/follow-audience")).toBe(1);
});

// --- Hidden links start from the public baseline and can leave records out of it ---

type ReviewBody = {
  exclude: { kind: string; id: string }[];
  items: { kind: string; id: string }[];
};
/** A server stand-in: the baseline reaches the update “Aankomst”; excluding it also hides its two photos. */
function serveReview(stale = 0) {
  api.on("POST", /\/share-scope\/exclusion-review$/, (body) => {
    const exclude = (body as ReviewBody).exclude;
    const left = exclude.some((item) => item.kind === "travel_update" && item.id === "u2");
    return {
      baseline: [{ kind: "travel_update", id: "u2" }],
      excluded: left
        ? [
            {
              kind: "travel_update",
              id: "u2",
              received: true,
              hides: { media_derivative: 2 },
              also_hides: [
                { kind: "media_derivative", id: "x1" },
                { kind: "media_derivative", id: "x2" },
              ],
            },
          ]
        : [],
      also_hidden: left ? { media_derivative: 2 } : {},
      stale,
    };
  });
}
/** The server refuses the next save of this link (409) until the owner has acknowledged what it would show. */
function refuseOnce(linkId: string, counts: Record<string, number>) {
  const seen = { calls: 0, body: undefined as unknown };
  server.use(
    http.patch(
      `/api/trips/trip/share-links/${linkId}`,
      async ({ request }) => {
        seen.calls += 1;
        seen.body = await request.json();
        return HttpResponse.json(
          { detail: { code: "exclusion_widening_needs_acknowledgement", revealed: [], counts } },
          { status: 409 },
        );
      },
      { once: true },
    ),
  );
  return seen;
}
const exclusionSection = () =>
  within(screen.getByRole("region", { name: "Weggelaten voor dit publiek" }));

it("lists what a link receives from the public page, ticked, and leaves one record out of this link only", async () => {
  serveReview();
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Familie/ }));
  const section = exclusionSection();
  fireEvent.click(await section.findByRole("button", { name: /Reisupdates/ }));
  const checkbox = await section.findByRole("checkbox", { name: "Toon “Aankomst” op deze link" });
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  expect(section.getByText("1 van 1 getoond")).toBeTruthy();

  fireEvent.click(checkbox);
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  // The server says what else the unticked update takes with it; the screen does not work that out itself.
  await section.findByText(/verberg je ook 2 media, die ervan afhangen/);
  expect(section.getByRole("status").textContent).toMatch(
    /Dit publiek laat 1 onderdeel weg en verbergt daarmee ook 2 media/,
  );
  expect(
    api.lastBody<ReviewBody>("POST /api/trips/trip/share-scope/exclusion-review")?.exclude,
  ).toEqual([{ kind: "travel_update", id: "u2" }]);

  fireEvent.click(screen.getByRole("button", { name: "Link opslaan" }));
  await waitFor(() => expect(api.count("PATCH /api/trips/trip/share-links/l1")).toBe(1));
  const saved = api.lastBody<{ scope: ShareScope }>("PATCH /api/trips/trip/share-links/l1");
  expect(saved?.scope.exclude).toEqual([{ kind: "travel_update", id: "u2" }]);
  expect(saved?.scope.items).toEqual([]);
});

it("shows every record again with one button, and previews the unsaved exclusions", async () => {
  serveReview();
  api.rows("/api/trips/trip/share-links")[0]!.scope = {
    ...scope(),
    exclude: [{ kind: "travel_update", id: "u2" }],
  };
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Familie/ }));
  const section = exclusionSection();
  const checkbox = await section.findByRole("checkbox", { name: "Toon “Aankomst” op deze link" });
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(await section.findByRole("button", { name: "Alles weer tonen" }));
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  expect(section.queryByRole("button", { name: "Alles weer tonen" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld bekijken" }));
  await screen.findByRole("dialog", { name: "Preview van Familie" });
  expect(api.lastBody<ShareScope>("POST /api/trips/trip/share-links/l1/preview")?.exclude).toEqual(
    [],
  );
});

it("says how many stored exclusions no longer apply", async () => {
  serveReview(2);
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Familie/ }));
  await exclusionSection().findByText(/2 eerdere keuzes gelden niet meer/);
});

it("does not send exclusions an older scope never had, and keeps stored ones when only the name changes", async () => {
  serveReview();
  api.rows("/api/trips/trip/share-links")[0]!.scope = {
    ...scope(),
    exclude: [{ kind: "travel_update", id: "u2" }],
  };
  api.collection("/api/trips/trip/share-links", [
    ...api.rows("/api/trips/trip/share-links"),
    link("l9", "Oud", "draft"),
  ]);
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Oud/ }));
  const name = await screen.findByRole("textbox", { name: "Naam van de link" });
  fireEvent.change(name, { target: { value: "Oud en bewaard" } });
  fireEvent.click(screen.getByRole("button", { name: "Link opslaan" }));
  await waitFor(() => expect(api.count("PATCH /api/trips/trip/share-links/l9")).toBe(1));
  expect(
    api.lastBody<{ scope: Record<string, unknown> }>("PATCH /api/trips/trip/share-links/l9")?.scope,
  ).not.toHaveProperty("exclude");
});

it("asks before an active link shows more because an exclusion was removed, and only then sends the acknowledgement", async () => {
  serveReview();
  const active = link("l2", "Vrienden", "active");
  active.scope = { ...scope(), exclude: [{ kind: "travel_update", id: "u2" }] };
  api.collection("/api/trips/trip/share-links", [active]);
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Vrienden/ }));
  fireEvent.click(
    await exclusionSection().findByRole("checkbox", { name: "Toon “Aankomst” op deze link" }),
  );
  const refused = refuseOnce("l2", { travel_update: 1, media_derivative: 2 });
  fireEvent.click(screen.getByRole("button", { name: "Link opslaan" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Meer tonen op deze link?" });
  expect(
    within(dialog).getByText(
      /zien de mensen die hem hebben 1 reisupdate, 2 media die ze nu niet zien/,
    ),
  ).toBeTruthy();
  expect(refused.body).not.toHaveProperty("confirm_widening");
  // Nothing is sent until the owner has ticked the acknowledgement.
  const confirm = within(dialog).getByRole("button", { name: "Meer tonen" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.click(
    within(dialog).getByRole("checkbox", {
      name: /Ik begrijp dat mensen met deze link meer gaan zien/,
    }),
  );
  fireEvent.click(confirm);
  await waitFor(() => expect(api.count("PATCH /api/trips/trip/share-links/l2")).toBe(1));
  expect(
    api.lastBody<{ confirm_widening: boolean; scope: ShareScope }>(
      "PATCH /api/trips/trip/share-links/l2",
    ),
  ).toMatchObject({
    confirm_widening: true,
    scope: { exclude: [] },
  });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});

it("keeps the edit and sends nothing when the owner declines the widening", async () => {
  serveReview();
  const active = link("l2", "Vrienden", "active");
  active.scope = { ...scope(), exclude: [{ kind: "travel_update", id: "u2" }] };
  api.collection("/api/trips/trip/share-links", [active]);
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Vrienden/ }));
  const checkbox = await exclusionSection().findByRole("checkbox", {
    name: "Toon “Aankomst” op deze link",
  });
  fireEvent.click(checkbox);
  const refused = refuseOnce("l2", { travel_update: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Link opslaan" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Meer tonen op deze link?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(refused.calls).toBe(1);
  expect(api.count("PATCH /api/trips/trip/share-links/l2")).toBe(0);
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
});

it("states in the sharing check how many records a link leaves out and what that also hides", async () => {
  overview = {
    title: "Titel",
    starts_on: null,
    ends_on: null,
    trip_id: "trip",
    counts: {},
    visibility: {},
    audiences: [
      audience(),
      audience({
        kind: "share_link",
        id: "l1",
        label: "Familie",
        state: "active",
        live: true,
        excluded: 2,
        excluded_also_hides: { visit: 2, stay: 1, location: 1 },
      }),
    ],
    warnings: [],
  };
  renderWithOwner(<PublicationManager trip={trip} />);
  await screen.findByText(
    /Laat 2 onderdelen op “Iedereen” weg, en verbergt daarmee ook 2 bezoeken, 1 verblijf, 1 plaats/,
  );
  // The public page leaves nothing out, so it says nothing about it.
  expect(screen.getAllByText(/Laat \d+ onderde/)).toHaveLength(1);
});

it("lists a link that leaves records out with how many", async () => {
  api.rows("/api/trips/trip/share-links")[0]!.exclusions = {
    excluded: [{ kind: "area", id: "b1", received: true, hides: { visit: 1 }, also_hides: [] }],
    also_hidden: { visit: 1 },
    stale: 0,
  };
  renderWithOwner(<PublicationManager trip={trip} />);
  const row = await screen.findByRole("button", { name: /Familie/ });
  expect(row.textContent).toMatch(/laat 1 onderdeel weg/);
});

it("offers no way to leave records out on the public page: it is the baseline", async () => {
  serveReview();
  renderWithOwner(<PublicationManager trip={trip} />);
  await publicScope().findByText("Reisupdates");
  expect(screen.queryByRole("region", { name: "Weggelaten voor dit publiek" })).toBeNull();
  expect(api.count("POST /api/trips/trip/share-scope/exclusion-review")).toBe(0);
});

it("says in a link's preview how it differs from the public page", async () => {
  serveReview();
  api.rows("/api/trips/trip/share-links")[0]!.scope = {
    ...scope(),
    exclude: [{ kind: "travel_update", id: "u2" }],
  };
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Familie/ }));
  await exclusionSection().findByRole("checkbox", { name: "Toon “Aankomst” op deze link" });
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld bekijken" }));
  const dialog = await screen.findByRole("dialog", { name: "Preview van Familie" });
  await within(dialog).findByText(
    /Ten opzichte van de openbare pagina laat dit publiek 1 onderdeel weg\. Daarmee verbergt het ook 2 media, die ervan afhangen\./,
  );
});
