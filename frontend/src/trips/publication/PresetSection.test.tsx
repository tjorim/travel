// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { server } from "../../mocks/server";
import { m } from "../../paraglide/messages.js";
import { renderWithOwner, testToken } from "../../query/test-utils";
import type {
  PresetExceptions,
  ShareLink,
  ShareScope,
  SharingPresetId,
  SharingPresetReview,
} from "../../api-types";
import type { CatalogItem } from "./catalog";
import type { ScopePreset } from "./PresetSection";
import { ScopeEditor } from "./ScopeEditor";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../../auth-context", () => ({ useAuth: () => auth }));

const scope = (extra: Partial<ShareScope> = {}): ShareScope => ({
  schema_version: "travel/share-scope@1",
  trip: { title: true, summary: true, dates: null },
  items: [],
  ...extra,
});

const arrival = { kind: "travel_update", id: "u1", label: "Aankomst", day: null } as const;
const market = { kind: "visit", id: "v1", label: "Nachtmarkt", day: null } as const;

const catalog: CatalogItem[] = [
  { kind: "travel_update", id: "u1", label: "Aankomst", detail: "", visibility: "custom" },
  { kind: "travel_update", id: "u2", label: "Dagboek", detail: "", visibility: "private" },
  { kind: "visit", id: "v1", label: "Nachtmarkt", detail: "", visibility: "everyone" },
];

const review = (overrides: Partial<SharingPresetReview> = {}): SharingPresetReview => ({
  schema_version: "travel/sharing-preset@1",
  preset: "story_and_route",
  audience: { id: "link:l1", kind: "link", label: "Familie", live: false },
  applicable: true,
  refusal: null,
  changes: [{ ...arrival, action: "list" }],
  change_counts: { list: 1 },
  precision: { before: null, after: "month", changed: true, reads_coarser: { visit: 2 } },
  comparison: {
    before: {},
    after: { travel_update: 1 },
    added: { travel_update: 1 },
    removed: { visit: 1 },
    widened: [arrival],
    narrowed: [market],
  },
  left_as_is: [],
  needs_decision: [],
  replaces_exceptions: [],
  requires_acknowledgement: false,
  fingerprint: "fp-1",
  ...overrides,
});

const link = (overrides: Partial<ShareLink> = {}): ShareLink =>
  ({
    revision: 2,
    id: "l1",
    series_id: "l1",
    label: "Familie",
    state: "draft",
    token: null,
    expires_at: null,
    created_at: "2054-01-01T00:00:00Z",
    activated_at: null,
    revoked_at: null,
    scope: scope({ items: [{ kind: "travel_update", id: "u1" }] }),
    applied_preset: "story_and_route",
    applied_preset_at: "2054-01-02T00:00:00Z",
    preset_exceptions: { shown: [], hidden: [], count: 0 },
    ...overrides,
  }) as ShareLink;

const onApplied = vi.fn();
const onReload = vi.fn();
const onError = vi.fn();

function Host({
  initial = scope(),
  allowExclusions = true,
  label = null,
  dirty,
  creation,
  target = { kind: "link", linkId: "l1" },
  revision = 2,
}: {
  initial?: ShareScope;
  allowExclusions?: boolean;
  label?: ScopePreset["label"];
  /** Defaults to whether the editor's scope differs from the one it started with, as the real forms do. */
  dirty?: boolean;
  creation?: ScopePreset["creation"];
  target?: ScopePreset["target"];
  revision?: number;
}) {
  const [current, setCurrent] = useState(initial);
  return (
    <>
      <ScopeEditor
        name="Familie"
        scope={current}
        setScope={setCurrent}
        catalog={catalog}
        hasDates={false}
        tripId="trip"
        onError={onError}
        allowExclusions={allowExclusions}
        preset={{
          target,
          revision: () => revision,
          label,
          dirty: dirty ?? JSON.stringify(current) !== JSON.stringify(initial),
          ...(creation ? { creation } : {}),
          onApplied,
          onReload,
        }}
      />
      <output data-testid="scope">{JSON.stringify(current)}</output>
    </>
  );
}

const draftScope = () => JSON.parse(screen.getByTestId("scope").textContent ?? "{}") as ShareScope;
const choose = (name: SharingPresetId) =>
  fireEvent.click(screen.getByRole("radio", { name: presetNames[name] }));
const presetNames = {
  story_only: "Alleen het verhaal",
  story_and_route: "Verhaal en route",
  planned_trip: "Geplande reis",
};

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  onApplied.mockReset();
  onReload.mockReset();
  onError.mockReset();
  server.use(
    http.post("/api/trips/trip/share-scope/exclusion-review", () =>
      HttpResponse.json({ baseline: [], excluded: [], also_hidden: {}, stale: 0 }),
    ),
  );
});
afterEach(() => cleanup());

it("reviews a chosen preset, lists what changes and applies it with the review's fingerprint and the revision", async () => {
  let applied: { body: unknown; ifMatch: string | null } | null = null;
  server.use(
    http.post("/api/trips/trip/share-links/l1/preset/review", async ({ request }) => {
      expect(await request.json()).toEqual({ preset: "story_and_route" });
      return HttpResponse.json(review());
    }),
    http.post("/api/trips/trip/share-links/l1/preset", async ({ request }) => {
      applied = { body: await request.json(), ifMatch: request.headers.get("If-Match") };
      return HttpResponse.json({ applied: true, review: review(), audience: link() });
    }),
    http.get("/api/trips/trip", () => HttpResponse.json({})),
  );
  renderWithOwner(<Host />);
  const reviewButton = screen.getByRole("button", { name: "Voorinstelling bekijken" });
  // Nothing is chosen yet.
  expect(reviewButton).toBeDisabled();
  choose("story_and_route");
  expect(reviewButton).toBeEnabled();
  fireEvent.click(reviewButton);

  const dialog = await screen.findByRole("alertdialog", { name: "“Verhaal en route” toepassen?" });
  const text = within(dialog);
  expect(text.getByText("Krijgt er bij: 1 reisupdate")).toBeInTheDocument();
  expect(text.getByText("Krijgt niet meer: 1 bezoek")).toBeInTheDocument();
  expect(text.getByText("Aankomst")).toBeInTheDocument();
  expect(text.getByText("Nachtmarkt")).toBeInTheDocument();
  // A draft delivers nothing yet, so there is no acknowledgement to give.
  expect(text.queryByRole("checkbox")).toBeNull();
  expect(text.getByText(/Datums voor dit publiek gaan van geen limiet naar maanden/)).toBeVisible();
  fireEvent.click(text.getByRole("button", { name: "Voorinstelling toepassen" }));

  await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  expect(applied).toEqual({
    body: { preset: "story_and_route", fingerprint: "fp-1", confirm_widening: false },
    ifMatch: '"2"',
  });
  expect(onApplied.mock.calls[0]![0]).toMatchObject({
    id: "l1",
    applied_preset: "story_and_route",
  });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByText("“Verhaal en route” toegepast.")).toBeInTheDocument();
});

it("asks for the widening acknowledgement before it applies to a live audience", async () => {
  const bodies: unknown[] = [];
  server.use(
    http.post("/api/trips/trip/share-links/l1/preset/review", () =>
      HttpResponse.json(
        review({
          audience: { id: "link:l1", kind: "link", label: "Familie", live: true },
          requires_acknowledgement: true,
        }),
      ),
    ),
    http.post("/api/trips/trip/share-links/l1/preset", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ applied: true, review: review(), audience: link() });
    }),
  );
  renderWithOwner(<Host />);
  choose("story_and_route");
  fireEvent.click(screen.getByRole("button", { name: "Voorinstelling bekijken" }));
  const dialog = await screen.findByRole("alertdialog");
  const apply = within(dialog).getByRole("button", { name: "Voorinstelling toepassen" });
  expect(within(dialog).getByText(/zien 1 reisupdate die ze nu niet zien/)).toBeInTheDocument();
  expect(apply).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("checkbox"));
  expect(apply).toBeEnabled();
  fireEvent.click(apply);
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ confirm_widening: true });
});

it("shows the fresh review and asks again when the records changed since the review", async () => {
  let calls = 0;
  server.use(
    http.post("/api/trips/trip/share-links/l1/preset/review", () =>
      HttpResponse.json(
        review({
          audience: { id: "link:l1", kind: "link", label: "Familie", live: true },
          requires_acknowledgement: true,
        }),
      ),
    ),
    http.post("/api/trips/trip/share-links/l1/preset", () => {
      calls += 1;
      if (calls === 1)
        return HttpResponse.json(
          {
            detail: {
              code: "preset_preview_is_stale",
              review: review({
                audience: { id: "link:l1", kind: "link", label: "Familie", live: true },
                requires_acknowledgement: true,
                fingerprint: "fp-2",
                comparison: {
                  before: {},
                  after: { travel_update: 2 },
                  added: { travel_update: 2 },
                  removed: {},
                  widened: [
                    arrival,
                    { kind: "travel_update", id: "u2", label: "Dagboek", day: null },
                  ],
                  narrowed: [],
                },
              }),
            },
          },
          { status: 409 },
        );
      return HttpResponse.json({ applied: true, review: review(), audience: link() });
    }),
  );
  renderWithOwner(<Host />);
  choose("story_and_route");
  fireEvent.click(screen.getByRole("button", { name: "Voorinstelling bekijken" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorinstelling toepassen" }));

  expect(await within(dialog).findByText(/De onderdelen zijn veranderd/)).toBeInTheDocument();
  expect(within(dialog).getByText("Krijgt er bij: 2 reisupdates")).toBeInTheDocument();
  // The acknowledgement belonged to the old review and is asked for again.
  expect(within(dialog).getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  expect(within(dialog).getByRole("button", { name: "Voorinstelling toepassen" })).toBeDisabled();
  expect(onApplied).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorinstelling toepassen" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
});

it("explains a preset that is too large and never offers to apply it", async () => {
  server.use(
    http.post("/api/trips/trip/share-links/l1/preset/review", () =>
      HttpResponse.json(
        review({
          applicable: false,
          comparison: null,
          refusal: {
            code: "preset_too_large",
            items: 230,
            exclude: 10,
            max_items: 200,
            max_exclude: 500,
          },
        }),
      ),
    ),
  );
  renderWithOwner(<Host />);
  choose("planned_trip");
  fireEvent.click(screen.getByRole("button", { name: "Voorinstelling bekijken" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText(/te groot voor één publiek/)).toHaveTextContent("230");
  expect(within(dialog).getByRole("button", { name: "Voorinstelling toepassen" })).toBeDisabled();
});

it("turns a too-large refusal at apply time into the same explanation", async () => {
  server.use(
    http.post("/api/trips/trip/share-links/l1/preset/review", () => HttpResponse.json(review())),
    http.post("/api/trips/trip/share-links/l1/preset", () =>
      HttpResponse.json(
        {
          detail: {
            code: "preset_too_large",
            items: 201,
            exclude: 0,
            max_items: 200,
            max_exclude: 500,
          },
        },
        { status: 409 },
      ),
    ),
  );
  renderWithOwner(<Host />);
  choose("planned_trip");
  fireEvent.click(screen.getByRole("button", { name: "Voorinstelling bekijken" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorinstelling toepassen" }));
  expect(await within(dialog).findByText(/te groot voor één publiek/)).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Voorinstelling toepassen" })).toBeDisabled();
});

it("offers to reload when the audience changed elsewhere", async () => {
  const current = link({ revision: 5 });
  server.use(
    http.post("/api/trips/trip/share-links/l1/preset/review", () => HttpResponse.json(review())),
    http.post("/api/trips/trip/share-links/l1/preset", () =>
      HttpResponse.json({ detail: { code: "scope_revision_conflict", current } }, { status: 412 }),
    ),
  );
  renderWithOwner(<Host />);
  choose("story_only");
  fireEvent.click(screen.getByRole("button", { name: "Voorinstelling bekijken" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Voorinstelling toepassen" }));
  expect(await within(dialog).findByText(/elders gewijzigd/)).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Voorinstelling toepassen" })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Publiek opnieuw laden" }));
  expect(onReload).toHaveBeenCalledWith(expect.objectContaining({ id: "l1", revision: 5 }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(onApplied).not.toHaveBeenCalled();
});

it("lists what is left as it is with the way out, and what needs a decision", async () => {
  server.use(
    http.post("/api/trips/trip/public-projection/preset/review", () =>
      HttpResponse.json(
        review({
          left_as_is: [
            { ...market, reason: "everyone_on_public_view", way_out: "change_visibility" },
          ],
          needs_decision: [{ ...arrival, reason: "share_time_is_on" }],
          replaces_exceptions: [{ ...arrival, reason: "left_out_by_you" }],
        }),
      ),
    ),
  );
  renderWithOwner(<Host allowExclusions={false} target={{ kind: "public" }} />);
  choose("story_and_route");
  fireEvent.click(screen.getByRole("button", { name: "Voorinstelling bekijken" }));
  const dialog = await screen.findByRole("alertdialog");
  const text = within(dialog);
  expect(text.getByText("Blijft zoals het is")).toBeInTheDocument();
  expect(text.getByText(/Wijzig de eigen zichtbaarheid van het onderdeel/)).toBeInTheDocument();
  expect(text.getByText("Niet opgenomen, jij beslist")).toBeInTheDocument();
  expect(text.getByText(/toont de tijd/)).toBeInTheDocument();
  expect(text.getByText("Keuzes die je zelf maakte en die dit terugzet")).toBeInTheDocument();
  expect(text.getByText(/niet vermeld voor dit publiek/)).toBeInTheDocument();
});

it("blocks the review while the editor has unsaved edits", () => {
  renderWithOwner(<Host dirty />);
  choose("story_only");
  expect(screen.getByRole("button", { name: "Voorinstelling bekijken" })).toBeDisabled();
  expect(screen.getByText(/Sla je wijzigingen eerst op/)).toBeInTheDocument();
});

it("returns focus to the review button when the dialog is cancelled", async () => {
  server.use(
    http.post("/api/trips/trip/share-links/l1/preset/review", () => HttpResponse.json(review())),
  );
  renderWithOwner(<Host />);
  choose("story_only");
  const button = screen.getByRole("button", { name: "Voorinstelling bekijken" });
  button.focus();
  fireEvent.click(button);
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(button).toHaveFocus());
});

it("says which preset an audience carries, with its exceptions and the way to resolve them", async () => {
  const exceptions: PresetExceptions = {
    shown: [arrival],
    hidden: [
      { kind: "travel_update", id: "u2", label: "Dagboek", day: null },
      { kind: "visit", id: "v1", label: "Nachtmarkt", day: null },
    ],
    count: 3,
  };
  let promoted = 0;
  server.use(
    http.put("/api/trips/trip/visibility/travel_update/u2", () => {
      promoted += 1;
      return HttpResponse.json({ visibility: "custom" });
    }),
  );
  renderWithOwner(
    <Host
      initial={scope({ items: [{ kind: "travel_update", id: "u1" }] })}
      label={{
        applied_preset: "story_and_route",
        applied_preset_at: "2054-01-02T00:00:00Z",
        preset_exceptions: exceptions,
      }}
    />,
  );
  expect(screen.getByText("Verhaal en route, met 3 uitzonderingen")).toBeInTheDocument();
  const section = within(screen.getByRole("region", { name: "Anders dan de voorinstelling" }));
  // A new record never joins a preset, and the section says so.
  expect(section.getByText(/Een onderdeel dat je later toevoegt/)).toBeInTheDocument();

  // Hide a listed update: it is unlisted in the draft scope, which the owner saves like any other edit.
  fireEvent.click(section.getByRole("button", { name: "Verberg “Aankomst” voor dit publiek" }));
  expect(draftScope().items).toEqual([]);
  expect(await section.findByText("Wijziging nog niet opgeslagen")).toBeInTheDocument();

  // Show a private update: it is promoted to Custom first, then listed, as in the Advanced lists.
  fireEvent.click(section.getByRole("button", { name: "Toon “Dagboek” aan dit publiek" }));
  await waitFor(() => expect(draftScope().items).toEqual([{ kind: "travel_update", id: "u2" }]));
  expect(promoted).toBe(1);
});

it("unticks and re-ticks an Everyone record on a link through its exclusion", () => {
  renderWithOwner(
    <Host
      label={{
        applied_preset: "story_only",
        applied_preset_at: null,
        preset_exceptions: {
          shown: [market],
          hidden: [],
          count: 1,
        },
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Verberg “Nachtmarkt” voor dit publiek" }));
  expect(draftScope().exclude).toEqual([{ kind: "visit", id: "v1" }]);
});

it("points to the record's own visibility for an Everyone record on the public view", () => {
  renderWithOwner(
    <Host
      allowExclusions={false}
      target={{ kind: "public" }}
      label={{
        applied_preset: "story_only",
        applied_preset_at: null,
        preset_exceptions: { shown: [market], hidden: [], count: 1 },
      }}
    />,
  );
  expect(screen.queryByRole("button", { name: /Verberg “Nachtmarkt”/ })).toBeNull();
  expect(
    screen.getByText(/Staat op Iedereen, dus de openbare pagina toont het altijd/),
  ).toBeInTheDocument();
});

it("lets a link that is not saved yet start from the public page or a preset, without a review", () => {
  const onChange = vi.fn();
  renderWithOwner(<Host target={null} creation={{ value: null, onChange }} />);
  expect(screen.getByRole("radio", { name: m.preset_none() })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(screen.queryByRole("button", { name: "Voorinstelling bekijken" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Alleen het verhaal" }));
  expect(onChange).toHaveBeenCalledWith("story_only");
});
