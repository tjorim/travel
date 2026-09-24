// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { ownerKeys } from "../query/keys";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { ProjectionDocument, PublicProjectionStatus, ShareLink, ShareScope, Trip } from "../tracker-model";
import { PublicationManager } from "./PublicationManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));
vi.mock("./RenderedPreview", () => ({ RenderedPreview: () => <p>Weergegeven preview</p> }));

const scope = (items: ShareScope["items"] = []): ShareScope => ({ schema_version: "travel/share-scope@1", trip: { title: true, summary: true, dates: null }, items });
const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, visibility: "private", publication_state: "draft", route_stages: [], moments: [], moment_excerpts: [], highlights: [{ id: "h1", title: "Stad ↔ natuur", summary: null, position: 0 }] };
const link = (id: string, label: string, state: ShareLink["state"] = "draft"): ShareLink => ({ id, label, state, expires_at: null, scope: scope() } as ShareLink);

let api: FakeApi;
let status: PublicProjectionStatus;
const SECRET = "secret-token-123";

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  status = { trip_id: "trip", slug: "exampleland", surface_state: "unpublished", scope: scope() } as unknown as PublicProjectionStatus;
  api = fakeApi()
    .collection("/api/trips/trip/share-links", [link("l1", "Familie")], { create: (body, count) => link(`l${count + 1}`, String(body.label)) })
    .collection("/api/trips/trip/places/broad", [{ id: "b1", label: "Taipei" }])
    .collection("/api/trips/trip/broad-routes", [])
    .collection("/api/trips/trip/broad-stay-cards", [])
    .collection("/api/trips/trip/media", [{ id: "p1", original_filename: "kust.jpg" }])
    .collection("/api/trips/trip/media/p1/derivatives", [{ id: "x1", review_state: "approved" }, { id: "x2", review_state: "pending" }])
    .collection("/api/trips/trip/documents", []);
  api.on("GET", /^\/api\/trips\/trip\/public-projection$/, () => status);
  api.on("PUT", /^\/api\/trips\/trip\/public-projection$/, (body) => { status = { ...status, scope: body as ShareScope }; return status; });
  api.on("POST", /^\/api\/trips\/trip\/public-projection\/publish$/, () => { status = { ...status, surface_state: "published" }; return status; });
  api.on("POST", /^\/api\/trips\/trip\/public-projection\/unpublish$/, () => { status = { ...status, surface_state: "unpublished" }; return status; });
  api.on("POST", /\/preview$/, () => ({ title: "Exampleland", summary: null, dates: null, highlights: [], route_stages: [], places: [], moments: [], stays: [], media: [], documents: [], route: [] } as unknown as ProjectionDocument));
  api.on("POST", /\/share-links\/([^/]+)\/(activate|rotate)$/, (_body, match) => {
    const rows = api.rows("/api/trips/trip/share-links");
    const row = rows.find((item) => item.id === match[1])!;
    row.state = "active";
    return { ...row, token: SECRET };
  });
  api.on("POST", /\/share-links\/([^/]+)\/revoke$/, (_body, match) => {
    const row = api.rows("/api/trips/trip/share-links").find((item) => item.id === match[1])!;
    row.state = "revoked";
    return row;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expect(api.unexpected).toEqual([]); });

const publicScope = () => within(screen.getByRole("group", { name: "Publieke scope" }));

it("offers only reviewed items to share: highlights, broad places and approved derivatives", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  await screen.findByText("Stad ↔ natuur");
  await screen.findByText("Brede plaats");
  await waitFor(() => expect(publicScope().getByText("kust.jpg")).toBeTruthy());
  expect(publicScope().getAllByText("Goedgekeurde media-afgeleide")).toHaveLength(1);
});

it("saves the chosen public scope and shows the server's copy afterwards", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const checkbox = await within(await screen.findByRole("group", { name: "Publieke scope" })).findByLabelText(/Stad ↔ natuur/);
  fireEvent.click(checkbox);
  fireEvent.click(publicScope().getByLabelText("summary"));
  fireEvent.click(screen.getByRole("button", { name: "Publieke scope opslaan" }));
  await screen.findByText("Publieke scope opgeslagen. Niet-geselecteerde inhoud blijft afwezig.");
  expect(api.lastBody<ShareScope>("PUT /api/trips/trip/public-projection")!.items).toEqual([{ kind: "trip_highlight", id: "h1", fields: ["title"] }]);
  expect((publicScope().getByLabelText(/Stad ↔ natuur/) as HTMLInputElement).checked).toBe(true);
});

it("keeps unsaved public scope edits when the server copy is refreshed", async () => {
  const { client } = renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await within(await screen.findByRole("group", { name: "Publieke scope" })).findByLabelText(/Stad ↔ natuur/));
  status = { ...status, scope: { ...scope(), trip: { title: false, summary: true, dates: null } } };
  await act(async () => { await client.invalidateQueries({ queryKey: ownerKeys.tripResource("owner-1", "trip", "public-projection") }); });
  expect((publicScope().getByLabelText(/Stad ↔ natuur/) as HTMLInputElement).checked).toBe(true);
});

it("publishes and withdraws the public page", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  const publish = await screen.findByRole("button", { name: "Publiceren" });
  await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(publish);
  fireEvent.click(await screen.findByRole("button", { name: "Publicatie intrekken" }));
  await screen.findByText("Publieke pagina ingetrokken.");
  expect(screen.getByRole("button", { name: "Publiceren" })).toBeTruthy();
});

it("previews the public page after saving its scope", async () => {
  renderWithOwner(<PublicationManager trip={trip} />);
  await screen.findByRole("group", { name: "Publieke scope" });
  fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);
  await screen.findByText("Weergegeven preview");
  expect(api.count("PUT /api/trips/trip/public-projection")).toBe(1);
  expect(api.count("POST /api/trips/trip/public-projection/preview")).toBe(1);
});

it("creates a draft link that appears in the list, then reveals its secret once and never caches it", async () => {
  const { client } = renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe link" }));
  fireEvent.click(screen.getByRole("button", { name: "Conceptlink maken" }));
  await screen.findByText("Geef de link een naam.");
  expect(api.count("POST /api/trips/trip/share-links")).toBe(0);

  fireEvent.change(screen.getByLabelText("Naam van de link"), { target: { value: "Vrienden" } });
  fireEvent.click(screen.getByRole("button", { name: "Conceptlink maken" }));
  await screen.findByRole("button", { name: /Vrienden/ });
  expect(screen.getByText("Concept-deellink gemaakt. Activeer hem om een eenmalige link te ontvangen.")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Activeren en veilige link tonen" }));
  await screen.findByText(`${window.location.origin}/share/${SECRET}`);
  expect(screen.getByText("De veilige link is nu één keer getoond. Bewaar hem nu veilig.")).toBeTruthy();
  expect(api.lastBody("POST /api/trips/trip/share-links/l2/activate")).toEqual({ expires_in_days: 30, reason: null });
  await waitFor(() => expect(client.getMutationCache().getAll().some((mutation) => JSON.stringify(mutation.state.data ?? "").includes(SECRET))).toBe(false));
  expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.state.data))).not.toContain(SECRET);
  expect(screen.getByRole("button", { name: /Vrienden/ }).textContent).toContain("active");

  fireEvent.click(screen.getByRole("button", { name: "Ik heb hem bewaard" }));
  expect(screen.queryByText(`${window.location.origin}/share/${SECRET}`)).toBeNull();
});

it("revokes an active link and locks its editor", async () => {
  api.rows("/api/trips/trip/share-links")[0].state = "active";
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Familie/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Link intrekken" }));
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
