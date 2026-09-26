// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { ownerKeys } from "../query/keys";
import { renderWithOwner, testToken } from "../query/test-utils";
import { answerConfirmation } from "../test-confirm";
import type { OverviewAudience, ProjectionDocument, PublicProjectionStatus, ShareLink, ShareScope, Trip, TripOverview } from "../tracker-model";
import { PublicationManager } from "./PublicationManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));
vi.mock("./RenderedPreview", () => ({ RenderedPreview: () => <p>Weergegeven preview</p> }));

const scope = (items: ShareScope["items"] = []): ShareScope => ({ schema_version: "travel/share-scope@1", trip: { title: true, summary: true, dates: null }, items });
const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, travel_updates: [
  { id: "u1", occurred_at: "2054-11-16T10:00:00Z", date_precision: "day", title: "Privé dagboek", body: "Geheim", private_notes: null, area_id: null, location: null, media_asset_ids: [], visibility: "private" },
  { id: "u2", occurred_at: "2054-11-16T10:00:00Z", date_precision: "day", title: "Aankomst", body: "Geland", private_notes: null, area_id: null, location: null, media_asset_ids: [], visibility: "everyone" },
  { id: "u3", occurred_at: "2054-11-16T10:00:00Z", date_precision: "day", title: "Stad ↔ natuur", body: "Bos", private_notes: null, area_id: null, location: null, media_asset_ids: [], visibility: "custom" },
] };
const link = (id: string, label: string, state: ShareLink["state"] = "draft"): ShareLink => ({ id, series_id: id, label, state, token: null, expires_at: null, scope: scope() } as ShareLink);

let api: FakeApi;
let status: PublicProjectionStatus;
let overview: TripOverview;
const audience = (overrides: Partial<OverviewAudience> = {}): OverviewAudience => ({
  kind: "public", id: null, label: "public", state: "unpublished", live: false, shares_title: true, shares_summary: true,
  dates_precision: null, scope_items: 0, delivered: { visits: 0, places: 0, stays: 0, routes: 0, updates: 0, media: 0 },
  without_map_point: { visits: 0, stays: 0, updates: 0 }, ...overrides,
});
const SECRET = "secret-token-123";

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  status = { trip_id: "trip", slug: "exampleland", surface_state: "unpublished", scope: scope() } as unknown as PublicProjectionStatus;
  overview = { trip_id: "trip", counts: {}, visibility: {}, audiences: [audience()], warnings: [] };
  api = fakeApi()
    .collection("/api/trips/trip/share-links", [link("l1", "Familie")], { create: (body, count) => link(`l${count + 1}`, String(body.label)) })
    .collection("/api/trips/trip/areas", [{ id: "b1", label: "Taipei", visibility: "custom" }])
    .collection("/api/trips/trip/locations", [
      { id: "e1", label: "Warme bron van Beitou", display_name: "Beitou Hot Spring, 12 Guangming Road", visibility: "custom" },
      { id: "e2", label: null, display_name: "Hotel, 1 Main Street", visibility: "private" },
    ])
    .collection("/api/trips/trip/visits", [{ id: "v1", title: "Noordkust", area: { label: "Taipei" }, location: null, visibility: "custom" }])
    .collection("/api/trips/trip/stays", [])
    .collection("/api/trips/trip/routes", [{ id: "leg1", mode: "flight", label: null, departure_area: { label: "Zaventem", country_code: "BE" }, arrival_area: { label: "Taoyuan", country_code: "TW" }, visibility: "custom" }])
    .collection("/api/trips/trip/media", [{ id: "p1", original_filename: "kust.jpg" }])
    .collection("/api/trips/trip/media/p1/derivatives", [{ id: "x1", review_state: "approved", purpose: "share", visibility: "custom", travel_update_id: null }, { id: "x2", review_state: "pending", purpose: "share", visibility: "private", travel_update_id: null }])
    .collection("/api/trips/trip/documents", []);
  api.on("PUT", /\/visibility\/[^/]+\/[^/]+$/, (body) => body);
  api.on("GET", /^\/api\/trips\/trip\/public-projection$/, () => status);
  api.on("GET", /^\/api\/trips\/trip\/overview$/, () => overview);
  api.on("PUT", /^\/api\/trips\/trip\/public-projection$/, (body) => { status = { ...status, scope: body as ShareScope }; return status; });
  api.on("POST", /^\/api\/trips\/trip\/public-projection\/publish$/, () => { status = { ...status, surface_state: "published" }; return status; });
  api.on("POST", /^\/api\/trips\/trip\/public-projection\/unpublish$/, () => { status = { ...status, surface_state: "unpublished" }; return status; });
  api.on("POST", /\/preview$/, () => ({ title: "Exampleland", summary: null, dates: null, visits: [], places: [], updates: [], stays: [], media: [], routes: [] } as unknown as ProjectionDocument));
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expect(api.unexpected).toEqual([]); });

const publicScope = () => within(screen.getByRole("group", { name: "Wat iedereen mag zien" }));

it("offers only records set to custom, and only reviewed copies, for an audience to list", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  await publicScope().findByText("Stad ↔ natuur");
  await waitFor(() => expect(publicScope().getByText("kust.jpg")).toBeTruthy());
  // The pending copy, the private and everyone updates and the unnamed private location are not choices here.
  expect(publicScope().getAllByText("Goedgekeurde foto")).toHaveLength(1);
  expect(publicScope().queryByText("Privé dagboek")).toBeNull();
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
  expect(scopeEditor.getByText(/1 voor iedereen verschijnt hier altijd, 1 privé blijft verborgen/)).toBeTruthy();
  fireEvent.click(scopeEditor.getByLabelText(/Stad ↔ natuur/));
  expect(scopeEditor.queryByLabelText("title")).toBeNull();
  expect(scopeEditor.queryByLabelText("body")).toBeNull();
});

it("sets who sees a record from Delen with the same control as its own editor", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const control = await screen.findByLabelText("Zichtbaarheid van Aankomst");
  expect((control as HTMLSelectElement).value).toBe("everyone");
  fireEvent.change(control, { target: { value: "private" } });
  await waitFor(() => expect(api.lastBody("PUT /api/trips/trip/visibility/travel_update/u2")).toEqual({ visibility: "private" }));
});

it("offers a redacted route summary, without the owner-only booking fields", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const transport = within((await publicScope().findByText("Routes")).closest("details")!);
  expect(transport.getByText("Vlucht: Zaventem → Taoyuan")).toBeTruthy();
  expect(transport.getByText(/nooit boekingscode, reisklasse, notities of documenten/i)).toBeTruthy();
  fireEvent.click(transport.getByRole("button", { name: "Alles kiezen" }));
  fireEvent.click(screen.getByRole("button", { name: "Keuze bewaren" }));
  await screen.findByText("Keuze bewaard. Niet-geselecteerde inhoud blijft privé.");
  // No fields to pick: the scope names the record only.
  expect(api.lastBody<ShareScope>("PUT /api/trips/trip/public-projection")!.items).toEqual([{ kind: "route", id: "leg1" }]);
});

it("groups records into collapsed sections with a count, and chooses or clears a whole section", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const group = async (title: string) => within((await publicScope().findByText(title)).closest("details")!);
  const updates = await group("Reisupdates");
  expect(updates.getByText("0 van 1 gekozen")).toBeTruthy();
  expect((updates.getByRole("button", { name: "Niets kiezen" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(updates.getByRole("button", { name: "Alles kiezen" }));
  expect(updates.getByText("1 van 1 gekozen")).toBeTruthy();
  expect((updates.getByLabelText(/Stad ↔ natuur/) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(updates.getByRole("button", { name: "Niets kiezen" }));
  expect(updates.getByText("0 van 1 gekozen")).toBeTruthy();
  // The other sections are untouched.
  expect((await group("Gebieden")).getByText("0 van 1 gekozen")).toBeTruthy();
  expect((await group("Locaties")).getByText("0 van 1 gekozen")).toBeTruthy();
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
  const history = await screen.findByText("1 eerdere versie bekijken");
  const series = history.closest(".link-series")!;
  expect(series.querySelectorAll(":scope > .link-row")).toHaveLength(1);
  const details = history.closest("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(history);
  expect(details.open).toBe(true);
});

it("asks before discarding an unsaved link scope when changing editors", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Familie/ }));
  fireEvent.change(screen.getByLabelText("Naam van de link"), { target: { value: "Familie en vrienden" } });
  fireEvent.click(screen.getByRole("button", { name: "Nieuwe link" }));
  expect(await screen.findByText("Niet-opgeslagen linkwijzigingen verwerpen?")).toBeTruthy();
  expect((screen.getByLabelText("Naam van de link") as HTMLInputElement).value).toBe("Familie en vrienden");
  await answerConfirmation("Wijzigingen verwerpen");
  await waitFor(() => expect((screen.getByLabelText("Naam van de link") as HTMLInputElement).value).toBe(""));
});

it("saves the chosen public scope and shows the server's copy afterwards", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const checkbox = await within(await screen.findByRole("group", { name: "Wat iedereen mag zien" })).findByLabelText(/Stad ↔ natuur/);
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Keuze bewaren" }));
  await screen.findByText("Keuze bewaard. Niet-geselecteerde inhoud blijft privé.");
  expect(api.lastBody<ShareScope>("PUT /api/trips/trip/public-projection")!.items).toEqual([{ kind: "travel_update", id: "u3" }]);
  expect((publicScope().getByLabelText(/Stad ↔ natuur/) as HTMLInputElement).checked).toBe(true);
});

it("keeps unsaved public scope edits when the server copy is refreshed", async () => {
  const { client } = renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await within(await screen.findByRole("group", { name: "Wat iedereen mag zien" })).findByLabelText(/Stad ↔ natuur/));
  status = { ...status, scope: { ...scope(), trip: { title: false, summary: true, dates: null } } };
  await act(async () => { await client.invalidateQueries({ queryKey: ownerKeys.tripResource("owner-1", "trip", "public-projection") }); });
  expect((publicScope().getByLabelText(/Stad ↔ natuur/) as HTMLInputElement).checked).toBe(true);
});

it("publishes and withdraws the public page", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const publish = await screen.findByRole("button", { name: "Met iedereen delen" });
  await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(publish);
  fireEvent.click(await screen.findByRole("button", { name: "Niet meer met iedereen delen" }));
  await screen.findByText("Publieke pagina ingetrokken.");
  expect(screen.getByRole("button", { name: "Met iedereen delen" })).toBeTruthy();
});

it("previews the public page after saving its scope", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  await screen.findByRole("group", { name: "Wat iedereen mag zien" });
  fireEvent.click(screen.getByRole("button", { name: "Bekijk als bezoeker" }));
  const dialog = await screen.findByRole("dialog", { name: "Publieke preview" });
  expect(within(dialog).getByText("Weergegeven preview")).toBeTruthy();
  expect(api.count("PUT /api/trips/trip/public-projection")).toBe(1);
  expect(api.count("POST /api/trips/trip/public-projection/preview")).toBe(1);
});

it("creates an active link directly, then lets its owner retrieve the URL again", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe link" }));
  fireEvent.click(screen.getByRole("button", { name: "Link maken" }));
  await screen.findByText("Geef de link een naam.");
  expect(api.count("POST /api/trips/trip/share-links")).toBe(0);

  fireEvent.change(screen.getByLabelText("Naam van de link"), { target: { value: "Vrienden" } });
  fireEvent.click(screen.getByRole("button", { name: "Link maken" }));
  const reveal = await screen.findByRole("dialog", { name: "Deellink" });
  expect(within(reveal).getByText(`${window.location.origin}/share/${SECRET}`)).toBeTruthy();
  expect(screen.getByText("De link is actief en kan later opnieuw worden gekopieerd.")).toBeTruthy();
  expect(api.lastBody("POST /api/trips/trip/share-links/l2/activate")).toEqual({ expires_in_days: 30, reason: null });
  expect(screen.getByRole("button", { name: /Vrienden/ }).textContent).toContain("active");

  fireEvent.click(screen.getByRole("button", { name: "Sluiten" }));
  expect(screen.queryByText(`${window.location.origin}/share/${SECRET}`)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Vrienden/ }));
  fireEvent.click(screen.getByRole("button", { name: "Link tonen" }));
  expect((await screen.findByRole("dialog", { name: "Deellink" })).textContent).toContain(`${window.location.origin}/share/${SECRET}`);
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
  expect((screen.getByRole("button", { name: "Link opslaan" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button", { name: /Familie/ }).textContent).toContain("revoked");
});

it("saves a renamed link and shows the new name in the list", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Familie/ }));
  expect((screen.getByLabelText("Naam van de link") as HTMLInputElement).value).toBe("Familie");
  fireEvent.change(screen.getByLabelText("Naam van de link"), { target: { value: "Familie en vrienden" } });
  fireEvent.click(screen.getByRole("button", { name: "Link opslaan" }));
  await screen.findByRole("button", { name: /Familie en vrienden/ });
  expect(screen.queryByRole("button", { name: /^Familie ·/ })).toBeNull();
});

it("shows what each audience receives and words the review warnings in Dutch", async () => {
  overview = {
    trip_id: "trip", counts: {}, visibility: {},
    audiences: [
      audience({ state: "published", live: true, delivered: { visits: 7, places: 0, stays: 0, routes: 2, updates: 1, media: 0 }, without_map_point: { visits: 7, stays: 0, updates: 1 } }),
      audience({ kind: "share_link", id: "l1", label: "Familie", state: "active", live: true }),
    ],
    warnings: [
      { code: "trip_dates_shared", severity: "info", message: "", audience: "public", audience_id: null, text: "month", kind: null, id: null },
      { code: "map_point_withheld", severity: "warning", message: "", audience: "public", audience_id: null, text: "7 visits, 1 reisupdate", kind: null, id: null },
      { code: "live_audience_receives_nothing", severity: "warning", message: "", audience: "Familie", audience_id: "l1", text: null, kind: null, id: null },
      { code: "planning_marker_visible", severity: "warning", message: "", audience: "public", audience_id: null, text: "Chiayi · concept", kind: null, id: null },
    ],
  };
  renderWithOwner(<PublicationManager trip={trip} />);
  const review = within(await screen.findByRole("list", { name: "Controle voor het delen" }));
  expect(review.getByText(/7 bezoeken, 0 verblijven, 2 routes, 1 reisupdates/)).toBeTruthy();
  expect(review.getByText("De pagina voor iedereen krijgt 7 bezoeken, 1 reisupdate zonder kaartpunt, omdat hun gebied niet gedeeld is of geen punt heeft.")).toBeTruthy();
  expect(review.getByText(/Link “Familie” is actief maar krijgt geen enkel onderdeel/)).toBeTruthy();
  expect(review.getByText(/toont “Chiayi · concept”/)).toBeTruthy();
  expect(review.getByText("De pagina voor iedereen toont de reisdatums (alleen maanden).")).toBeTruthy();
});
