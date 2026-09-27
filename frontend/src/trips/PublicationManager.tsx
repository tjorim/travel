import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { RecordForm, requiredText, SearchSelect, TextField } from "../forms/fields";
import { useConfirmation } from "../forms/useConfirmation";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { derivativesQueryOptions, tripPath, useOwner, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import { RenderedPreview } from "./RenderedPreview";
import { useSetVisibility, VisibilityControl } from "./visibility";
import type { Projection } from "../ProjectionView";
import { formatInstantDate, ROUTE_MODE_LABELS, routeTitle, stayLabel, visitTitle, type ProjectionDocument, type PublicProjectionStatus, type ShareLink, type ShareScope, type ShareScopeKind, type Trip, type TripOverview, type OverviewAudience, type OverviewWarning, type Visibility } from "../tracker-model";

type CatalogItem = { kind: ShareScopeKind; id: string; label: string; detail: string; visibility: Visibility; /** A photo attached to a reisupdate is shared with it, so it has no choice of its own. */ followsUpdate?: string };

const GROUP_TITLES: Record<ShareScopeKind, string> = {
  travel_update: "Reisupdates",
  visit: "Bezoeken",
  area: "Gebieden",
  location: "Locaties",
  route: "Routes",
  stay: "Verblijven",
  media_derivative: "Foto’s en video’s",
};

const DATE_PRECISIONS = {
  day: "Volledige datums",
  month: "Alleen maanden",
  year: "Alleen het jaar",
} as const;

const emptyScope = (): ShareScope => ({ schema_version: "travel/share-scope@1", trip: { title: true, summary: true, dates: null }, items: [] });
function cloneScope(scope: Partial<ShareScope> | null | undefined): ShareScope {
  return {
    schema_version: "travel/share-scope@1",
    trip: { title: scope?.trip?.title ?? true, summary: scope?.trip?.summary ?? true, dates: scope?.trip?.dates ?? null },
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
  const count = document.visits.length + document.places.length + document.updates.length + document.stays.length + document.media.length + document.routes.length;
  return `${count} gekozen onderdelen · ${document.title ? "titel" : "geen titel"} · ${document.summary ? "samenvatting" : "geen samenvatting"} · ${document.dates ? "reisdatums" : "geen reisdatums"}`;
}

function updateItem(scope: ShareScope, item: CatalogItem, included: boolean): ShareScope {
  const current = scope.items.find((value) => value.kind === item.kind && value.id === item.id);
  const items = included
    ? current ? scope.items : [...scope.items, { kind: item.kind, id: item.id }]
    : scope.items.filter((value) => value !== current);
  return { ...scope, items };
}

const groupBy = (items: CatalogItem[]) => items.reduce<Map<ShareScopeKind, CatalogItem[]>>((map, item) => map.set(item.kind, [...(map.get(item.kind) ?? []), item]), new Map());

/**
 * One kind of record an audience can list. Collapsed so a long list stays a short page; the count says what is
 * chosen. A still-private record can be chosen directly here: checking it promotes it to "Zelf kiezen" first, then
 * adds it to this audience's scope, so choosing content for an audience never requires leaving this form.
 */
function ScopeGroup({ kind, items, scope, setScope, tripId, onError }: { kind: ShareScopeKind; items: CatalogItem[]; scope: ShareScope; setScope: (scope: ShareScope) => void; tripId: string; onError: (error: unknown) => void }) {
  const setVisibility = useSetVisibility(tripId);
  const [busy, setBusy] = useState(false);
  const chosen = (item: CatalogItem) => scope.items.some((value) => value.kind === item.kind && value.id === item.id);
  const count = items.filter(chosen).length;

  async function promote(toPromote: CatalogItem[]): Promise<boolean> {
    if (!toPromote.length) return true;
    setBusy(true);
    try {
      await Promise.all(toPromote.map((item) => setVisibility.mutateAsync({ kind: item.kind, id: item.id, visibility: "custom" })));
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function include(item: CatalogItem, checked: boolean) {
    if (checked && item.visibility === "private" && !(await promote([item]))) return;
    setScope(updateItem(scope, item, checked));
  }

  async function chooseAll() {
    if (!(await promote(items.filter((item) => item.visibility === "private" && !chosen(item))))) return;
    setScope(items.reduce((current, item) => updateItem(current, item, true), scope));
  }

  return <details className="scope-group">
    <summary><strong>{GROUP_TITLES[kind]}</strong><span>{count} van {items.length} gekozen</span></summary>
    <div className="scope-group-body">
      <div className="button-row">
        <button className="secondary compact" type="button" disabled={busy || count === items.length} onClick={() => void chooseAll()}>Alles kiezen</button>
        <button className="secondary compact" type="button" disabled={busy || count === 0} onClick={() => setScope(items.reduce((current, item) => updateItem(current, item, false), scope))}>Niets kiezen</button>
      </div>
      <div className="scope-items">{items.map((item) => <article className={`scope-item ${chosen(item) ? "included" : ""}`} key={`${item.kind}-${item.id}`}><label className="scope-choice"><input type="checkbox" checked={chosen(item)} disabled={busy} onChange={(event) => void include(item, event.target.checked)} /><span><strong>{item.label}</strong><small>{item.detail}</small>{item.visibility === "private" && <em className="scope-item-note"> · nu privé; aanvinken kiest dit voor dit publiek</em>}</span></label></article>)}</div>
    </div>
  </details>;
}

/** What every audience gets without being chosen: the same setting as on each record, kept out of the lists below. */
function VisibilityNote({ catalog }: { catalog: CatalogItem[] }) {
  const own = catalog.filter((item) => !item.followsUpdate);
  if (!own.length) return null;
  const everyone = own.filter((item) => item.visibility === "everyone").length;
  const privateCount = own.filter((item) => item.visibility === "private").length;
  return <p className="help scope-updates-note">{everyone} voor iedereen verschijnt hier altijd; {privateCount} privé kun je hieronder aanvinken om het voor dit publiek te kiezen, wat het automatisch op “Zelf kiezen in Delen” zet.</p>;
}

function ScopeEditor({ scope, setScope, name, catalog, hasDates, tripId, onError, disabled = false }: { scope: ShareScope; setScope: (scope: ShareScope) => void; name: string; catalog: CatalogItem[]; hasDates: boolean; tripId: string; onError: (error: unknown) => void; disabled?: boolean }) {
  const groups = groupBy(catalog.filter((item) => item.visibility !== "everyone"));
  return <fieldset className="scope-editor" disabled={disabled}><legend>{name}</legend><p>Kies wat bezoekers mogen zien. Alles wat je niet kiest blijft privé.</p>
    <div className="scope-trip-fields"><label className="scope-choice"><input type="checkbox" checked={scope.trip.title} onChange={(event) => setScope({ ...scope, trip: { ...scope.trip, title: event.target.checked } })} />Reistitel</label><label className="scope-choice"><input type="checkbox" checked={scope.trip.summary} onChange={(event) => setScope({ ...scope, trip: { ...scope.trip, summary: event.target.checked } })} />Samenvatting</label><label>Hoe precies mogen de reisdatums zijn?<SearchSelect ariaLabel="Hoe precies mogen de reisdatums zijn?" value={scope.trip.dates ?? ""} onChange={(value) => setScope({ ...scope, trip: { ...scope.trip, dates: (value || null) as ShareScope["trip"]["dates"] } })}><option value="">Niet tonen</option>{Object.entries(DATE_PRECISIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SearchSelect></label>{scope.trip.dates === "day" && <small>Bezoekers zien begin- en einddag.</small>}{scope.trip.dates === "month" && <small>Bezoekers zien alleen begin- en eindmaand.</small>}{scope.trip.dates === "year" && <small>Bezoekers zien alleen het reisjaar.</small>}{scope.trip.dates && !hasDates && <small>Deze reis heeft nog geen reisdatums.</small>}</div>
    <VisibilityNote catalog={catalog} />
    <div className="scope-groups">{[...groups].map(([kind, items]) => <ScopeGroup key={kind} kind={kind} items={items} scope={scope} setScope={setScope} tripId={tripId} onError={onError} />)}</div>
    {!groups.size && <p className="help">Er is nog niets om te kiezen. Onderdelen die al op “Iedereen” staan verschijnen hier altijd; maak eerst een reisupdate, gebied of bezoek aan.</p>}
  </fieldset>;
}

/** Every shareable record with the same control as in its own editor; both write one field. */
const MAP_KINDS: Record<keyof OverviewAudience["without_map_point"], [string, string]> = { visits: ["bezoek", "bezoeken"], stays: ["verblijf", "verblijven"], updates: ["reisupdate", "reisupdates"] };

/** A warning in Dutch; the API's English ``message`` is for API and MCP clients. */
function reviewText(warning: OverviewWarning, audiences: OverviewAudience[]): string {
  const name = warning.audience_id === null ? "De pagina voor iedereen" : `Link “${warning.audience}”`;
  switch (warning.code) {
    case "live_audience_receives_nothing":
      return `${name} is actief maar krijgt geen enkel onderdeel. Zet onderdelen op “Iedereen”, of kies ze voor dit publiek.`;
    case "trip_dates_shared":
      return `${name} toont de reisdatums (${DATE_PRECISIONS[warning.text as keyof typeof DATE_PRECISIONS]?.toLowerCase() ?? warning.text}).`;
    case "planning_marker_visible":
      return `${name} toont “${warning.text}”, met een planningswoord erin. Geef het een andere naam; de status hoort bij het onderdeel zelf.`;
    case "map_point_withheld": {
      const audience = audiences.find((item) => item.id === warning.audience_id);
      if (!audience) return warning.message;
      const counts = (Object.entries(MAP_KINDS) as [keyof typeof MAP_KINDS, [string, string]][])
        .filter(([kind]) => audience.without_map_point[kind] > 0)
        .map(([kind, [one, many]]) => `${audience.without_map_point[kind]} ${audience.without_map_point[kind] === 1 ? one : many}`);
      return `${name} krijgt ${counts.join(", ")} zonder kaartpunt, omdat hun gebied niet gedeeld is of geen punt heeft.`;
    }
    case "undated_visit_duplicates_dated":
      return `Het bezoek “${warning.text}” heeft geen datum, maar zijn gebied heeft al een bezoek met datum. Geef het een datum, voeg het samen of verwijder het.`;
    default:
      return warning.message;
  }
}

/** What to check before sharing, from the same projection visitors receive. */
function SharingReview({ overview }: { overview: TripOverview | undefined }) {
  if (!overview) return null;
  const warnings = [...overview.warnings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1));
  return <div className="manager-subsection"><div className="capture-heading"><div><h3>Controle voor het delen</h3><p>Wat elk actief of ontworpen publiek nu krijgt, en wat je best nakijkt.</p></div></div>
    <ul className="sharing-review" aria-label="Controle voor het delen">
      {overview.audiences.map((audience) => {
        const delivered = audience.delivered;
        return <li key={audience.id ?? "public"}><strong>{audience.kind === "public" ? "Voor iedereen" : audience.label}</strong> · {audience.live ? "actief" : audience.kind === "public" ? "niet gedeeld" : "concept"} · {delivered.visits} bezoeken, {delivered.stays} verblijven, {delivered.routes} routes, {delivered.updates} reisupdates, {delivered.places} plaatsen, {delivered.media} media</li>;
      })}
      {warnings.map((warning, index) => <li key={`${warning.code}-${warning.audience_id ?? warning.id ?? ""}-${index}`} className={warning.severity === "warning" ? "review-warning" : undefined}>{reviewText(warning, overview.audiences)}</li>)}
      {warnings.length === 0 && <li>Niets om na te kijken.</li>}
    </ul>
  </div>;
}

function VisibilityOverview({ tripId, catalog }: { tripId: string; catalog: CatalogItem[] }) {
  const groups = groupBy(catalog);
  if (!groups.size) return <p className="help">Er zijn nog geen onderdelen die je kunt delen. Maak bijvoorbeeld een reisupdate, gebied of bezoek.</p>;
  return <div className="scope-groups">{[...groups].map(([kind, items]) => <details className="scope-group" key={kind}>
    <summary><strong>{GROUP_TITLES[kind]}</strong><span>{items.filter((item) => item.visibility !== "private" || item.followsUpdate).length} van {items.length} staat op “Iedereen” of “Zelf kiezen”</span></summary>
    <div className="scope-group-body scope-items">{items.map((item) => <article className="scope-item" key={item.id}><div><strong>{item.label}</strong><small>{item.detail}</small></div><VisibilityControl tripId={tripId} kind={item.kind} id={item.id} value={item.visibility} name={item.label} followsUpdate={item.followsUpdate} /></article>)}</div>
  </details>)}</div>;
}

function combineDerivatives<T>(results: { data: T | undefined; error: Error | null }[]) {
  return { data: results.map((result) => result.data), error: results.find((result) => result.error)?.error ?? null };
}

type PublicValues = { scope: ShareScope };
type LinkValues = { label: string; scope: ShareScope };
type Preview = { name: string; audience: "public" | "share"; linkId?: string; document: Projection };
type LinkAction = { link: ShareLink; action: "activate" | "rotate"; expiresInDays: number | null; reason: string | null };
type LinkSeries = { id: string; current: ShareLink; history: ShareLink[] };

export function PublicationManager({ trip }: { trip: Trip }) {
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
  const mediaDerivatives = useQueries({ queries: media.map((asset) => derivativesQueryOptions(owner, trip.id, "media", asset.id)), combine: combineDerivatives });
  const publicStatus = statusQuery.data ?? null;
  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data]);
  const linkSeries = useMemo<LinkSeries[]>(() => {
    const grouped = new Map<string, ShareLink[]>();
    for (const link of links) grouped.set(link.series_id || link.id, [...(grouped.get(link.series_id || link.id) ?? []), link]);
    return [...grouped.entries()].map(([id, entries]) => {
      const current = entries.find((link) => link.state === "draft" || link.state === "active") ?? entries[0];
      return { id, current, history: entries.filter((link) => link.id !== current.id) };
    });
  }, [links]);

  // null: no link editor; `{ linkId: null }`: a new link is being drafted; otherwise the chosen link.
  const [linkEditor, setLinkEditor] = useState<{ linkId: string | null } | null>(null);
  const editingLinkId = linkEditor?.linkId ?? null;
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [revealedLink, setRevealedLink] = useState<{ label: string; url: string } | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(30);
  const [reason, setReason] = useState("");
  const path = tripPath(trip.id, "public-projection");
  const linksPath = tripPath(trip.id, "share-links");
  const refreshStatus = (subject: string) => [ownerKeys.tripResource(subject, trip.id, "public-projection"), ownerKeys.tripResource(subject, trip.id, "overview")];
  const refreshLinks = (subject: string) => [ownerKeys.tripResource(subject, trip.id, "share-links"), ownerKeys.tripResource(subject, trip.id, "overview")];

  const savePublic = useOwnerMutation<ShareScope, PublicProjectionStatus>({
    fallback: "De publieke scope kon niet worden opgeslagen.",
    request: (scope) => ({ path, method: "PUT", body: scope }),
    invalidate: refreshStatus,
  });
  const previewPublicScope = useOwnerMutation<void, ProjectionDocument>({
    fallback: "De publieke preview kon niet worden geladen.",
    request: () => ({ path: `${path}/preview`, method: "POST" }),
    invalidate: () => [],
    // A preview is shown once and not kept.
    gcTime: 0,
  });
  const togglePublic = useOwnerMutation<{ publish: boolean; reason: string | null }, PublicProjectionStatus>({
    fallback: "De publicatiestatus kon niet worden gewijzigd.",
    request: ({ publish, reason: why }) => ({ path: `${path}/${publish ? "publish" : "unpublish"}`, method: "POST", ...(!publish && why ? { body: { reason: why } } : {}) }),
    invalidate: (subject) => [...refreshStatus(subject), ownerKeys.trips(subject)],
  });
  const saveLink = useOwnerMutation<{ id: string | null; label: string; scope: ShareScope }, ShareLink>({
    fallback: "De deellink kon niet worden opgeslagen.",
    request: ({ id, label, scope }) => ({ path: id ? `${linksPath}/${id}` : linksPath, method: id ? "PATCH" : "POST", body: { label, scope } }),
    invalidate: refreshLinks,
  });
  const previewLinkScope = useOwnerMutation<ShareLink, ProjectionDocument>({
    fallback: "De linkpreview kon niet worden geladen.",
    request: (link) => ({ path: `${linksPath}/${link.id}/preview`, method: "POST" }),
    invalidate: () => [],
    gcTime: 0,
  });
  // The owner-managed URL remains in the owner-only in-memory cache; the PWA
  // never persists it locally.
  const activate = useOwnerMutation<LinkAction, ShareLink>({
    fallback: "De veilige link kon niet worden gemaakt.",
    request: ({ link, action, expiresInDays: days, reason: why }) => ({ path: `${linksPath}/${link.id}/${action}`, method: "POST", body: { expires_in_days: days, reason: why } }),
    invalidate: refreshLinks,
    gcTime: 0,
  });
  const revoke = useOwnerMutation<{ link: ShareLink; reason: string | null }, ShareLink>({
    fallback: "De link kon niet worden ingetrokken.",
    request: ({ link, reason: why }) => ({ path: `${linksPath}/${link.id}/revoke`, method: "POST", body: { reason: why } }),
    invalidate: refreshLinks,
  });

  const selectedLink = links.find((link) => link.id === editingLinkId) ?? null;
  const lockedLink = selectedLink?.state === "revoked" || selectedLink?.state === "expired";

  const publicRecord = useRecordForm<PublicValues, PublicProjectionStatus>({
    defaultValues: { scope: emptyScope() },
    fallback: "De publieke scope kon niet worden opgeslagen.",
    submit: (values) => savePublic.mutateAsync(values.scope),
    onSuccess: (saved) => { publicRecord.load({ scope: cloneScope(saved.scope) }); setNotice("Keuze bewaard. Niet-geselecteerde inhoud blijft privé."); },
  });
  const linkRecord = useRecordForm<LinkValues, ShareLink>({
    defaultValues: { label: "", scope: emptyScope() },
    fallback: "De deellink kon niet worden opgeslagen.",
    serverFields: { label: "label" },
    // Saving never activates: a new link is created as a draft the owner can preview, then activate explicitly.
    submit: (values) => saveLink.mutateAsync({ id: editingLinkId, label: values.label.trim(), scope: values.scope }),
    onSuccess: (saved) => {
      const wasNew = editingLinkId === null;
      loadLink(saved);
      setNotice(wasNew ? "Concept opgeslagen. Bekijk het voorbeeld en activeer de link zodra je tevreden bent." : "Deellink en scope opgeslagen.");
    },
  });

  // The public scope follows the server, but never overwrites edits that are not saved yet.
  const publicDirty = useRef(false);
  publicDirty.current = publicRecord.dirty;
  const serverScope = publicStatus?.scope;
  useEffect(() => {
    if (serverScope && !publicDirty.current) publicRecord.load({ scope: cloneScope(serverScope) });
    // `load` is stable; only a new server scope should reload the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const open = () => next ? loadLink(next) : loadNewLink();
    if (linkRecord.dirty) {
      confirmation.ask({
        title: "Niet-opgeslagen linkwijzigingen verwerpen?",
        description: "De naam en scope die je hebt aangepast worden niet opgeslagen.",
        confirmLabel: "Wijzigingen verwerpen",
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

  const fail = (fallback: string) => (error: unknown) => setNotice(errorMessage(error, fallback));

  async function previewPublic() {
    const values = publicRecord.form.state.values;
    const saved = await savePublic.mutateAsync(values.scope);
    publicRecord.load({ scope: cloneScope(saved.scope) });
    const document = await previewPublicScope.mutateAsync();
    setPreview({ name: "Publieke preview", audience: "public", document: document as Projection });
  }

  function toggle() {
    if (!publicStatus) return;
    const publish = publicStatus.surface_state !== "published";
    togglePublic.mutateAsync({ publish, reason: reason.trim() || null }).then(() => { setReason(""); setNotice(publish ? "Publieke pagina gepubliceerd." : "Publieke pagina ingetrokken."); }, fail("De publicatiestatus kon niet worden gewijzigd."));
  }

  async function previewLink() {
    let target = selectedLink;
    if (!target || !lockedLink) {
      const values = linkRecord.form.state.values;
      target = await saveLink.mutateAsync({ id: editingLinkId, label: values.label.trim(), scope: values.scope });
      loadLink(target);
    }
    const document = await previewLinkScope.mutateAsync(target);
    setLinkEditor(null);
    setPreview({ name: `Preview van ${target.label}`, audience: "share", linkId: target.id, document: document as Projection });
  }

  function activateLink(action: "activate" | "rotate") {
    if (!selectedLink) return;
    activate.mutateAsync({ link: selectedLink, action, expiresInDays, reason: reason.trim() || null }).then((result) => {
      activate.reset();
      loadLink(result);
      if (!result.token) { setNotice("De link kon niet worden aangemaakt."); return; }
      setRevealedLink({ label: result.label, url: shareUrl(result.token) });
      setLinkEditor(null);
      setNotice("De link is actief en kan later opnieuw worden gekopieerd.");
    }, fail("De veilige link kon niet worden gemaakt."));
  }

  function revealCurrentLink() {
    if (!selectedLink?.token) return;
    setRevealedLink({ label: selectedLink.label, url: shareUrl(selectedLink.token) });
    setLinkEditor(null);
  }

  function revokeLink() {
    if (!selectedLink) return;
    confirmation.ask({
      title: "Deellink “" + selectedLink.label + "” intrekken?",
      description: "Wie de huidige veilige link heeft, kan de verborgen pagina daarna niet meer openen.",
      confirmLabel: "Link intrekken",
      onConfirm: () => revoke.mutateAsync({ link: selectedLink, reason: reason.trim() || null }).then((saved) => { loadLink(saved); setNotice("Deellink ingetrokken."); }, fail("De link kon niet worden ingetrokken.")),
    });
  }

  async function copyLink() {
    if (!revealedLink) return;
    await navigator.clipboard.writeText(revealedLink.url);
    setNotice("Link gekopieerd.");
  }

  async function copyPublicLink() {
    if (!publicStatus?.slug) return;
    await navigator.clipboard.writeText(publicUrl(publicStatus.slug));
    setNotice("Publieke link gekopieerd.");
  }

  const catalog = useMemo<CatalogItem[]>(() => {
    const approved = <T extends { review_state: string }>(items: T[] | undefined) => (items ?? []).filter((item) => item.review_state === "approved");
    const updateTitles = new Map(trip.travel_updates.map((update) => [update.id, update.title]));
    return [
      ...trip.travel_updates.map((item) => ({ kind: "travel_update" as const, id: item.id, label: item.title, detail: "Reisupdate", visibility: item.visibility })),
      ...(visitsQuery.data ?? []).map((item) => ({ kind: "visit" as const, id: item.id, label: visitTitle(item), detail: "Bezoek: de plek, de tekst voor bezoekers en de datum; de tijd alleen als je die deelt", visibility: item.visibility })),
      ...(placesQuery.data ?? []).map((item) => ({ kind: "area" as const, id: item.id, label: item.label, detail: "Gebied", visibility: item.visibility })),
      // Only locations the owner has named or shared: most locations are hotels and endpoints that stay private.
      ...(locationsQuery.data ?? []).filter((item) => item.label || item.visibility !== "private").map((item) => ({ kind: "location" as const, id: item.id, label: item.label ?? "Locatie zonder publieke naam", detail: "Locatie: alleen naam, gebied en ligging", visibility: item.visibility })),
      ...(routesQuery.data ?? []).map((item) => ({ kind: "route" as const, id: item.id, label: `${ROUTE_MODE_LABELS[item.mode]}: ${routeTitle(item)}`, detail: "Bezoekers zien de gebieden, het vervoermiddel en de lijn, nooit boekingscode, reisklasse, notities of documenten", visibility: item.visibility })),
      ...(staysQuery.data ?? []).map((item) => ({ kind: "stay" as const, id: item.id, label: stayLabel(item), detail: `Bezoekers zien alleen ${item.area?.label ?? "(nog geen gebied gekozen)"} en de nachten`, visibility: item.visibility })),
      ...media.flatMap((asset, index) => approved(mediaDerivatives.data[index]).filter((item) => item.purpose === "share").map((item) => ({ kind: "media_derivative" as const, id: item.id, label: asset.original_filename ?? "Goedgekeurd medium", detail: asset.media_kind === "video" ? "Goedgekeurde video" : "Goedgekeurde foto", visibility: item.visibility, followsUpdate: updateTitles.get(item.travel_update_id ?? "") }))),
    ];
  }, [trip, placesQuery.data, locationsQuery.data, routesQuery.data, visitsQuery.data, staysQuery.data, media, mediaDerivatives.data]);

  const readError = [statusQuery, linksQuery, placesQuery, locationsQuery, routesQuery, visitsQuery, staysQuery, mediaQuery].find((query) => query.isError)?.error ?? mediaDerivatives.error;
  const message = notice ?? (readError ? errorMessage(readError, "Je publicaties konden niet worden geladen.") : statusQuery.isPending ? "Laad je publicaties…" : "Kies per onderdeel wie het ziet. Nieuwe onderdelen zijn privé.");
  const isPublished = publicStatus?.surface_state === "published";

  return <section className="card manager publication-manager" aria-labelledby="publication-manager-title">
    <div className="capture-heading"><div><h3 id="publication-manager-title">Delen</h3><p>Elk onderdeel heeft dezelfde keuze: privé, iedereen, of zelf kiezen per publiek. Hier stel je dat in voor alles tegelijk, of per publiek voor wat op “Zelf kiezen” staat.</p></div></div>
    <p className="help" role="status">{message}</p>
    {revealedLink && <RecordDialog open title="Deellink" onDismiss={() => setRevealedLink(null)}><section className="token-reveal" aria-live="assertive"><strong>{revealedLink.label}</strong><p>Wie deze link heeft, kan de actieve verborgen pagina openen. Je kunt hem later opnieuw kopiëren zolang de link actief blijft.</p><code>{revealedLink.url}</code><button type="button" onClick={() => void copyLink().catch(fail("Kopiëren lukte niet."))}>Link kopiëren</button><button className="secondary compact" type="button" onClick={() => setRevealedLink(null)}>Sluiten</button></section></RecordDialog>}
    <SharingReview overview={overviewQuery.data} />
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Zichtbaarheid per onderdeel</h3><p>Dezelfde keuze als in de editor van elk onderdeel. Dit toont een instelling, niet wie het al daadwerkelijk ontvangt — dat zie je bij “Controle voor het delen” hierboven.</p></div></div><VisibilityOverview tripId={trip.id} catalog={catalog} /></div>
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Voor iedereen</h3><p>{isPublished ? "Deze pagina is voor iedereen bereikbaar." : "Deze pagina is nog niet bereikbaar voor bezoekers."}</p></div></div>
      {isPublished && publicStatus?.slug && <p className="help public-link-live"><code>{publicUrl(publicStatus.slug)}</code></p>}
      <RecordForm record={publicRecord} submitLabel="Keuze bewaren" pendingLabel="Bewaren…" actions={<>
        {isPublished && publicStatus?.slug && <a className="action-link secondary" href={publicUrl(publicStatus.slug)} target="_blank" rel="noreferrer">Open publieke pagina</a>}
        {isPublished && publicStatus?.slug && <button className="secondary" type="button" onClick={() => void copyPublicLink().catch(fail("Kopiëren lukte niet."))}>Kopieer link</button>}
        <button className="secondary" type="button" onClick={() => void previewPublic().catch(fail("Voorbeeld laden lukte niet."))}>Bekijk als bezoeker</button>
        <button className={isPublished ? "danger" : ""} type="button" disabled={!publicStatus || togglePublic.isPending} onClick={toggle}>{isPublished ? "Niet meer met iedereen delen" : "Met iedereen delen"}</button>
      </>}>
        <publicRecord.form.Field name="scope">{(field) => <ScopeEditor name="Wat iedereen mag zien" scope={field.state.value} setScope={(scope) => { field.handleChange(scope); setPreview(null); }} catalog={catalog} hasDates={Boolean(trip.starts_on)} tripId={trip.id} onError={fail("De zichtbaarheid kon niet worden bewaard.")} />}</publicRecord.form.Field>
      </RecordForm>
    </div>
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Verborgen deellinks</h3><p>Elke link heeft een eigen live scope en kan later worden ingetrokken of geroteerd.</p></div><button className="secondary compact" type="button" onClick={() => switchLinkEditor(null)}>Nieuwe link</button></div>
      {linkSeries.length > 0 && <div className="link-list">{linkSeries.map(({ id, current, history }) => <div className="link-series" key={id}><button type="button" className={`link-row ${current.id === editingLinkId ? "selected" : ""}`} onClick={() => switchLinkEditor(current)}><strong>{current.label}</strong><span>{current.state} · verloopt {dateLabel(current.expires_at)}{history.length ? ` · ${history.length} eerdere ${history.length === 1 ? "versie" : "versies"}` : ""}</span></button>{history.length > 0 && <details className="link-history"><summary>{history.length} eerdere {history.length === 1 ? "versie" : "versies"} bekijken</summary><div className="link-list">{history.map((link) => <button type="button" className={`link-row ${link.id === editingLinkId ? "selected" : ""}`} key={link.id} onClick={() => switchLinkEditor(link)}><strong>{link.label}</strong><span>{link.state} · verlopen {dateLabel(link.revoked_at ?? link.expires_at)}</span></button>)}</div></details>}</div>)}</div>}
      {links.length === 0 && !linksQuery.isPending && <p>Nog geen deellinks. Kies “Nieuwe link” om een verborgen link met een eigen scope te maken.</p>}
    </div>
    <RecordDialog open={linkEditor !== null} title={editingLinkId ? "Deellink bewerken" : "Deellink toevoegen"} dirty={linkRecord.dirty} onDismiss={closeLinkEditor}>
      {linkEditor !== null && <div className="link-editor">
        <RecordForm record={linkRecord} submitLabel={selectedLink ? "Link opslaan" : "Concept opslaan"} pendingLabel="Opslaan…" disabled={lockedLink} actions={<button className="secondary" type="button" disabled={lockedLink || !linkRecord.values.label.trim()} onClick={() => void previewLink().catch(fail("Voorbeeld laden lukte niet."))}>Voorbeeld bekijken</button>}>
          <linkRecord.form.Field name="label" listeners={{ onChange: () => setPreview(null) }} validators={{ onChange: requiredText("Geef de link een naam."), onSubmit: requiredText("Geef de link een naam.") }}>{(field) => <TextField field={field} label="Naam van de link" required maxLength={120} disabled={lockedLink} placeholder="Bijvoorbeeld: familie" />}</linkRecord.form.Field>
          <linkRecord.form.Field name="scope">{(field) => <ScopeEditor name="Scope voor verborgen link" scope={field.state.value} setScope={(scope) => { field.handleChange(scope); setPreview(null); }} catalog={catalog} hasDates={Boolean(trip.starts_on)} tripId={trip.id} onError={fail("De zichtbaarheid kon niet worden bewaard.")} disabled={lockedLink} />}</linkRecord.form.Field>
        </RecordForm>
        <div className="lifecycle"><div className="field-row"><label>Geldig gedurende (dagen)<input type="number" min="1" max="90" disabled={expiresInDays === null} value={expiresInDays ?? 30} onChange={(event) => setExpiresInDays(Number(event.target.value))} /></label><label className="scope-choice"><input type="checkbox" checked={expiresInDays === null} onChange={(event) => setExpiresInDays(event.target.checked ? null : 30)} />Geen vervaldatum</label><label>Reden <span className="optional">(optioneel)</span><input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label></div>{expiresInDays === null && <p className="help">Deze link blijft geldig totdat je hem intrekt of roteert.</p>}{selectedLink?.state === "draft" && <p className="help">Dit concept is nog niet actief. Bekijk het voorbeeld en klik op “Activeren” zodra je tevreden bent.</p>}<div className="button-row">{selectedLink?.state === "draft" && <button type="button" onClick={() => activateLink("activate")}>Activeren</button>}{selectedLink?.state === "active" && <><button className="secondary" type="button" disabled={!selectedLink.token} onClick={revealCurrentLink}>Link tonen</button><button className="danger" type="button" onClick={revokeLink}>Link intrekken</button><button type="button" onClick={() => activateLink("rotate")}>Roteren en nieuwe link tonen</button></>}</div>{selectedLink?.state === "active" && !selectedLink.token && <p className="help">Deze oudere link is nog actief, maar de URL is niet bewaard. Roteer hem één keer om hem voortaan te kunnen kopiëren.</p>}</div>
      </div>}
    </RecordDialog>
    {preview && owner && <RecordDialog open title={preview.name} className="preview-dialog" onDismiss={() => setPreview(null)}><section className="projection-preview" aria-live="polite"><p>{preview.audience === "public" ? "Doelgroep: iedereen" : "Doelgroep: alleen wie de actieve verborgen link heeft"} · {preview.audience === "public" ? isPublished ? "nu gedeeld" : "nog niet gedeeld" : links.find((link) => link.id === preview.linkId)?.state ?? "concept"}</p><p>{projectionSummary(preview.document)}</p><p className="help">Alleen geselecteerde velden verschijnen hieronder. Privégegevens, boekingen en andere niet-geselecteerde velden blijven verborgen. Dit voorbeeld deelt niets en maakt geen toegangscode aan.</p><RenderedPreview projection={preview.document} audience={preview.audience} tripId={trip.id} linkId={preview.linkId} session={owner.session} /><details><summary>Geleverde velden inspecteren</summary><pre>{JSON.stringify(preview.document, null, 2)}</pre></details></section></RecordDialog>}
    {confirmation.dialog}
  </section>;
}
