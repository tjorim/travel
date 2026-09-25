import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { RecordForm, requiredText, TextField } from "../forms/fields";
import { useConfirmation } from "../forms/useConfirmation";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { derivativesQueryOptions, tripPath, useOwner, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import { RenderedPreview } from "./RenderedPreview";
import { VisibilityControl } from "./visibility";
import type { Projection } from "../ProjectionView";
import { stayLabel, type ProjectionDocument, type PublicProjectionStatus, type ShareLink, type ShareScope, type ShareScopeKind, type Trip, type Visibility } from "../tracker-model";

type CatalogItem = { kind: ShareScopeKind; id: string; label: string; detail: string; visibility: Visibility; /** A photo attached to a reisupdate is shared with it, so it has no choice of its own. */ followsUpdate?: string };

const GROUP_TITLES: Record<ShareScopeKind, string> = {
  travel_update: "Reisupdates",
  route_stage: "Haltes",
  place: "Plaatsen",
  broad_route: "Routes op kaart",
  stay: "Verblijven",
  transport_leg: "Vervoer",
  media_derivative: "Foto’s",
  document_derivative: "Geredigeerde documenten",
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

function dateLabel(value: string | null): string {
  return value ? new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium" }).format(new Date(value)) : "—";
}

function projectionSummary(document: ProjectionDocument): string {
  const count = document.route_stages.length + document.places.length + document.updates.length + document.stays.length + document.media.length + document.documents.length + document.route.length + document.transport.length;
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

/** One kind of record an audience can list. Collapsed so a long list stays a short page; the count says what is chosen. */
function ScopeGroup({ kind, items, scope, setScope }: { kind: ShareScopeKind; items: CatalogItem[]; scope: ShareScope; setScope: (scope: ShareScope) => void }) {
  const chosen = (item: CatalogItem) => scope.items.some((value) => value.kind === item.kind && value.id === item.id);
  const count = items.filter(chosen).length;
  return <details className="scope-group">
    <summary><strong>{GROUP_TITLES[kind]}</strong><span>{count} van {items.length} gekozen</span></summary>
    <div className="scope-group-body">
      <div className="button-row">
        <button className="secondary compact" type="button" disabled={count === items.length} onClick={() => setScope(items.reduce((current, item) => updateItem(current, item, true), scope))}>Alles kiezen</button>
        <button className="secondary compact" type="button" disabled={count === 0} onClick={() => setScope(items.reduce((current, item) => updateItem(current, item, false), scope))}>Niets kiezen</button>
      </div>
      <div className="scope-items">{items.map((item) => <article className={`scope-item ${chosen(item) ? "included" : ""}`} key={`${item.kind}-${item.id}`}><label className="scope-choice"><input type="checkbox" checked={chosen(item)} onChange={(event) => setScope(updateItem(scope, item, event.target.checked))} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></label></article>)}</div>
    </div>
  </details>;
}

/** What every audience gets without being chosen, and what stays private: the same choice as on each record. */
function VisibilityNote({ catalog }: { catalog: CatalogItem[] }) {
  const own = catalog.filter((item) => !item.followsUpdate);
  if (!own.length) return null;
  const everyone = own.filter((item) => item.visibility === "everyone").length;
  const privateCount = own.filter((item) => item.visibility === "private").length;
  return <p className="help scope-updates-note">Wie wat ziet stel je in bij elk onderdeel, of hieronder bij “Zichtbaarheid per onderdeel”: {everyone} voor iedereen verschijnt hier altijd, {privateCount} privé blijft verborgen. Alleen onderdelen met “Zelf kiezen” kies je hieronder per publiek.</p>;
}

function ScopeEditor({ scope, setScope, name, catalog, hasDates, disabled = false }: { scope: ShareScope; setScope: (scope: ShareScope) => void; name: string; catalog: CatalogItem[]; hasDates: boolean; disabled?: boolean }) {
  const groups = groupBy(catalog.filter((item) => item.visibility === "custom"));
  return <fieldset className="scope-editor" disabled={disabled}><legend>{name}</legend><p>Kies alleen wat bezoekers mogen zien. Alles wat je niet kiest blijft privé.</p>
    <div className="scope-trip-fields"><label className="scope-choice"><input type="checkbox" checked={scope.trip.title} onChange={(event) => setScope({ ...scope, trip: { ...scope.trip, title: event.target.checked } })} />Reistitel</label><label className="scope-choice"><input type="checkbox" checked={scope.trip.summary} onChange={(event) => setScope({ ...scope, trip: { ...scope.trip, summary: event.target.checked } })} />Samenvatting</label><label>Hoe precies mogen de reisdatums zijn?<select value={scope.trip.dates ?? ""} onChange={(event) => setScope({ ...scope, trip: { ...scope.trip, dates: (event.target.value || null) as ShareScope["trip"]["dates"] } })}><option value="">Niet tonen</option>{Object.entries(DATE_PRECISIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{scope.trip.dates === "day" && <small>Bezoekers zien begin- en einddag.</small>}{scope.trip.dates === "month" && <small>Bezoekers zien alleen begin- en eindmaand.</small>}{scope.trip.dates === "year" && <small>Bezoekers zien alleen het reisjaar.</small>}{scope.trip.dates && !hasDates && <small>Deze reis heeft nog geen reisdatums.</small>}</div>
    <VisibilityNote catalog={catalog} />
    <div className="scope-groups">{[...groups].map(([kind, items]) => <ScopeGroup key={kind} kind={kind} items={items} scope={scope} setScope={setScope} />)}</div>
    {!groups.size && <p className="help">Geen onderdeel staat op “Zelf kiezen”. Zet een onderdeel op “Zelf kiezen in Delen” om het hier per publiek te kiezen.</p>}
  </fieldset>;
}

/** Every shareable record with the same control as in its own editor; both write one field. */
function VisibilityOverview({ tripId, catalog }: { tripId: string; catalog: CatalogItem[] }) {
  const groups = groupBy(catalog);
  if (!groups.size) return <p className="help">Er zijn nog geen onderdelen die je kunt delen. Maak bijvoorbeeld een reisupdate, plaats of halte.</p>;
  return <div className="scope-groups">{[...groups].map(([kind, items]) => <details className="scope-group" key={kind}>
    <summary><strong>{GROUP_TITLES[kind]}</strong><span>{items.filter((item) => item.visibility !== "private" || item.followsUpdate).length} van {items.length} gedeeld</span></summary>
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
  const placesQuery = useTripResource(trip.id, "places/broad");
  const routesQuery = useTripResource(trip.id, "broad-routes");
  const staysQuery = useTripResource(trip.id, "stays");
  const exactPlacesQuery = useTripResource(trip.id, "places");
  const transportQuery = useTripResource(trip.id, "transport-legs");
  const mediaQuery = useTripResource(trip.id, "media");
  const documentsQuery = useTripResource(trip.id, "documents");
  const media = useMemo(() => mediaQuery.data ?? [], [mediaQuery.data]);
  const documents = useMemo(() => documentsQuery.data ?? [], [documentsQuery.data]);
  const transport = useMemo(() => transportQuery.data ?? [], [transportQuery.data]);
  // One derivative read per asset; the combined result keeps a fixed shape however many assets there are.
  const mediaDerivatives = useQueries({ queries: media.map((asset) => derivativesQueryOptions(owner, trip.id, "media", asset.id)), combine: combineDerivatives });
  const documentDerivatives = useQueries({ queries: documents.map((asset) => derivativesQueryOptions(owner, trip.id, "documents", asset.id)), combine: combineDerivatives });
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
  const refreshStatus = (subject: string) => [ownerKeys.tripResource(subject, trip.id, "public-projection")];
  const refreshLinks = (subject: string) => [ownerKeys.tripResource(subject, trip.id, "share-links")];

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
    submit: async (values) => {
      const saved = await saveLink.mutateAsync({ id: editingLinkId, label: values.label.trim(), scope: values.scope });
      return editingLinkId ? saved : activate.mutateAsync({ link: saved, action: "activate", expiresInDays, reason: reason.trim() || null });
    },
    onSuccess: (saved) => {
      loadLink(saved);
      if (saved.state === "active" && saved.token) {
        setRevealedLink({ label: saved.label, url: shareUrl(saved.token) });
        setLinkEditor(null);
        setNotice("De link is actief en kan later opnieuw worden gekopieerd.");
        return;
      }
      setNotice("Deellink en scope opgeslagen.");
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

  const catalog = useMemo<CatalogItem[]>(() => {
    const approved = <T extends { review_state: string }>(items: T[] | undefined) => (items ?? []).filter((item) => item.review_state === "approved");
    const endpoint = (area: { label?: string | null; country_code?: string | null } | null | undefined, fallback: { locality?: string | null; country_code?: string | null }) => area?.label ?? ([fallback.locality, fallback.country_code].filter(Boolean).join(" · ") || "Onbekende plaats");
    const transportKind: Record<string, string> = { flight: "Vlucht", train: "Trein", bus: "Bus", ferry: "Veerboot", car: "Auto", other: "Vervoer" };
    const updateTitles = new Map(trip.travel_updates.map((update) => [update.id, update.title]));
    return [
      ...trip.travel_updates.map((item) => ({ kind: "travel_update" as const, id: item.id, label: item.title, detail: "Reisupdate", visibility: item.visibility })),
      ...trip.route_stages.map((item) => ({ kind: "route_stage" as const, id: item.id, label: item.label ?? item.place.label, detail: "Halte", visibility: item.visibility })),
      ...(placesQuery.data ?? []).map((item) => ({ kind: "place" as const, id: item.id, label: item.label, detail: "Stad of gebied", visibility: item.visibility })),
      // Only spots the owner has named or shared: most exact places are hotels and endpoints that stay private.
      ...(exactPlacesQuery.data ?? []).filter((item) => item.label || item.visibility !== "private").map((item) => ({ kind: "place" as const, id: item.id, label: item.label ?? "Plek zonder publieke naam", detail: "Plek — alleen naam, stad en ligging", visibility: item.visibility })),
      ...(routesQuery.data ?? []).map((item) => ({ kind: "broad_route" as const, id: item.id, label: item.label, detail: "Route op kaart", visibility: item.visibility })),
      ...(staysQuery.data ?? []).map((item) => ({ kind: "stay" as const, id: item.id, label: stayLabel(item), detail: `Bezoekers zien alleen ${item.area?.label ?? "(nog geen gebied gekozen)"} en de nachten`, visibility: item.visibility })),
      ...transport.map((item) => ({ kind: "transport_leg" as const, id: item.id, label: `${transportKind[item.kind]}: ${endpoint(item.departure_area, item.departure_place)} → ${endpoint(item.arrival_area, item.arrival_place)}`, detail: "Vervoerssamenvatting zonder boekingscode, reisklasse, notities of documenten", visibility: item.visibility })),
      ...media.flatMap((asset, index) => approved(mediaDerivatives.data[index]).filter((item) => item.purpose === "share").map((item) => ({ kind: "media_derivative" as const, id: item.id, label: asset.original_filename ?? "Goedgekeurde foto", detail: "Goedgekeurde foto", visibility: item.visibility, followsUpdate: updateTitles.get(item.travel_update_id ?? "") }))),
      ...documents.flatMap((asset, index) => approved(documentDerivatives.data[index]).map((item) => ({ kind: "document_derivative" as const, id: item.id, label: asset.title, detail: "Goedgekeurde geredigeerde kopie", visibility: item.visibility }))),
    ];
  }, [trip, placesQuery.data, exactPlacesQuery.data, routesQuery.data, staysQuery.data, transport, media, documents, mediaDerivatives.data, documentDerivatives.data]);

  const readError = [statusQuery, linksQuery, placesQuery, exactPlacesQuery, routesQuery, staysQuery, transportQuery, mediaQuery, documentsQuery].find((query) => query.isError)?.error ?? mediaDerivatives.error ?? documentDerivatives.error;
  const message = notice ?? (readError ? errorMessage(readError, "Je publicaties konden niet worden geladen.") : statusQuery.isPending ? "Laad je publicaties…" : "Kies per onderdeel wie het ziet. Nieuwe onderdelen zijn privé.");
  const isPublished = publicStatus?.surface_state === "published";

  return <section className="card manager publication-manager" aria-labelledby="publication-manager-title">
    <div className="capture-heading"><div><h3 id="publication-manager-title">Delen</h3><p>Elk onderdeel heeft dezelfde keuze: privé, iedereen, of zelf kiezen per publiek. Hier stel je dat in voor alles tegelijk, of per publiek voor wat op “Zelf kiezen” staat.</p></div></div>
    <p className="help" role="status">{message}</p>
    {revealedLink && <RecordDialog open title="Deellink" onDismiss={() => setRevealedLink(null)}><section className="token-reveal" aria-live="assertive"><strong>{revealedLink.label}</strong><p>Wie deze link heeft, kan de actieve verborgen pagina openen. Je kunt hem later opnieuw kopiëren zolang de link actief blijft.</p><code>{revealedLink.url}</code><button type="button" onClick={() => void copyLink().catch(fail("Kopiëren lukte niet."))}>Link kopiëren</button><button className="secondary compact" type="button" onClick={() => setRevealedLink(null)}>Sluiten</button></section></RecordDialog>}
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Zichtbaarheid per onderdeel</h3><p>Dezelfde keuze als in de editor van elk onderdeel.</p></div></div><VisibilityOverview tripId={trip.id} catalog={catalog} /></div>
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Voor iedereen</h3><p>{isPublished ? "Deze pagina is voor iedereen bereikbaar." : "Deze pagina is nog niet bereikbaar voor bezoekers."}</p></div></div>
      <RecordForm record={publicRecord} submitLabel="Keuze bewaren" pendingLabel="Bewaren…" actions={<>
        <button className="secondary" type="button" onClick={() => void previewPublic().catch(fail("Voorbeeld laden lukte niet."))}>Bekijk als bezoeker</button>
        <button className={isPublished ? "danger" : ""} type="button" disabled={!publicStatus || togglePublic.isPending} onClick={toggle}>{isPublished ? "Niet meer met iedereen delen" : "Met iedereen delen"}</button>
      </>}>
        <publicRecord.form.Field name="scope">{(field) => <ScopeEditor name="Wat iedereen mag zien" scope={field.state.value} setScope={(scope) => { field.handleChange(scope); setPreview(null); }} catalog={catalog} hasDates={Boolean(trip.starts_on)} />}</publicRecord.form.Field>
      </RecordForm>
    </div>
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Verborgen deellinks</h3><p>Elke link heeft een eigen live scope en kan later worden ingetrokken of geroteerd.</p></div><button className="secondary compact" type="button" onClick={() => switchLinkEditor(null)}>Nieuwe link</button></div>
      {linkSeries.length > 0 && <div className="link-list">{linkSeries.map(({ id, current, history }) => <div className="link-series" key={id}><button type="button" className={`link-row ${current.id === editingLinkId ? "selected" : ""}`} onClick={() => switchLinkEditor(current)}><strong>{current.label}</strong><span>{current.state} · verloopt {dateLabel(current.expires_at)}{history.length ? ` · ${history.length} eerdere ${history.length === 1 ? "versie" : "versies"}` : ""}</span></button>{history.length > 0 && <details className="link-history"><summary>{history.length} eerdere {history.length === 1 ? "versie" : "versies"} bekijken</summary><div className="link-list">{history.map((link) => <button type="button" className={`link-row ${link.id === editingLinkId ? "selected" : ""}`} key={link.id} onClick={() => switchLinkEditor(link)}><strong>{link.label}</strong><span>{link.state} · verlopen {dateLabel(link.revoked_at ?? link.expires_at)}</span></button>)}</div></details>}</div>)}</div>}
      {links.length === 0 && !linksQuery.isPending && <p>Nog geen deellinks. Kies “Nieuwe link” om een verborgen link met een eigen scope te maken.</p>}
    </div>
    <RecordDialog open={linkEditor !== null} title={editingLinkId ? "Deellink bewerken" : "Deellink toevoegen"} dirty={linkRecord.dirty} onDismiss={closeLinkEditor}>
      {linkEditor !== null && <div className="link-editor">
        <RecordForm record={linkRecord} submitLabel={selectedLink ? "Link opslaan" : "Link maken"} pendingLabel="Opslaan…" disabled={lockedLink} actions={selectedLink ? <button className="secondary" type="button" onClick={() => void previewLink().catch(fail("Voorbeeld laden lukte niet."))}>Bekijk met deze link</button> : undefined}>
          <linkRecord.form.Field name="label" listeners={{ onChange: () => setPreview(null) }} validators={{ onChange: requiredText("Geef de link een naam."), onSubmit: requiredText("Geef de link een naam.") }}>{(field) => <TextField field={field} label="Naam van de link" required maxLength={120} disabled={lockedLink} placeholder="Bijvoorbeeld: familie" />}</linkRecord.form.Field>
          <linkRecord.form.Field name="scope">{(field) => <ScopeEditor name="Scope voor verborgen link" scope={field.state.value} setScope={(scope) => { field.handleChange(scope); setPreview(null); }} catalog={catalog} hasDates={Boolean(trip.starts_on)} disabled={lockedLink} />}</linkRecord.form.Field>
        </RecordForm>
        <div className="lifecycle"><div className="field-row"><label>Geldig gedurende (dagen)<input type="number" min="1" max="90" disabled={expiresInDays === null} value={expiresInDays ?? 30} onChange={(event) => setExpiresInDays(Number(event.target.value))} /></label><label className="scope-choice"><input type="checkbox" checked={expiresInDays === null} onChange={(event) => setExpiresInDays(event.target.checked ? null : 30)} />Geen vervaldatum</label><label>Reden <span className="optional">(optioneel)</span><input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label></div>{expiresInDays === null && <p className="help">Deze link blijft geldig totdat je hem intrekt of roteert.</p>}{!selectedLink && <p className="help">“Link maken” activeert de link meteen met deze geldigheid.</p>}<div className="button-row">{selectedLink?.state === "draft" && <button type="button" onClick={() => activateLink("activate")}>Activeren</button>}{selectedLink?.state === "active" && <><button className="secondary" type="button" disabled={!selectedLink.token} onClick={revealCurrentLink}>Link tonen</button><button className="danger" type="button" onClick={revokeLink}>Link intrekken</button><button type="button" onClick={() => activateLink("rotate")}>Roteren en nieuwe link tonen</button></>}</div>{selectedLink?.state === "active" && !selectedLink.token && <p className="help">Deze oudere link is nog actief, maar de URL is niet bewaard. Roteer hem één keer om hem voortaan te kunnen kopiëren.</p>}</div>
      </div>}
    </RecordDialog>
    {preview && owner && <RecordDialog open title={preview.name} className="preview-dialog" onDismiss={() => setPreview(null)}><section className="projection-preview" aria-live="polite"><p>{preview.audience === "public" ? "Doelgroep: iedereen" : "Doelgroep: alleen wie de actieve verborgen link heeft"} · {preview.audience === "public" ? isPublished ? "nu gedeeld" : "nog niet gedeeld" : links.find((link) => link.id === preview.linkId)?.state ?? "concept"}</p><p>{projectionSummary(preview.document)}</p><p className="help">Alleen geselecteerde velden verschijnen hieronder. Privégegevens, boekingen en andere niet-geselecteerde velden blijven verborgen. Dit voorbeeld deelt niets en maakt geen toegangscode aan.</p><RenderedPreview projection={preview.document} audience={preview.audience} tripId={trip.id} linkId={preview.linkId} session={owner.session} /><details><summary>Geleverde velden inspecteren</summary><pre>{JSON.stringify(preview.document, null, 2)}</pre></details></section></RecordDialog>}
    {confirmation.dialog}
  </section>;
}
