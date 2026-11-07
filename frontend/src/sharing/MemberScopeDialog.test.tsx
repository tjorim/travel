// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { server } from "../mocks/server";
import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { ShareScope, Trip } from "../tracker-model";
import type { Collection, CollectionMember } from "./collections";
import { MemberScopeDialog } from "./MemberScopeDialog";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));
vi.mock("../trips/RenderedPreview", () => ({ RenderedPreview: () => <p>Weergegeven preview</p> }));

const scope = (exclude?: ShareScope["exclude"]): ShareScope => ({
  schema_version: "travel/share-scope@1",
  trip: { title: true, summary: true, dates: null },
  items: [],
  ...(exclude ? { exclude } : {}),
});
const trip = {
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [
    {
      id: "u2",
      occurred_at: "2054-11-16T10:00:00Z",
      date_precision: "day",
      title: "Aankomst",
      body: "Geland",
      private_notes: null,
      area_id: null,
      location: null,
      media_asset_ids: [],
      visibility: "everyone",
    },
  ],
} as unknown as Trip;
const member = {
  revision: 3,
  id: "m1",
  trip_id: "trip",
  trip_title: "Exampleland",
  scope: scope([{ kind: "travel_update", id: "u2" }]),
  delivered_records: 0,
  created_at: "2054-01-01T00:00:00Z",
  updated_at: "2054-01-01T00:00:00Z",
} as CollectionMember;
const collection = (state: Collection["state"]) =>
  ({ id: "c1", label: "Familie", state, members: [member] }) as unknown as Collection;

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi();
  for (const resource of ["areas", "locations", "routes", "visits", "stays", "media"])
    api.collection(`/api/trips/trip/${resource}`, []);
  api.on("POST", /\/share-scope\/exclusion-review$/, () => ({
    baseline: [{ kind: "travel_update", id: "u2" }],
    excluded: [],
    also_hidden: {},
    stale: 0,
  }));
  api.on("PUT", /\/api\/collections\/c1\/members\/m1/, () => collection("active"));
  api.install();
});
afterEach(() => {
  cleanup();
  expect(api.unexpected).toEqual([]);
});

it("leaves a record out of a collection member and asks before an active collection shows more", async () => {
  const refused = { calls: 0 };
  server.use(
    http.put(
      "/api/collections/c1/members/m1",
      () => {
        refused.calls += 1;
        return HttpResponse.json(
          {
            detail: {
              code: "exclusion_widening_needs_acknowledgement",
              revealed: [{ kind: "travel_update", id: "u2" }],
              counts: { travel_update: 1 },
            },
          },
          { status: 409 },
        );
      },
      { once: true },
    ),
  );
  renderWithOwner(
    <MemberScopeDialog
      collection={collection("active")}
      member={member}
      trip={trip}
      onClose={() => undefined}
    />,
  );
  const section = within(
    await screen.findByRole("region", { name: "Weggelaten voor dit publiek" }),
  );
  const checkbox = await section.findByRole("checkbox", { name: "Toon “Aankomst” op deze link" });
  // The member starts with the record left out; ticking it removes the exclusion, which widens the collection.
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Bereik opslaan" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Meer tonen op deze link?" });
  expect(refused.calls).toBe(1);
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Meer tonen" }));
  await waitFor(() =>
    expect(api.count("PUT /api/collections/c1/members/m1?confirm_widening=true")).toBe(1),
  );
  expect(
    api.lastBody<ShareScope>("PUT /api/collections/c1/members/m1?confirm_widening=true")?.exclude,
  ).toEqual([]);
  expect(
    api.lastHeaders("PUT /api/collections/c1/members/m1?confirm_widening=true")?.get("If-Match"),
  ).toBe('"3"');
});

it("saves a narrower member scope straight away, without the acknowledgement", async () => {
  renderWithOwner(
    <MemberScopeDialog
      collection={collection("active")}
      member={{ ...member, scope: scope() }}
      trip={trip}
      onClose={() => undefined}
    />,
  );
  const section = within(
    await screen.findByRole("region", { name: "Weggelaten voor dit publiek" }),
  );
  fireEvent.click(await section.findByRole("button", { name: /Reisupdates/ }));
  fireEvent.click(await section.findByRole("checkbox", { name: "Toon “Aankomst” op deze link" }));
  fireEvent.click(screen.getByRole("button", { name: "Bereik opslaan" }));
  await waitFor(() => expect(api.count("PUT /api/collections/c1/members/m1")).toBe(1));
  expect(api.lastBody<ShareScope>("PUT /api/collections/c1/members/m1")?.exclude).toEqual([
    { kind: "travel_update", id: "u2" },
  ]);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
