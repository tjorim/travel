import type { ErrorFallback } from "../query/api";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorNotice, useFeedback, FeedbackError, textNotice } from "../query/feedback";
import { TravelCheckbox } from "../ui/TravelCheckbox";
import { Input } from "@base-ui/react/input";
import { Button } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { RecordForm, requiredText, SearchSelect, TextField } from "../forms/fields";
import { useConfirmation } from "../forms/useConfirmation";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import {
  derivativesQueryOptions,
  tripPath,
  useOwner,
  useOwnerMutation,
  useTripResource,
} from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import { RenderedPreview } from "./RenderedPreview";
import { useSetVisibility, VisibilityControl } from "./visibility";
import type { Projection } from "../ProjectionView";
import {
  formatInstantDate,
  ROUTE_MODE_LABELS,
  routeTitle,
  stayLabel,
  visitTitle,
  type ProjectionDocument,
  type PublicProjectionStatus,
  type ShareLink,
  type ShareScope,
  type ShareScopeKind,
  type Trip,
  type TripOverview,
  type OverviewAudience,
  type OverviewWarning,
  type Visibility,
} from "../tracker-model";
import { Field, FieldLabel, FieldSet, FieldLegend } from "../ui/field";

type CatalogItem = {
  kind: ShareScopeKind;
  id: string;
  label: string;
  detail: string;
  visibility: Visibility;
  /** A photo attached to a reisupdate is shared with it, so it has no choice of its own. */ followsUpdate?: string;
};

const LINK_STATE_LABELS: Record<ShareLink["state"], string> = {
  get draft() {
    return m.assets_draft();
  },
  get active() {
    return m.assets_active();
  },
  get revoked() {
    return m.assets_revoked();
  },
  get expired() {
    return m.assets_expired();
  },
};

const GROUP_TITLES: Record<ShareScopeKind, string> = {
  get travel_update() {
    return m.owner_travel_updates();
  },
  get visit() {
    return m.owner_visits();
  },
  get area() {
    return m.owner_areas();
  },
  get location() {
    return m.owner_locations();
  },
  get route() {
    return m.owner_routes();
  },
  get stay() {
    return m.owner_stays();
  },
  get media_derivative() {
    return m.assets_photos_and_videos();
  },
};

const DATE_PRECISIONS = {
  get day() {
    return m.owner_full_dates();
  },
  get month() {
    return m.owner_months_only();
  },
  get year() {
    return m.owner_year_only();
  },
} as const;

const emptyScope = (): ShareScope => ({
  schema_version: "travel/share-scope@1",
  trip: { title: true, summary: true, dates: null },
  items: [],
});
function cloneScope(scope: Partial<ShareScope> | null | undefined): ShareScope {
  return {
    schema_version: "travel/share-scope@1",
    trip: {
      title: scope?.trip?.title ?? true,
      summary: scope?.trip?.summary ?? true,
      dates: scope?.trip?.dates ?? null,
    },
    items: Array.isArray(scope?.items) ? scope.items.map(({ kind, id }) => ({ kind, id })) : [],
  };
}

function shareUrl(token: string): string {
  return new URL(`/share/${encodeURIComponent(token)}`, window.location.origin).toString();
}

function publicUrl(slug: string): string {
  return new URL(`/trips/${encodeURIComponent(slug)}`, window.location.origin).toString();
}

function dateLabel(value: string | null): string {
  return value ? formatInstantDate(value) : "—";
}

function projectionSummary(document: ProjectionDocument): string {
  const count =
    document.visits.length +
    document.places.length +
    document.updates.length +
    document.stays.length +
    document.media.length +
    document.routes.length;
  return m.assets_projection_summary({
    count,
    title: document.title ? m.assets_title() : m.assets_no_title(),
    summary: document.summary ? m.assets_summary() : m.assets_no_summary(),
    dates: document.dates ? m.assets_dates() : m.assets_no_travel_dates(),
  });
}

function updateItem(scope: ShareScope, item: CatalogItem, included: boolean): ShareScope {
  const current = scope.items.find((value) => value.kind === item.kind && value.id === item.id);
  const items = included
    ? current
      ? scope.items
      : [...scope.items, { kind: item.kind, id: item.id }]
    : scope.items.filter((value) => value !== current);
  return { ...scope, items };
}

const groupBy = (items: CatalogItem[]) =>
  items.reduce<Map<ShareScopeKind, CatalogItem[]>>(
    (map, item) => map.set(item.kind, [...(map.get(item.kind) ?? []), item]),
    new Map(),
  );

/**
 * One kind of record an audience can list. Collapsed so a long list stays a short page; the count says what is
 * chosen. A still-private record can be chosen directly here: checking it promotes it to "Zelf kiezen" first, then
 * adds it to this audience's scope, so choosing content for an audience never requires leaving this form.
 */
function ScopeGroup({
  kind,
  items,
  scope,
  setScope,
  tripId,
  onError,
}: {
  kind: ShareScopeKind;
  items: CatalogItem[];
  scope: ShareScope;
  setScope: (scope: ShareScope) => void;
  tripId: string;
  onError: (error: unknown) => void;
}) {
  useLocale();
  const setVisibility = useSetVisibility(tripId);
  const [busy, setBusy] = useState(false);
  const chosen = (item: CatalogItem) =>
    scope.items.some((value) => value.kind === item.kind && value.id === item.id);
  const count = items.filter(chosen).length;

  /** Promotes each record on its own, so one that cannot be shared yet does not hold back the rest. */
  async function promote(toPromote: CatalogItem[]): Promise<CatalogItem[]> {
    if (!toPromote.length) return [];
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        toPromote.map((item) =>
          setVisibility.mutateAsync({ kind: item.kind, id: item.id, visibility: "custom" }),
        ),
      );
      const failed = results.flatMap((result, index) =>
        result.status === "rejected"
          ? [{ item: toPromote[index]!, reason: result.reason as unknown }]
          : [],
      );
      if (failed.length)
        onError(
          new FeedbackError(() =>
            m.api_selection_failed({
              count: failed.length,
              labels: failed.map(({ item }) => `“${item.label}”`).join(", "),
              reason: errorMessage(failed[0]!.reason, m.api_operation_failed()),
            }),
          ),
        );
      return toPromote.filter((_, index) => results[index]!.status === "fulfilled");
    } finally {
      setBusy(false);
    }
  }

  async function include(item: CatalogItem, checked: boolean) {
    if (checked && item.visibility === "private" && !(await promote([item])).length) return;
    setScope(updateItem(scope, item, checked));
  }

  async function chooseAll() {
    const promoted = await promote(
      items.filter((item) => item.visibility === "private" && !chosen(item)),
    );
    setScope(
      items
        .filter((item) => item.visibility !== "private" || chosen(item) || promoted.includes(item))
        .reduce((current, item) => updateItem(current, item, true), scope),
    );
  }

  return (
    <Collapsible.Root className="scope-group" data-disclosure="">
      <Collapsible.Trigger>
        <strong>{GROUP_TITLES[kind]}</strong>
        <span>{m.assets_of_selected_line({ p0: count, p1: items.length })}</span>
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="grid gap-2.5 px-3.25 pt-0 pb-3.25">
        <div className="button-row">
          <Button
            className="secondary compact"
            type="button"
            disabled={busy || count === items.length}
            onClick={() => void chooseAll()}
          >
            {m.assets_select_all()}
          </Button>
          <Button
            className="secondary compact"
            type="button"
            disabled={busy || count === 0}
            onClick={() =>
              setScope(items.reduce((current, item) => updateItem(current, item, false), scope))
            }
          >
            {m.assets_select_none()}
          </Button>
        </div>
        <div className="grid gap-2">
          {items.map((item) => (
            <article
              className="scope-item"
              data-included={chosen(item) ? "" : undefined}
              key={`${item.kind}-${item.id}`}
            >
              <Field className="contents">
                <FieldLabel className="scope-choice">
                  <TravelCheckbox
                    checked={chosen(item)}
                    disabled={busy}
                    onCheckedChange={(checked) => void include(item, checked)}
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                    {item.visibility === "private" && (
                      <em className="text-xs font-medium not-italic text-travel-muted">
                        {" "}
                        {m.assets_currently_private_selecting_includes_this_for_this_audience()}
                      </em>
                    )}
                  </span>
                </FieldLabel>
              </Field>
            </article>
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

/** What every audience gets without being chosen: the same setting as on each record, kept out of the lists below. */
function VisibilityNote({ catalog }: { catalog: CatalogItem[] }) {
  useLocale();
  const own = catalog.filter((item) => !item.followsUpdate);
  if (!own.length) return null;
  const everyone = own.filter((item) => item.visibility === "everyone").length;
  const privateCount = own.filter((item) => item.visibility === "private").length;
  return (
    <p className="help">
      {m.assets_for_everyone_always_appears_here_you_can_select_private_items_bel_line({
        p0: everyone,
        p1: privateCount,
      })}
    </p>
  );
}

function ScopeEditor({
  scope,
  setScope,
  name,
  catalog,
  hasDates,
  tripId,
  onError,
  disabled = false,
}: {
  scope: ShareScope;
  setScope: (scope: ShareScope) => void;
  name: string;
  catalog: CatalogItem[];
  hasDates: boolean;
  tripId: string;
  onError: (error: unknown) => void;
  disabled?: boolean;
}) {
  useLocale();
  const groups = groupBy(catalog.filter((item) => item.visibility !== "everyone"));
  return (
    <FieldSet
      className="m-0 grid min-w-0 gap-3 rounded-xl border border-travel-divider p-3.75 [&>legend]:px-1.5 [&>legend]:font-extrabold [&>p]:m-0 [&>p]:text-sm"
      disabled={disabled}
    >
      <FieldLegend>{name}</FieldLegend>
      <p>{m.assets_choose_what_visitors_can_see_everything_you_do_not_select_stays_private()}</p>
      <div className="flex flex-wrap gap-x-3.5 gap-y-2">
        <Field className="contents">
          <FieldLabel className="scope-choice">
            <TravelCheckbox
              checked={scope.trip.title}
              onCheckedChange={(checked) =>
                setScope({ ...scope, trip: { ...scope.trip, title: checked } })
              }
            />
            {m.assets_trip_title()}
          </FieldLabel>
        </Field>
        <Field className="contents">
          <FieldLabel className="scope-choice">
            <TravelCheckbox
              checked={scope.trip.summary}
              onCheckedChange={(checked) =>
                setScope({ ...scope, trip: { ...scope.trip, summary: checked } })
              }
            />
            {m.owner_summary()}
          </FieldLabel>
        </Field>
        <Field>
          <FieldLabel>{m.assets_how_precise_can_the_travel_dates_be()}</FieldLabel>
          <SearchSelect
            ariaLabel={m.assets_how_precise_can_the_travel_dates_be()}
            value={scope.trip.dates ?? ""}
            onChange={(value) =>
              setScope({
                ...scope,
                trip: { ...scope.trip, dates: (value || null) as ShareScope["trip"]["dates"] },
              })
            }
          >
            <option value="">{m.assets_hide()}</option>
            {Object.entries(DATE_PRECISIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SearchSelect>
        </Field>
        {scope.trip.dates === "day" && (
          <small>{m.assets_visitors_see_the_start_and_end_day()}</small>
        )}
        {scope.trip.dates === "month" && (
          <small>{m.assets_visitors_see_only_the_start_and_end_month()}</small>
        )}
        {scope.trip.dates === "year" && (
          <small>{m.assets_visitors_see_only_the_travel_year()}</small>
        )}
        {scope.trip.dates && !hasDates && (
          <small>{m.assets_this_trip_has_no_travel_dates_yet()}</small>
        )}
      </div>
      <VisibilityNote catalog={catalog} />
      <div className="grid gap-2">
        {[...groups].map(([kind, items]) => (
          <ScopeGroup
            key={kind}
            kind={kind}
            items={items}
            scope={scope}
            setScope={setScope}
            tripId={tripId}
            onError={onError}
          />
        ))}
      </div>
      {!groups.size && (
        <p className="help">
          {m.assets_there_is_nothing_to_select_yet_items_already_set_to_everyone_always_appe()}
        </p>
      )}
    </FieldSet>
  );
}

/** Every shareable record with the same control as in its own editor; both write one field. */
const MAP_KINDS = {
  visits: m.assets_count_visits,
  stays: m.assets_count_stays,
  updates: m.assets_count_updates,
};

/** Describe canonical warning codes; server prose is diagnostic only. */
function reviewText(warning: OverviewWarning, audiences: OverviewAudience[]): string {
  const name =
    warning.audience_id === null
      ? m.assets_the_page_for_everyone()
      : m.assets_link({ p0: warning.audience ?? "" });
  switch (warning.code) {
    case "location_repeats_area":
      return m.owner_location_repeats_area({ name: warning.text ?? "" });
    case "visit_restates_route":
      return m.owner_visit_restates_route({ name: warning.text ?? "" });
    case "live_audience_receives_nothing":
      return m.assets_is_active_but_receives_no_items_set_items_to_everyone_or_select_them_for({
        p0: name,
      });
    case "trip_dates_shared":
      return m.assets_shows_the_travel_dates({
        p0: name,
        p1:
          DATE_PRECISIONS[warning.text as keyof typeof DATE_PRECISIONS]?.toLowerCase() ??
          warning.text ??
          "",
      });
    case "planning_marker_visible":
      return m.assets_shows_with_a_planning_word_in_its_name_rename_it_the_status_belongs_to_t({
        p0: name,
        p1: warning.text ?? "",
      });
    case "map_point_withheld": {
      const audience = audiences.find((item) => item.id === warning.audience_id);
      if (!audience) return m.assets_unknown_warning();
      const counts = (Object.keys(MAP_KINDS) as (keyof typeof MAP_KINDS)[])
        .filter((kind) => audience.without_map_point[kind] > 0)
        .map((kind) => MAP_KINDS[kind]({ count: audience.without_map_point[kind] }));
      return m.assets_receives_without_a_map_point_because_their_area_is_not_shared_or_has_no_({
        p0: name,
        p1: counts.join(", "),
      });
    }
    case "undated_visit_duplicates_dated":
      return m.assets_visit_has_no_date_but_its_area_already_has_a_dated_visit_give_it_a_date_({
        p0: warning.text ?? "",
      });
    default:
      return m.assets_unknown_warning();
  }
}

/** What to check before sharing, from the same projection visitors receive. */
function SharingReview({ overview }: { overview: TripOverview | undefined }) {
  useLocale();
  if (!overview) return null;
  const warnings = [...overview.warnings].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1,
  );
  return (
    <div className="manager-subsection">
      <div className="capture-heading">
        <div>
          <h3>{m.assets_sharing_check()}</h3>
          <p>
            {m.assets_what_each_active_or_draft_audience_currently_receives_and_what_you_shoul()}
          </p>
        </div>
      </div>
      <ul
        className="m-0 grid gap-1.5 pl-5 leading-normal text-travel-positive"
        aria-label={m.assets_sharing_check()}
      >
        {overview.audiences.map((audience) => {
          const delivered = audience.delivered;
          return (
            <li key={audience.id ?? "public"}>
              <strong>
                {audience.kind === "public" ? m.assets_for_everyone() : audience.label}
              </strong>{" "}
              ·{" "}
              {m.assets_audience_summary({
                state: audience.live
                  ? m.assets_active()
                  : audience.kind === "public"
                    ? m.assets_not_shared()
                    : m.assets_draft(),
                counts: [
                  m.assets_count_visits({ count: delivered.visits }),
                  m.assets_count_stays({ count: delivered.stays }),
                  m.assets_count_routes({ count: delivered.routes }),
                  m.assets_count_updates({ count: delivered.updates }),
                  m.assets_count_places({ count: delivered.places }),
                  m.assets_count_media({ count: delivered.media }),
                ].join(", "),
              })}
            </li>
          );
        })}
        {warnings.map((warning, index) => (
          <li
            key={`${warning.code}-${warning.audience_id ?? warning.id ?? ""}-${index}`}
            className={warning.severity === "warning" ? "text-travel-review-warning" : undefined}
          >
            {reviewText(warning, overview.audiences)}
          </li>
        ))}
        {warnings.length === 0 && <li>{m.assets_nothing_to_review()}</li>}
      </ul>
    </div>
  );
}

function VisibilityOverview({ tripId, catalog }: { tripId: string; catalog: CatalogItem[] }) {
  useLocale();
  const groups = groupBy(catalog);
  if (!groups.size)
    return (
      <p className="help">
        {m.assets_there_are_no_items_to_share_yet_create_a_travel_update_area_or_visit_for()}
      </p>
    );
  return (
    <div className="grid gap-2">
      {[...groups].map(([kind, items]) => (
        <Collapsible.Root className="scope-group" data-disclosure="" key={kind}>
          <Collapsible.Trigger>
            <strong>{GROUP_TITLES[kind]}</strong>
            <span>
              {m.assets_of_is_set_to_everyone_or_choose_in_sharing_line({
                p0: items.filter((item) => item.visibility !== "private" || item.followsUpdate)
                  .length,
                p1: items.length,
              })}
            </span>
          </Collapsible.Trigger>
          <Collapsible.Panel keepMounted className="grid gap-2 px-3.25 pt-0 pb-3.25">
            {items.map((item) => (
              <article className="scope-item" key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
                <VisibilityControl
                  tripId={tripId}
                  kind={item.kind}
                  id={item.id}
                  value={item.visibility}
                  name={item.label}
                  followsUpdate={item.followsUpdate}
                />
              </article>
            ))}
          </Collapsible.Panel>
        </Collapsible.Root>
      ))}
    </div>
  );
}

function combineDerivatives<T>(results: { data: T | undefined; error: Error | null }[]) {
  return {
    data: results.map((result) => result.data),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

type PublicValues = { scope: ShareScope };
type LinkValues = { label: string; scope: ShareScope };
type Preview = {
  name: string | (() => string);
  audience: "public" | "share";
  linkId?: string;
  document: Projection;
};
type LinkAction = {
  link: ShareLink;
  action: "activate" | "rotate";
  expiresInDays: number | null;
  reason: string | null;
};
type LinkSeries = { id: string; current: ShareLink; history: ShareLink[] };

export function PublicationManager({ trip }: { trip: Trip }) {
  const locale = useLocale();
  const confirmation = useConfirmation();
  const owner = useOwner();
  const statusQuery = useTripResource(trip.id, "public-projection");
  const linksQuery = useTripResource(trip.id, "share-links");
  const overviewQuery = useTripResource(trip.id, "overview");
  const placesQuery = useTripResource(trip.id, "areas");
  const routesQuery = useTripResource(trip.id, "routes");
  const visitsQuery = useTripResource(trip.id, "visits");
  const staysQuery = useTripResource(trip.id, "stays");
  const locationsQuery = useTripResource(trip.id, "locations");
  const mediaQuery = useTripResource(trip.id, "media");
  const media = useMemo(() => mediaQuery.data ?? [], [mediaQuery.data]);
  // One derivative read per asset; the combined result keeps a fixed shape however many assets there are.
  const mediaDerivatives = useQueries({
    queries: media.map((asset) => derivativesQueryOptions(owner, trip.id, "media", asset.id)),
    combine: combineDerivatives,
  });
  const publicStatus = statusQuery.data ?? null;
  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data]);
  const linkSeries = useMemo<LinkSeries[]>(() => {
    const grouped = new Map<string, ShareLink[]>();
    for (const link of links)
      grouped.set(link.series_id || link.id, [
        ...(grouped.get(link.series_id || link.id) ?? []),
        link,
      ]);
    return [...grouped.entries()].map(([id, entries]) => {
      const current =
        entries.find((link) => link.state === "draft" || link.state === "active") ?? entries[0];
      return { id, current, history: entries.filter((link) => link.id !== current.id) };
    });
  }, [links]);

  // null: no link editor; `{ linkId: null }`: a new link is being drafted; otherwise the chosen link.
  const [linkEditor, setLinkEditor] = useState<{ linkId: string | null } | null>(null);
  const editingLinkId = linkEditor?.linkId ?? null;
  const [notice, setNotice] = useFeedback<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [revealedLink, setRevealedLink] = useState<{ label: string; url: string } | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(30);
  const [reason, setReason] = useState("");
  const path = tripPath(trip.id, "public-projection");
  const linksPath = tripPath(trip.id, "share-links");
  const refreshStatus = (subject: string) => [
    ownerKeys.tripResource(subject, trip.id, "public-projection"),
    ownerKeys.tripResource(subject, trip.id, "overview"),
  ];
  const refreshLinks = (subject: string) => [
    ownerKeys.tripResource(subject, trip.id, "share-links"),
    ownerKeys.tripResource(subject, trip.id, "overview"),
  ];

  const savePublic = useOwnerMutation<ShareScope, PublicProjectionStatus>({
    fallback: m.assets_the_public_scope_could_not_be_saved,
    request: (scope) => ({ path, method: "PUT", body: scope }),
    invalidate: refreshStatus,
  });
  const previewPublicScope = useOwnerMutation<void, ProjectionDocument>({
    fallback: m.assets_the_public_preview_could_not_be_loaded,
    request: () => ({ path: `${path}/preview`, method: "POST" }),
    invalidate: () => [],
    // A preview is shown once and not kept.
    gcTime: 0,
  });
  const togglePublic = useOwnerMutation<
    { publish: boolean; reason: string | null },
    PublicProjectionStatus
  >({
    fallback: m.assets_the_publication_status_could_not_be_changed,
    request: ({ publish, reason: why }) => ({
      path: `${path}/${publish ? "publish" : "unpublish"}`,
      method: "POST",
      ...(!publish && why ? { body: { reason: why } } : {}),
    }),
    invalidate: (subject) => [...refreshStatus(subject), ownerKeys.trips(subject)],
  });
  const saveLink = useOwnerMutation<
    { id: string | null; label: string; scope: ShareScope },
    ShareLink
  >({
    fallback: m.assets_the_share_link_could_not_be_saved,
    request: ({ id, label, scope }) => ({
      path: id ? `${linksPath}/${id}` : linksPath,
      method: id ? "PATCH" : "POST",
      body: { label, scope },
    }),
    invalidate: refreshLinks,
  });
  const previewLinkScope = useOwnerMutation<ShareLink, ProjectionDocument>({
    fallback: m.assets_the_link_preview_could_not_be_loaded,
    request: (link) => ({ path: `${linksPath}/${link.id}/preview`, method: "POST" }),
    invalidate: () => [],
    gcTime: 0,
  });
  // The owner-managed URL remains in the owner-only in-memory cache; the PWA
  // never persists it locally.
  const activate = useOwnerMutation<LinkAction, ShareLink>({
    fallback: m.assets_the_secure_link_could_not_be_created,
    request: ({ link, action, expiresInDays: days, reason: why }) => ({
      path: `${linksPath}/${link.id}/${action}`,
      method: "POST",
      body: { expires_in_days: days, reason: why },
    }),
    invalidate: refreshLinks,
    gcTime: 0,
  });
  const revoke = useOwnerMutation<{ link: ShareLink; reason: string | null }, ShareLink>({
    fallback: m.assets_the_link_could_not_be_revoked,
    request: ({ link, reason: why }) => ({
      path: `${linksPath}/${link.id}/revoke`,
      method: "POST",
      body: { reason: why },
    }),
    invalidate: refreshLinks,
  });

  const selectedLink = links.find((link) => link.id === editingLinkId) ?? null;
  const lockedLink = selectedLink?.state === "revoked" || selectedLink?.state === "expired";

  const publicRecord = useRecordForm<PublicValues, PublicProjectionStatus>({
    defaultValues: { scope: emptyScope() },
    fallback: m.assets_the_public_scope_could_not_be_saved,
    submit: (values) => savePublic.mutateAsync(values.scope),
    onSuccess: (saved) => {
      publicRecord.load({ scope: cloneScope(saved.scope) });
      setNotice(textNotice(() => m.assets_selection_saved_unselected_content_stays_private()));
    },
  });
  const linkRecord = useRecordForm<LinkValues, ShareLink>({
    defaultValues: { label: "", scope: emptyScope() },
    fallback: m.assets_the_share_link_could_not_be_saved,
    serverFields: { label: "label" },
    // Saving never activates: a new link is created as a draft the owner can preview, then activate explicitly.
    submit: (values) =>
      saveLink.mutateAsync({ id: editingLinkId, label: values.label.trim(), scope: values.scope }),
    onSuccess: (saved) => {
      const wasNew = editingLinkId === null;
      loadLink(saved);
      setNotice(
        textNotice(() =>
          wasNew
            ? m.assets_draft_saved_view_the_preview_and_activate_the_link_when_you_are_satisfie()
            : m.assets_share_link_and_scope_saved(),
        ),
      );
    },
  });

  // The public scope follows the server, but never overwrites edits that are not saved yet.
  const publicDirty = useRef(false);
  publicDirty.current = publicRecord.dirty;
  const serverScope = publicStatus?.scope;
  useEffect(() => {
    if (serverScope && !publicDirty.current) publicRecord.load({ scope: cloneScope(serverScope) });
    // `load` is stable; only a new server scope should reload the editor.
  }, [serverScope]);

  function loadLink(link: ShareLink) {
    setLinkEditor({ linkId: link.id });
    linkRecord.load({ label: link.label, scope: cloneScope(link.scope) });
    setPreview(null);
    setRevealedLink(null);
    setReason("");
  }

  function loadNewLink() {
    setLinkEditor({ linkId: null });
    linkRecord.load({ label: "", scope: emptyScope() });
    setPreview(null);
    setRevealedLink(null);
    setReason("");
  }

  function switchLinkEditor(next: ShareLink | null) {
    if (linkEditor?.linkId === (next?.id ?? null)) return;
    const open = () => (next ? loadLink(next) : loadNewLink());
    if (linkRecord.dirty) {
      confirmation.ask({
        title: () => m.assets_discard_unsaved_link_changes(),
        description: () => m.assets_the_name_and_scope_you_edited_will_not_be_saved(),
        confirmLabel: () => m.owner_discard_changes_2(),
        onConfirm: open,
      });
      return;
    }
    open();
  }

  function closeLinkEditor() {
    if (linkEditor === null) return;
    setLinkEditor(null);
    linkRecord.load({ label: "", scope: emptyScope() });
  }

  const fail = (fallback: ErrorFallback) => (error: unknown) =>
    setNotice(errorNotice(error, fallback));

  async function previewPublic() {
    const values = publicRecord.form.state.values;
    const saved = await savePublic.mutateAsync(values.scope);
    publicRecord.load({ scope: cloneScope(saved.scope) });
    const document = await previewPublicScope.mutateAsync();
    setPreview({
      name: m.assets_public_preview,
      audience: "public",
      document: document as Projection,
    });
  }

  function toggle() {
    if (!publicStatus) return;
    const publish = publicStatus.surface_state !== "published";
    togglePublic.mutateAsync({ publish, reason: reason.trim() || null }).then(() => {
      setReason("");
      setNotice(
        textNotice(() =>
          publish ? m.assets_public_page_published() : m.assets_public_page_withdrawn(),
        ),
      );
    }, fail(m.assets_the_publication_status_could_not_be_changed));
  }

  async function previewLink() {
    let target = selectedLink;
    if (!target || !lockedLink) {
      const values = linkRecord.form.state.values;
      target = await saveLink.mutateAsync({
        id: editingLinkId,
        label: values.label.trim(),
        scope: values.scope,
      });
      loadLink(target);
    }
    const document = await previewLinkScope.mutateAsync(target);
    setLinkEditor(null);
    setPreview({
      name: () => m.assets_preview_of({ p0: target.label }),
      audience: "share",
      linkId: target.id,
      document: document as Projection,
    });
  }

  function activateLink(action: "activate" | "rotate") {
    if (!selectedLink) return;
    activate
      .mutateAsync({ link: selectedLink, action, expiresInDays, reason: reason.trim() || null })
      .then((result) => {
        activate.reset();
        loadLink(result);
        if (!result.token) {
          setNotice(textNotice(() => m.assets_the_link_could_not_be_created()));
          return;
        }
        setRevealedLink({ label: result.label, url: shareUrl(result.token) });
        setLinkEditor(null);
        setNotice(textNotice(() => m.assets_the_link_is_active_and_can_be_copied_again_later()));
      }, fail(m.assets_the_secure_link_could_not_be_created));
  }

  function revealCurrentLink() {
    if (!selectedLink?.token) return;
    setRevealedLink({ label: selectedLink.label, url: shareUrl(selectedLink.token) });
    setLinkEditor(null);
  }

  function revokeLink() {
    if (!selectedLink) return;
    confirmation.ask({
      title: () => m.assets_revoke_named_link({ name: selectedLink.label }),
      description: () =>
        m.assets_anyone_with_the_current_secure_link_will_no_longer_be_able_to_open_the_h(),
      confirmLabel: () => m.assets_revoke_link(),
      onConfirm: () =>
        revoke.mutateAsync({ link: selectedLink, reason: reason.trim() || null }).then((saved) => {
          loadLink(saved);
          setNotice(textNotice(() => m.assets_share_link_revoked()));
        }, fail(m.assets_the_link_could_not_be_revoked)),
    });
  }

  async function copyLink() {
    if (!revealedLink) return;
    await navigator.clipboard.writeText(revealedLink.url);
    setNotice(textNotice(() => m.assets_link_copied()));
  }

  async function copyPublicLink() {
    if (!publicStatus?.slug) return;
    await navigator.clipboard.writeText(publicUrl(publicStatus.slug));
    setNotice(textNotice(() => m.assets_public_link_copied()));
  }

  const catalog = useMemo<CatalogItem[]>(() => {
    const approved = <T extends { review_state: string }>(items: T[] | undefined) =>
      (items ?? []).filter((item) => item.review_state === "approved");
    const updateTitles = new Map(trip.travel_updates.map((update) => [update.id, update.title]));
    return [
      ...trip.travel_updates.map((item) => ({
        kind: "travel_update" as const,
        id: item.id,
        label: item.title,
        detail: m.owner_travel_update(),
        visibility: item.visibility,
      })),
      ...(visitsQuery.data ?? []).map((item) => ({
        kind: "visit" as const,
        id: item.id,
        label: visitTitle(item),
        detail: m.assets_visit_the_place_visitor_text_and_date_the_time_only_if_you_share_it(),
        visibility: item.visibility,
      })),
      ...(placesQuery.data ?? []).map((item) => ({
        kind: "area" as const,
        id: item.id,
        label: item.label,
        detail: m.owner_area(),
        visibility: item.visibility,
      })),
      // Only locations the owner has named or shared: most locations are hotels and endpoints that stay private.
      ...(locationsQuery.data ?? [])
        .filter((item) => item.label || item.visibility !== "private")
        .map((item) => ({
          kind: "location" as const,
          id: item.id,
          label: item.label ?? m.assets_location_without_a_public_name(),
          detail: m.assets_location_name_area_and_position_only(),
          visibility: item.visibility,
        })),
      ...(routesQuery.data ?? []).map((item) => ({
        kind: "route" as const,
        id: item.id,
        label: `${ROUTE_MODE_LABELS[item.mode]}: ${routeTitle(item)}`,
        detail: m.assets_visitors_see_the_areas_transport_mode_and_line_never_the_booking_code_tr(),
        visibility: item.visibility,
      })),
      ...(staysQuery.data ?? []).map((item) => ({
        kind: "stay" as const,
        id: item.id,
        label: stayLabel(item),
        detail: m.assets_visitors_see_only_and_the_nights({
          p0: item.area?.label ?? m.assets_no_area_selected_yet(),
        }),
        visibility: item.visibility,
      })),
      ...media.flatMap((asset, index) =>
        approved(mediaDerivatives.data[index])
          .filter((item) => item.purpose === "share")
          .map((item) => ({
            kind: "media_derivative" as const,
            id: item.id,
            label: asset.original_filename ?? m.assets_approved_media_item(),
            detail:
              asset.media_kind === "video" ? m.assets_approved_video() : m.assets_approved_photo(),
            visibility: item.visibility,
            followsUpdate: updateTitles.get(item.travel_update_id ?? ""),
          })),
      ),
    ];
  }, [
    locale,
    trip,
    placesQuery.data,
    locationsQuery.data,
    routesQuery.data,
    visitsQuery.data,
    staysQuery.data,
    media,
    mediaDerivatives.data,
  ]);

  const readError =
    [
      statusQuery,
      linksQuery,
      placesQuery,
      locationsQuery,
      routesQuery,
      visitsQuery,
      staysQuery,
      mediaQuery,
    ].find((query) => query.isError)?.error ?? mediaDerivatives.error;
  const message =
    notice ??
    (readError
      ? errorMessage(readError, m.assets_your_publications_could_not_be_loaded)
      : statusQuery.isPending
        ? m.assets_loading_your_publications()
        : m.assets_choose_who_sees_each_item_new_items_are_private());
  const isPublished = publicStatus?.surface_state === "published";

  return (
    <section className="travel-card manager gap-4.5" aria-labelledby="publication-manager-title">
      <div className="capture-heading">
        <div>
          <h3 id="publication-manager-title">{m.owner_sharing()}</h3>
          <p>
            {m.assets_each_item_has_the_same_choice_private_everyone_or_select_per_audience_he()}
          </p>
        </div>
      </div>
      <p className="help" role="status">
        {message}
      </p>
      {revealedLink && (
        <RecordDialog open title={m.assets_share_link_2()} onDismiss={() => setRevealedLink(null)}>
          <section
            className="grid gap-2.5 rounded-xl border-2 border-travel-warning bg-travel-warning-surface p-4 text-travel-warning-dark [&_p]:m-0 [&_p]:text-travel-warning-dark! [&_code]:block [&_code]:wrap-anywhere [&_code]:rounded-lg [&_code]:bg-travel-surface [&_code]:p-2.5 [&_code]:text-sm [&_code]:text-travel-ink [&_button]:w-fit"
            aria-live="assertive"
          >
            <strong>{revealedLink.label}</strong>
            <p>
              {m.assets_anyone_with_this_link_can_open_the_active_hidden_page_you_can_copy_it_ag()}
            </p>
            <code>{revealedLink.url}</code>
            <Button
              type="button"
              onClick={() => void copyLink().catch(fail(m.assets_copying_failed))}
            >
              {m.assets_copy_link()}
            </Button>
            <Button
              className="secondary compact"
              type="button"
              onClick={() => setRevealedLink(null)}
            >
              {m.owner_close_2()}
            </Button>
          </section>
        </RecordDialog>
      )}
      <SharingReview overview={overviewQuery.data} />
      <div className="manager-subsection">
        <div className="capture-heading">
          <div>
            <h3>{m.assets_visibility_per_item()}</h3>
            <p>
              {m.assets_the_same_choice_as_in_each_items_editor_this_shows_a_setting_not_who_act()}
            </p>
          </div>
        </div>
        <VisibilityOverview tripId={trip.id} catalog={catalog} />
      </div>
      <div className="manager-subsection">
        <div className="capture-heading">
          <div>
            <h3>{m.assets_for_everyone()}</h3>
            <p>
              {isPublished
                ? m.assets_this_page_is_accessible_to_everyone()
                : m.assets_this_page_is_not_accessible_to_visitors_yet()}
            </p>
          </div>
        </div>
        {isPublished && publicStatus?.slug && (
          <p className="help">
            <code className="inline-block wrap-anywhere rounded-md bg-travel-tint px-2 py-1 text-sm text-travel-ink">
              {publicUrl(publicStatus.slug)}
            </code>
          </p>
        )}
        <RecordForm
          record={publicRecord}
          submitLabel={m.assets_save_selection()}
          pendingLabel={m.assets_saving()}
          actions={
            <>
              {isPublished && publicStatus?.slug && (
                <a
                  className="action-link secondary"
                  href={publicUrl(publicStatus.slug)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {m.assets_open_public_page()}
                </a>
              )}
              {isPublished && publicStatus?.slug && (
                <Button
                  className="secondary"
                  type="button"
                  onClick={() => void copyPublicLink().catch(fail(m.assets_copying_failed))}
                >
                  {m.assets_copy_link_2()}
                </Button>
              )}
              <Button
                className="secondary"
                type="button"
                onClick={() =>
                  void previewPublic().catch(fail(m.assets_the_preview_could_not_be_loaded_2))
                }
              >
                {m.assets_view_as_visitor()}
              </Button>
              <Button
                className={isPublished ? "danger" : ""}
                type="button"
                disabled={!publicStatus || togglePublic.isPending}
                onClick={toggle}
              >
                {isPublished
                  ? m.assets_stop_sharing_with_everyone()
                  : m.assets_share_with_everyone()}
              </Button>
            </>
          }
        >
          <publicRecord.form.Field name="scope">
            {(field) => (
              <ScopeEditor
                name={m.assets_what_everyone_can_see()}
                scope={field.state.value}
                setScope={(scope) => {
                  field.handleChange(scope);
                  setPreview(null);
                }}
                catalog={catalog}
                hasDates={Boolean(trip.starts_on)}
                tripId={trip.id}
                onError={fail(m.owner_visibility_save_failed)}
              />
            )}
          </publicRecord.form.Field>
        </RecordForm>
      </div>
      <div className="manager-subsection">
        <div className="capture-heading">
          <div>
            <h3>{m.assets_hidden_share_links()}</h3>
            <p>{m.assets_each_link_has_its_own_live_scope_and_can_later_be_revoked_or_rotated()}</p>
          </div>
          <Button
            className="secondary compact"
            type="button"
            onClick={() => switchLinkEditor(null)}
          >
            {m.assets_new_link()}
          </Button>
        </div>
        {linkSeries.length > 0 && (
          <div className="grid gap-2">
            {linkSeries.map(({ id, current, history }) => (
              <div className="grid gap-2" key={id}>
                <Button
                  type="button"
                  className="link-row"
                  data-selected={current.id === editingLinkId ? "" : undefined}
                  onClick={() => switchLinkEditor(current)}
                >
                  <strong>{current.label}</strong>
                  <span>
                    {m.assets_expires_line({
                      p0: LINK_STATE_LABELS[current.state],
                      p1: dateLabel(current.expires_at),
                      p2: history.length ? m.assets_previous({ count: history.length }) : "",
                    })}
                  </span>
                </Button>
                {history.length > 0 && (
                  <Collapsible.Root className="border-l-2 border-travel-divider pl-3">
                    <Collapsible.Trigger className="bg-transparent p-0 text-left text-sm font-bold text-travel-muted">
                      {m.assets_previous_view_line({
                        p0: history.length,
                        p1: history.length === 1 ? "versie" : "versies",
                      })}
                    </Collapsible.Trigger>
                    <Collapsible.Panel keepMounted className="mt-2 grid gap-2">
                      {history.map((link) => (
                        <Button
                          type="button"
                          className="link-row"
                          data-selected={link.id === editingLinkId ? "" : undefined}
                          key={link.id}
                          onClick={() => switchLinkEditor(link)}
                        >
                          <strong>{link.label}</strong>
                          <span>
                            {LINK_STATE_LABELS[link.state]}{" "}
                            {dateLabel(link.revoked_at ?? link.expires_at)}
                          </span>
                        </Button>
                      ))}
                    </Collapsible.Panel>
                  </Collapsible.Root>
                )}
              </div>
            ))}
          </div>
        )}
        {links.length === 0 && !linksQuery.isPending && (
          <p>
            {m.assets_no_share_links_yet_choose_new_link_to_create_a_hidden_link_with_its_own_()}
          </p>
        )}
      </div>
      <RecordDialog
        open={linkEditor !== null}
        title={editingLinkId ? m.assets_edit_share_link() : m.assets_add_share_link()}
        dirty={linkRecord.dirty}
        onDismiss={closeLinkEditor}
      >
        {linkEditor !== null && (
          <div className="publication-panel">
            <RecordForm
              record={linkRecord}
              submitLabel={selectedLink ? m.assets_save_link() : m.assets_save_draft()}
              pendingLabel={m.owner_saving()}
              disabled={lockedLink}
              actions={
                <Button
                  className="secondary"
                  type="button"
                  disabled={lockedLink || !linkRecord.values.label.trim()}
                  onClick={() =>
                    void previewLink().catch(fail(m.assets_the_preview_could_not_be_loaded_2))
                  }
                >
                  {m.assets_view_preview()}
                </Button>
              }
            >
              <linkRecord.form.Field
                name="label"
                listeners={{ onChange: () => setPreview(null) }}
                validators={{
                  onChange: requiredText(m.owner_give_the_link_a_name),
                  onSubmit: requiredText(m.owner_give_the_link_a_name),
                }}
              >
                {(field) => (
                  <TextField
                    field={field}
                    label={m.assets_link_name()}
                    required
                    maxLength={120}
                    disabled={lockedLink}
                    placeholder={m.assets_for_example_family()}
                  />
                )}
              </linkRecord.form.Field>
              <linkRecord.form.Field name="scope">
                {(field) => (
                  <ScopeEditor
                    name={m.assets_scope_for_hidden_link()}
                    scope={field.state.value}
                    setScope={(scope) => {
                      field.handleChange(scope);
                      setPreview(null);
                    }}
                    catalog={catalog}
                    hasDates={Boolean(trip.starts_on)}
                    tripId={trip.id}
                    onError={fail(m.owner_visibility_save_failed)}
                    disabled={lockedLink}
                  />
                )}
              </linkRecord.form.Field>
            </RecordForm>
            <div className="publication-panel">
              <div className="field-row">
                <Field className="contents">
                  <FieldLabel>
                    {m.assets_valid_for_days()}
                    <Input
                      type="number"
                      min="1"
                      max="90"
                      disabled={expiresInDays === null}
                      value={expiresInDays ?? 30}
                      onChange={(event) => setExpiresInDays(Number(event.target.value))}
                    />
                  </FieldLabel>
                </Field>
                <Field className="contents">
                  <FieldLabel className="scope-choice">
                    <TravelCheckbox
                      checked={expiresInDays === null}
                      onCheckedChange={(checked) => setExpiresInDays(checked ? null : 30)}
                    />
                    {m.assets_no_expiry_date()}
                  </FieldLabel>
                </Field>
                <Field className="contents">
                  <FieldLabel>
                    {m.assets_reason()}{" "}
                    <span className="font-medium text-travel-optional">{m.owner_optional()}</span>
                    <Input
                      maxLength={500}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </FieldLabel>
                </Field>
              </div>
              {expiresInDays === null && (
                <p className="help">
                  {m.assets_this_link_remains_valid_until_you_revoke_or_rotate_it()}
                </p>
              )}
              {selectedLink?.state === "draft" && (
                <p className="help">
                  {m.assets_this_draft_is_not_active_yet_view_the_preview_and_click_activate_when_yo()}
                </p>
              )}
              <div className="button-row">
                {selectedLink?.state === "draft" && (
                  <Button type="button" onClick={() => activateLink("activate")}>
                    {m.assets_activate()}
                  </Button>
                )}
                {selectedLink?.state === "active" && (
                  <>
                    <Button
                      className="secondary"
                      type="button"
                      disabled={!selectedLink.token}
                      onClick={revealCurrentLink}
                    >
                      {m.assets_show_link()}
                    </Button>
                    <Button className="danger" type="button" onClick={revokeLink}>
                      {m.assets_revoke_link()}
                    </Button>
                    <Button type="button" onClick={() => activateLink("rotate")}>
                      {m.assets_rotate_and_show_new_link()}
                    </Button>
                  </>
                )}
              </div>
              {selectedLink?.state === "active" && !selectedLink.token && (
                <p className="help">
                  {m.assets_this_older_link_is_still_active_but_its_url_was_not_saved_rotate_it_once()}
                </p>
              )}
            </div>
          </div>
        )}
      </RecordDialog>
      {preview && owner && (
        <RecordDialog
          open
          title={typeof preview.name === "function" ? preview.name() : preview.name}
          className="max-w-280"
          onDismiss={() => setPreview(null)}
        >
          <section
            className="publication-panel [&_h3]:m-0 [&_p]:m-0 [&_pre]:max-h-80 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-travel-ink [&_pre]:p-3 [&_pre]:text-xs [&_pre]:text-travel-tint"
            aria-live="polite"
          >
            <p>
              {preview.audience === "public"
                ? m.assets_audience_everyone()
                : m.assets_audience_only_people_with_the_active_hidden_link()}{" "}
              ·{" "}
              {preview.audience === "public"
                ? isPublished
                  ? m.assets_currently_shared()
                  : m.assets_not_shared_yet()
                : LINK_STATE_LABELS[
                    links.find((link) => link.id === preview.linkId)?.state ?? "draft"
                  ]}
            </p>
            <p>{projectionSummary(preview.document)}</p>
            <p className="help">
              {m.assets_only_selected_fields_appear_below_private_data_bookings_and_other_unsele()}
            </p>
            <RenderedPreview
              projection={preview.document}
              audience={preview.audience}
              tripId={trip.id}
              linkId={preview.linkId}
              session={owner.session}
            />
            <Collapsible.Root>
              <Collapsible.Trigger className="bg-transparent p-0 text-left font-bold text-travel-forest">
                {m.assets_inspect_delivered_fields()}
              </Collapsible.Trigger>
              <Collapsible.Panel keepMounted>
                <pre>{JSON.stringify(preview.document, null, 2)}</pre>
              </Collapsible.Panel>
            </Collapsible.Root>
          </section>
        </RecordDialog>
      )}
      {confirmation.dialog}
    </section>
  );
}
