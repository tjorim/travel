// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, restoreObjectUrls, stubObjectUrls, testToken } from "../query/test-utils";
import type { ShareScope, TravelUpdate, Trip } from "../tracker-model";
import { TravelUpdateManager } from "./TravelUpdateManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));
vi.mock("./RenderedPreview", () => ({
  RenderedPreview: ({ focusId }: { focusId?: string }) => <p>Weergegeven preview {focusId}</p>,
}));

const scope = (ids: string[] = []): ShareScope => ({
  schema_version: "travel/share-scope@1",
  trip: { title: true, summary: true, dates: null },
  items: ids.map((id) => ({ kind: "travel_update", id })),
});
const update = (
  id: string,
  title: string,
  visibility: TravelUpdate["visibility"] = "everyone",
  extra: Partial<TravelUpdate> = {},
): TravelUpdate => ({
  id,
  occurred_at: "2054-11-16T10:00:00Z",
  date_precision: "day",
  title,
  body: `Tekst van ${title}`,
  private_notes: null,
  area_id: null,
  location: null,
  media_asset_ids: [],
  visibility,
  ...extra,
});
const trip = (updates: TravelUpdate[]): Trip => ({
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: null,
  ends_on: null,
  travel_updates: updates,
});
const asset = (id: string, extra: object = {}) => ({
  id,
  media_kind: "photo",
  original_filename: `${id}.jpg`,
  thumbnail_url: `/files/${id}-thumb`,
  ...extra,
});
const copy = (id: string, assetId: string, updateId: string | null, altText: string | null) => ({
  id,
  media_asset_id: assetId,
  purpose: "share",
  review_state: "approved",
  travel_update_id: updateId,
  alt_text: altText,
  caption: null,
});

let api: FakeApi;
let status: {
  surface_state: "published" | "unpublished";
  scope: ShareScope;
  revision: number;
  slug: string | null;
};
let links: object[];

function seed(media: ReturnType<typeof asset>[], copies: Record<string, object[]> = {}) {
  api = fakeApi()
    .collection("/api/trips/trip/locations", [])
    .collection("/api/trips/trip/media", media)
    .value("/api/trips/trip/public-projection", status)
    .value("/api/trips/trip/share-links", links);
  for (const item of media)
    api.collection(
      `/api/trips/trip/media/${item.id}/derivatives`,
      (copies[item.id] ?? []) as never[],
    );
  api.on("GET", /^\/files\//, () => ({}));
  api.on("POST", /\/share-scope\/exclusion-review$/, () => ({
    excluded: [],
    also_hidden: {},
    stale: 0,
    baseline: [],
  }));
  api.on("POST", /\/preview$/, (_body, _match) => ({
    schema_version: "travel/public-trip@1",
    title: "Exampleland",
    updates: [{ id: "update-abc", title: "Aankomst", body: "Tekst van Aankomst" }],
    visits: [],
    places: [],
    stays: [],
    media: [],
    routes: [],
    navigation: [],
  }));
}

/** Reports every observed element as on screen at once, or never when `visible` is false. */
function stubObserver(visible = true) {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        if (visible) this.callback([{ isIntersecting: true }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  stubObjectUrls();
  stubObserver();
  status = { surface_state: "published", scope: scope(), revision: 1, slug: "x" };
  links = [];
});
afterEach(() => {
  cleanup();
  restoreObjectUrls();
  vi.unstubAllGlobals();
  expect(api.unexpected).toEqual([]);
});

const render = (updates: TravelUpdate[]) =>
  renderWithOwner(<TravelUpdateManager trip={trip(updates)} areas={[]} />);

it("keeps a row without photos compact: no strip", async () => {
  seed([]);
  render([update("e1", "Aankomst")]);
  await screen.findByRole("button", { name: /^Aankomst\b/ });
  expect(screen.queryByRole("list", { name: /Foto's bij/ })).toBeNull();
});

it("shows a single photo with its own alt text, from the owner's thumbnail route", async () => {
  seed([asset("p1")], { p1: [copy("c1", "p1", "e1", "Een haven bij zonsopkomst")] });
  render([update("e1", "Aankomst")]);
  const strip = await screen.findByRole("list", { name: "Foto's bij Aankomst" });
  const image = await within(strip).findByRole("img", { name: "Een haven bij zonsopkomst" });
  expect(image.getAttribute("src")).toBe("blob:test");
  expect(within(strip).getAllByRole("listitem")).toHaveLength(1);
  expect(api.count("GET /files/p1-thumb")).toBe(1);
});

it("waits to fetch a thumbnail until its row nears the screen", async () => {
  stubObserver(false);
  seed([asset("p1")]);
  render([update("e1", "Aankomst", "everyone", { media_asset_ids: ["p1"] })]);
  await screen.findByRole("list", { name: "Foto's bij Aankomst" });
  await waitFor(() => expect(api.count("GET /api/trips/trip/media/p1/derivatives")).toBe(1));
  expect(api.count("GET /files/p1-thumb")).toBe(0);
});

it("uses a translated generic label for a photo without alt text or caption, and includes attached media", async () => {
  seed([asset("p1")]);
  render([update("e1", "Aankomst", "everyone", { media_asset_ids: ["p1"] })]);
  const strip = await screen.findByRole("list", { name: "Foto's bij Aankomst" });
  await within(strip).findByRole("img", { name: "Foto bij Aankomst" });
});

it("shows four photos and the count of the rest", async () => {
  const assets = ["p1", "p2", "p3", "p4", "p5"].map((id) => asset(id));
  seed(
    assets,
    Object.fromEntries(
      assets.map((item) => [item.id, [copy(`c-${item.id}`, item.id, "e1", item.id)]]),
    ),
  );
  render([update("e1", "Aankomst"), update("e2", "Vertrek")]);
  const strip = await screen.findByRole("list", { name: "Foto's bij Aankomst" });
  await waitFor(() => expect(within(strip).getAllByRole("img")).toHaveLength(4));
  expect(within(strip).getByText("+1")).toBeTruthy();
  expect(within(strip).getByText("nog 1 foto")).toBeTruthy();
  // The other update has none of them.
  expect(screen.queryByRole("list", { name: "Foto's bij Vertrek" })).toBeNull();
});

it("previews as the public page for an update everyone sees, at that update, and returns focus", async () => {
  seed([]);
  render([update("e1", "Aankomst")]);
  const action = await screen.findByRole("button", { name: "Bekijk als bezoeker: Aankomst" });
  await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
  action.focus();
  fireEvent.click(action);
  const dialog = await screen.findByRole("dialog", { name: "Publieke preview" });
  expect(within(dialog).getByText("Weergegeven preview update-abc")).toBeTruthy();
  expect(api.count("POST /api/trips/trip/public-projection/preview")).toBe(1);
  expect(api.lastBody<ShareScope>("POST /api/trips/trip/public-projection/preview")).toEqual(
    status.scope,
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Publieke preview sluiten" }));
  await waitFor(() => expect(document.activeElement).toBe(action));
});

it("previews through a hidden link that delivers an update the public page does not", async () => {
  status = { ...status, surface_state: "unpublished" };
  links = [
    {
      id: "l1",
      series_id: "l1",
      label: "Familie",
      state: "active",
      scope: scope(["e1"]),
      token: "t",
    },
  ];
  seed([]);
  render([update("e1", "Aankomst", "custom")]);
  const action = await screen.findByRole("button", { name: "Bekijk als bezoeker: Aankomst" });
  await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(action);
  await screen.findByRole("dialog", { name: "Preview van Familie" });
  expect(api.count("POST /api/trips/trip/share-links/l1/preview")).toBe(1);
  expect(api.count("POST /api/trips/trip/public-projection/preview")).toBe(0);
});

it("disables the action with a reason for a private update", async () => {
  seed([]);
  render([update("e1", "Notitie", "private")]);
  const action = (await screen.findByRole("button", {
    name: "Bekijk als bezoeker: Notitie",
  })) as HTMLButtonElement;
  expect(action.disabled).toBe(true);
  const reason = await screen.findByText("Privé: niemand ziet deze update.");
  expect(action.getAttribute("aria-describedby")).toBe(reason.id);
});

it("disables the action when no audience lists a custom update or the visitor text is missing", async () => {
  seed([]);
  render([update("e1", "Eigen keuze", "custom"), update("e2", "Leeg", "everyone", { body: " " })]);
  await screen.findByText("Geen publiek ontvangt deze update al.");
  expect(screen.getByText("Schrijf eerst de tekst voor bezoekers.")).toBeTruthy();
  for (const name of ["Eigen keuze", "Leeg"])
    expect(
      (screen.getByRole("button", { name: `Bekijk als bezoeker: ${name}` }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
});
