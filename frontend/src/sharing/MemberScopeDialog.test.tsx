import { responseFixtures } from "@/mocks/response-test-fixtures";
import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { server } from "../mocks/server";
import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { ShareScope, TripSummary } from "../api-types";
import type { Collection, CollectionMember } from "./collections";
import { MemberScopeDialog } from "./MemberScopeDialog";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("@/app/providers/auth-context", () => ({ useAuth: () => auth }));
vi.mock("@/components/projection/RenderedPreview", () => ({ RenderedPreview: () => <p>Weergegeven preview</p> }));

const scope = (exclude?: ShareScope["exclude"]): ShareScope => ({
  schema_version: "travel/share-scope@1",
  trip: { title: true, summary: true, dates: null },
  items: [],
  ...(exclude ? { exclude } : {}),
});
const trip = {
  ...responseFixtures.TripSummaryResponse,
  id: "trip",
  title: "Exampleland",
  summary: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [
    {
      ...responseFixtures.TravelUpdateResponse,
      id: "u2",
      occurred_at: "2054-11-16T10:00:00Z",

      title: "Aankomst",
      body: "Geland",
      private_notes: null,
      area_id: null,
      location: null,
      media_asset_ids: [],
      visibility: "everyone",
    },
  ],
} satisfies TripSummary & { travel_updates: Api.TravelUpdateResponse[] };
const member: CollectionMember = {
  ...responseFixtures.CollectionMemberResponse,
  revision: 3,
  id: "m1",
  trip_id: "trip",
  trip_title: "Exampleland",
  scope: scope([{ kind: "travel_update", id: "u2" }]),
  delivered_records: 0,
  created_at: "2054-01-01T00:00:00Z",
  updated_at: "2054-01-01T00:00:00Z",
};
const collection = (state: Collection["state"]) =>
  ({
    ...responseFixtures.CollectionResponse,
    id: "c1",
    label: "Familie",
    state,
    members: [member],
  }) satisfies Collection;

let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi();
  api.collection<Api.TravelUpdateResponse>("/api/trips/trip/travel-updates", trip.travel_updates);
  for (const resource of ["areas", "locations", "routes", "visits", "stays", "media"])
    api.collection<never>(`/api/trips/trip/${resource}`, []);
  api.on<Api.ExclusionReview>("POST", /\/share-scope\/exclusion-review$/, () => ({
    baseline: [{ kind: "travel_update", id: "u2" }],
    excluded: [],
    also_hidden: {},
    stale: 0,
  }));
  api.on<Api.CollectionResponse>("PUT", /\/api\/collections\/c1\/members\/m1/, () =>
    collection("active"),
  );
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
          /* Fixture exception: Error/control response: exercises failure handling rather than a successful API record. */
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

it("reviews and applies a preset to a collection member, then shows the scope the server answers with", async () => {
  const review: Api.SharingPresetReview = {
    schema_version: "travel/sharing-preset@1",
    preset: "story_only",
    audience: { id: "collection:m1", kind: "collection_member", label: "Familie", live: true },
    applicable: true,
    refusal: null,
    changes: [
      { day: null, kind: "travel_update", id: "u2", label: "Aankomst", action: "remove_exclusion" },
    ],
    change_counts: { remove_exclusion: 1 },
    precision: { before: null, after: "month", changed: true, reads_coarser: {} },
    comparison: {
      before: {},
      after: { travel_update: 1 },
      added: { travel_update: 1 },
      removed: {},
      widened: [{ day: null, kind: "travel_update", id: "u2", label: "Aankomst" }],
      narrowed: [],
    },
    left_as_is: [],
    needs_decision: [],
    replaces_exceptions: [
      {
        day: null,
        kind: "travel_update",
        id: "u2",
        label: "Aankomst",
        reason: "exclusion_removed",
      },
    ],
    requires_acknowledgement: true,
    fingerprint: "fp-member",
  };
  api.on<Api.SharingPresetReview>(
    "POST",
    /\/api\/collections\/c1\/members\/m1\/preset\/review$/,
    () => review,
  );
  api.on<Api.MemberPresetApplyResult>(
    "POST",
    /\/api\/collections\/c1\/members\/m1\/preset$/,
    () => ({
      applied: true,
      review,
      audience: { ...member, revision: 4, scope: scope([]), applied_preset: "story_only" },
    }),
  );
  renderWithOwner(
    <MemberScopeDialog
      collection={collection("active")}
      member={member}
      trip={trip}
      onClose={() => undefined}
    />,
  );
  fireEvent.click(await screen.findByRole("radio", { name: "Alleen het verhaal" }));
  fireEvent.click(screen.getByRole("button", { name: "Voorinstelling bekijken" }));
  const dialog = await screen.findByRole("alertdialog", {
    name: "“Alleen het verhaal” toepassen?",
  });
  // The collection is active and the preset shows its visitors more.
  const apply = within(dialog).getByRole("button", { name: "Voorinstelling toepassen" });
  expect(apply).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(apply);
  await waitFor(() => expect(api.count("POST /api/collections/c1/members/m1/preset")).toBe(1));
  expect(api.lastBody("POST /api/collections/c1/members/m1/preset")).toEqual({
    preset: "story_only",
    fingerprint: "fp-member",
    confirm_widening: true,
  });
  expect(api.lastHeaders("POST /api/collections/c1/members/m1/preset")?.get("If-Match")).toBe(
    '"3"',
  );
  // The exclusion the preset removed is gone from the editor.
  const section = within(
    await screen.findByRole("region", { name: "Weggelaten voor dit publiek" }),
  );
  const checkbox = await section.findByRole("checkbox", { name: "Toon “Aankomst” op deze link" });
  await waitFor(() => expect(checkbox.getAttribute("aria-checked")).toBe("true"));
});

it("reviews what the previewed member scope shows of a trip that has not started, as a link preview does", async () => {
  api.on<Api.ProjectionDocument>("POST", /\/api\/collections\/c1\/members\/m1\/preview$/, () => ({
    summary: null,
    dates: null,
    visits: [],
    places: [],
    updates: [],
    stays: [],
    media: [],
    routes: [],
    navigation: [],
    summary_html: null,
    summary_text: null,
    cover: null,
    schema_version: "travel/unlisted-trip@1",
    title: "Exampleland",
  }));
  api.on<Api.FutureDisclosure>(
    "POST",
    /\/api\/collections\/c1\/members\/m1\/future-disclosure$/,
    () => ({
      transport: 2,
      day_dates: 1,
    }),
  );
  renderWithOwner(
    <MemberScopeDialog
      collection={collection("active")}
      member={member}
      trip={trip}
      onClose={() => undefined}
    />,
  );
  await screen.findByRole("region", { name: "Weggelaten voor dit publiek" });
  // Nothing is reviewed before the owner asks for the preview.
  expect(api.count("POST /api/collections/c1/members/m1/future-disclosure")).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld" }));
  expect(await screen.findByText(/Verzamellink “Familie” kan vóór de reis lezen/)).toBeTruthy();
  expect(screen.getByText(/Verzamellink “Familie” toont datums per dag/)).toBeTruthy();
  // The candidate scope that was previewed is the one counted, and nothing is saved.
  expect(api.lastBody<ShareScope>("POST /api/collections/c1/members/m1/future-disclosure")).toEqual(
    member.scope,
  );
  expect(api.count("PUT /api/collections/c1/members/m1")).toBe(0);
});

it("previews the member in the other language from the same candidate scope", async () => {
  api.on<Api.ProjectionDocument>(
    "POST",
    /\/api\/collections\/c1\/members\/m1\/preview(\?lang=\w+)?$/,
    () => ({
      summary: null,
      dates: null,
      visits: [],
      places: [],
      updates: [],
      stays: [],
      media: [],
      routes: [],
      navigation: [],
      summary_html: null,
      summary_text: null,
      cover: null,
      schema_version: "travel/unlisted-trip@1",
      title: "Exampleland",
    }),
  );
  api.on<Api.FutureDisclosure>(
    "POST",
    /\/api\/collections\/c1\/members\/m1\/future-disclosure$/,
    () => ({
      transport: 0,
      day_dates: 0,
    }),
  );
  renderWithOwner(
    <MemberScopeDialog
      collection={collection("active")}
      member={member}
      trip={{ ...trip, content_language: "nl" } as TripSummary}
      onClose={() => undefined}
    />,
  );
  await screen.findByRole("region", { name: "Weggelaten voor dit publiek" });
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld" }));
  const languages = within(
    await screen.findByRole("radiogroup", { name: "Taal van het voorbeeld" }),
  );
  // The first preview is the trip's own language: nothing is asked for.
  expect(api.count("POST /api/collections/c1/members/m1/preview")).toBe(1);
  expect(languages.getByRole("radio", { name: "Nederlands" }).getAttribute("aria-checked")).toBe(
    "true",
  );
  fireEvent.click(languages.getByRole("radio", { name: "Engels" }));
  await waitFor(() =>
    expect(api.count("POST /api/collections/c1/members/m1/preview?lang=en")).toBe(1),
  );
  expect(api.lastBody<ShareScope>("POST /api/collections/c1/members/m1/preview?lang=en")).toEqual(
    member.scope,
  );
});

it("ignores a member preview that arrives after a newer one", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const asked: (string | null)[] = [];
  server.use(
    http.post("/api/collections/c1/members/m1/preview", async ({ request }) => {
      const language = new URL(request.url).searchParams.get("lang");
      asked.push(language);
      // The first English answer is the slow one.
      if (language === "en" && asked.filter((item) => item === "en").length === 1) await gate;
      return HttpResponse.json<Api.ProjectionDocument>({
        ...responseFixtures.ProjectionDocument,
        schema_version: "travel/unlisted-trip@1",
        title: "Exampleland",
      });
    }),
  );
  api.on<Api.FutureDisclosure>(
    "POST",
    /\/api\/collections\/c1\/members\/m1\/future-disclosure$/,
    () => ({
      transport: 0,
      day_dates: 0,
    }),
  );
  renderWithOwner(
    <MemberScopeDialog
      collection={collection("active")}
      member={member}
      trip={{ ...trip, content_language: "nl" } as TripSummary}
      onClose={() => undefined}
    />,
  );
  await screen.findByRole("region", { name: "Weggelaten voor dit publiek" });
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld" }));
  const languages = within(
    await screen.findByRole("radiogroup", { name: "Taal van het voorbeeld" }),
  );
  const checked = (name: string) =>
    languages.getByRole("radio", { name }).getAttribute("aria-checked") === "true";
  // English is asked for and is slow; it is asked for again, and then Dutch, and those answer first.
  fireEvent.click(languages.getByRole("radio", { name: "Engels" }));
  fireEvent.click(languages.getByRole("radio", { name: "Engels" }));
  await waitFor(() => expect(checked("Engels")).toBe(true));
  fireEvent.click(languages.getByRole("radio", { name: "Nederlands" }));
  await waitFor(() => expect(asked).toEqual([null, "en", "en", "nl"]));
  await waitFor(() => expect(checked("Nederlands")).toBe(true));
  release();
  await act(async () => {
    await gate;
  });
  expect(checked("Nederlands")).toBe(true);
  expect(checked("Engels")).toBe(false);
});

it("shows no review when the previewed member scope shows nothing of the future", async () => {
  api.on<Api.ProjectionDocument>("POST", /\/api\/collections\/c1\/members\/m1\/preview$/, () => ({
    summary: null,
    dates: null,
    visits: [],
    places: [],
    updates: [],
    stays: [],
    media: [],
    routes: [],
    navigation: [],
    summary_html: null,
    summary_text: null,
    cover: null,
    schema_version: "travel/unlisted-trip@1",
    title: "Exampleland",
  }));
  api.on<Api.FutureDisclosure>(
    "POST",
    /\/api\/collections\/c1\/members\/m1\/future-disclosure$/,
    () => ({
      transport: 0,
      day_dates: 0,
    }),
  );
  renderWithOwner(
    <MemberScopeDialog
      collection={collection("active")}
      member={member}
      trip={trip}
      onClose={() => undefined}
    />,
  );
  await screen.findByRole("region", { name: "Weggelaten voor dit publiek" });
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld" }));
  await waitFor(() =>
    expect(api.count("POST /api/collections/c1/members/m1/future-disclosure")).toBe(1),
  );
  expect(screen.getByText("Weergegeven preview")).toBeTruthy();
  expect(screen.queryByText(/kan vóór de reis lezen/)).toBeNull();
});

it("says when the member review fails, never as an empty review, and retries it", async () => {
  api.on<Api.ProjectionDocument>("POST", /\/api\/collections\/c1\/members\/m1\/preview$/, () => ({
    summary: null,
    dates: null,
    visits: [],
    places: [],
    updates: [],
    stays: [],
    media: [],
    routes: [],
    navigation: [],
    summary_html: null,
    summary_text: null,
    cover: null,
    schema_version: "travel/unlisted-trip@1",
    title: "Exampleland",
  }));
  server.use(
    http.post(
      "/api/collections/c1/members/m1/future-disclosure",
      () =>
        HttpResponse.json(
          /* Fixture exception: Error/control response: exercises failure handling rather than a successful API record. */ {
            detail: "Boom",
          },
          { status: 500 },
        ),
      { once: true },
    ),
  );
  api.on<Api.FutureDisclosure>(
    "POST",
    /\/api\/collections\/c1\/members\/m1\/future-disclosure$/,
    () => ({
      transport: 1,
      day_dates: 0,
    }),
  );
  renderWithOwner(
    <MemberScopeDialog
      collection={collection("active")}
      member={member}
      trip={trip}
      onClose={() => undefined}
    />,
  );
  await screen.findByRole("region", { name: "Weggelaten voor dit publiek" });
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld" }));
  const failed = await screen.findByRole("alert");
  expect(failed.textContent).toMatch(/kon niet worden gecontroleerd/);
  expect(screen.queryByText(/kan vóór de reis lezen/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
  expect(await screen.findByText(/Verzamellink “Familie” kan vóór de reis lezen/)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("counts the review again for each preview, also when the scope did not change", async () => {
  api.on<Api.ProjectionDocument>("POST", /\/api\/collections\/c1\/members\/m1\/preview$/, () => ({
    summary: null,
    dates: null,
    visits: [],
    places: [],
    updates: [],
    stays: [],
    media: [],
    routes: [],
    navigation: [],
    summary_html: null,
    summary_text: null,
    cover: null,
    schema_version: "travel/unlisted-trip@1",
    title: "Exampleland",
  }));
  let transport = 1;
  api.on<Api.FutureDisclosure>(
    "POST",
    /\/api\/collections\/c1\/members\/m1\/future-disclosure$/,
    () => ({
      transport: transport++,
      day_dates: 0,
    }),
  );
  renderWithOwner(
    <MemberScopeDialog
      collection={collection("active")}
      member={member}
      trip={trip}
      onClose={() => undefined}
    />,
  );
  await screen.findByRole("region", { name: "Weggelaten voor dit publiek" });
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld" }));
  expect(await screen.findByText(/1 vervoersverbinding met tijd/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Voorbeeld" }));
  expect(await screen.findByText(/2 vervoersverbindingen met tijd/)).toBeTruthy();
  expect(api.count("POST /api/collections/c1/members/m1/future-disclosure")).toBe(2);
});
