import { m } from "../../paraglide/messages.js";
import {
  formatInstantDate,
  type ProjectionDocument,
  type ShareLink,
  type ShareScope,
  type ShareScopeKind,
  type Visibility,
} from "../../tracker-model";

export type CatalogItem = {
  kind: ShareScopeKind;
  id: string;
  label: string;
  detail: string;
  visibility: Visibility;
  /** A photo attached to a reisupdate is shared with it, so it has no choice of its own. */ followsUpdate?: string;
};

export const LINK_STATE_LABELS: Record<ShareLink["state"], string> = {
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

export const GROUP_TITLES: Record<ShareScopeKind, string> = {
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

export const DATE_PRECISIONS = {
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

export const emptyScope = (): ShareScope => ({
  schema_version: "travel/share-scope@1",
  trip: { title: true, summary: true, dates: null },
  items: [],
});
export function cloneScope(scope: Partial<ShareScope> | null | undefined): ShareScope {
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

export function shareUrl(token: string): string {
  return new URL(`/share/${encodeURIComponent(token)}`, window.location.origin).toString();
}

export function publicUrl(slug: string): string {
  return new URL(`/trips/${encodeURIComponent(slug)}`, window.location.origin).toString();
}

export function dateLabel(value: string | null): string {
  return value ? formatInstantDate(value) : "—";
}

export function projectionSummary(document: ProjectionDocument): string {
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

export function updateItem(scope: ShareScope, item: CatalogItem, included: boolean): ShareScope {
  const current = scope.items.find((value) => value.kind === item.kind && value.id === item.id);
  const items = included
    ? current
      ? scope.items
      : [...scope.items, { kind: item.kind, id: item.id }]
    : scope.items.filter((value) => value !== current);
  return { ...scope, items };
}

export const groupBy = (items: CatalogItem[]) =>
  items.reduce<Map<ShareScopeKind, CatalogItem[]>>(
    (map, item) => map.set(item.kind, [...(map.get(item.kind) ?? []), item]),
    new Map(),
  );

/**
 * One kind of record an audience can list. Collapsed so a long list stays a short page; the count says what is
 * chosen. A still-private record can be chosen directly here: checking it promotes it to "Zelf kiezen" first, then
 * adds it to this audience's scope, so choosing content for an audience never requires leaving this form.
 */
