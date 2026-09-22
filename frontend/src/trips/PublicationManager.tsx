import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../auth-context";
import { RenderedPreview } from "./RenderedPreview";
import type { Projection } from "../ProjectionView";
import {
  apiError, apiHeaders, type BroadPlace, type BroadRoute, type BroadStayCard, type DocumentAsset,
  type DocumentDerivative, type MediaAsset, type MediaDerivative, type ProjectionDocument,
  type PublicProjectionStatus, type ShareLink, type ShareScope,
  type ShareScopeKind, type Trip,
} from "../tracker-model";

type CatalogItem = { kind: ShareScopeKind; id: string; label: string; detail: string; fields: string[] };

const fieldsFor: Record<ShareScopeKind, string[]> = {
  exact_place: ["navigation"],
  route_stage: ["position", "label", "place", "navigation"],
  broad_place: ["label", "country_code", "region", "latitude", "longitude", "navigation"],
  broad_route: ["label", "geometry", "date_precision"],
  moment_excerpt: ["title", "body", "date_precision", "story_date", "place", "navigation"],
  broad_stay_card: ["title", "date_precision", "place", "navigation"],
  media_derivative: ["image", "caption", "alt_text", "width", "height", "focal_x", "focal_y", "moment"],
  document_derivative: ["title", "file"],
};

const emptyScope = (): ShareScope => ({ schema_version: "travel/share-scope@1", trip: { title: true, summary: true }, items: [] });
function cloneScope(scope: Partial<ShareScope> | null | undefined): ShareScope {
  return {
    schema_version: "travel/share-scope@1",
    trip: { title: scope?.trip?.title ?? true, summary: scope?.trip?.summary ?? true },
    items: Array.isArray(scope?.items) ? scope.items.map((item) => ({ ...item, fields: [...item.fields] })) : [],
  };
}
const endpoint = (tripId: string) => `/api/trips/${tripId}`;

function dateLabel(value: string | null): string {
  return value ? new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium" }).format(new Date(value)) : "—";
}

function projectionSummary(document: ProjectionDocument): string {
  const count = document.route_stages.length + document.places.length + document.moments.length + document.stays.length + document.media.length + document.documents.length + document.route.length;
  return `${count} gekozen onderdelen · ${document.title ? "titel" : "geen titel"} · ${document.summary ? "samenvatting" : "geen samenvatting"}`;
}

export function PublicationManager({ trip }: { trip: Trip }) {
  const { session } = useAuth();
  const [publicStatus, setPublicStatus] = useState<PublicProjectionStatus | null>(null);
  const [publicScope, setPublicScope] = useState<ShareScope>(emptyScope());
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkScope, setLinkScope] = useState<ShareScope>(emptyScope());
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [message, setMessage] = useState("Laad je publicaties…");
  const [preview, setPreview] = useState<{ name: string; audience: "public" | "share"; linkId?: string; document: Projection } | null>(null);
  const [revealedToken, setRevealedToken] = useState<{ label: string; token: string } | null>(null);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [reason, setReason] = useState("");

  async function responseJson<T>(response: Response, fallback: string): Promise<T> {
    if (!response.ok) return apiError(response, fallback);
    return response.json() as Promise<T>;
  }

  async function loadLinks() {
    if (!session) return [];
    const loaded = await responseJson<ShareLink[]>(await fetch(`${endpoint(trip.id)}/share-links`, { headers: apiHeaders(session) }), "De deellinks konden niet worden geladen.");
    setLinks(loaded);
    return loaded;
  }

  async function load() {
    if (!session) return;
    const headers = apiHeaders(session);
    const [status, shareLinks, broadPlaces, routes, cards, media, documents] = await Promise.all([
      fetch(`${endpoint(trip.id)}/public-projection`, { headers }),
      fetch(`${endpoint(trip.id)}/share-links`, { headers }),
      fetch(`${endpoint(trip.id)}/places/broad`, { headers }),
      fetch(`${endpoint(trip.id)}/broad-routes`, { headers }),
      fetch(`${endpoint(trip.id)}/broad-stay-cards`, { headers }),
      fetch(`${endpoint(trip.id)}/media`, { headers }),
      fetch(`${endpoint(trip.id)}/documents`, { headers }),
    ]);
    const [loadedStatus, loadedLinks, loadedPlaces, loadedRoutes, loadedCards, loadedMedia, loadedDocuments] = await Promise.all([
      responseJson<PublicProjectionStatus>(status, "De publieke publicatie kon niet worden geladen."),
      responseJson<ShareLink[]>(shareLinks, "De deellinks konden niet worden geladen."),
      responseJson<BroadPlace[]>(broadPlaces, "De brede plaatsen konden niet worden geladen."),
      responseJson<BroadRoute[]>(routes, "De brede routes konden niet worden geladen."),
      responseJson<BroadStayCard[]>(cards, "De brede verblijfskaarten konden niet worden geladen."),
      responseJson<MediaAsset[]>(media, "Je media konden niet worden geladen."),
      responseJson<DocumentAsset[]>(documents, "Je documenten konden niet worden geladen."),
    ]);
    const [mediaDerivatives, documentDerivatives] = await Promise.all([
      Promise.all(loadedMedia.map(async (asset) => ({ asset, derivatives: await responseJson<MediaDerivative[]>(await fetch(`${endpoint(trip.id)}/media/${asset.id}/derivatives`, { headers }), "Media-afgeleiden konden niet worden geladen.") }))),
      Promise.all(loadedDocuments.map(async (asset) => ({ asset, derivatives: await responseJson<DocumentDerivative[]>(await fetch(`${endpoint(trip.id)}/documents/${asset.id}/derivatives`, { headers }), "Documentafgeleiden konden niet worden geladen.") }))),
    ]);
    const exactPlaces = new Map<string, { label: string }>();
    for (const moment of trip.moments) if (moment.place) exactPlaces.set(moment.place.id, { label: moment.title });
    const catalogItems: CatalogItem[] = [
      ...trip.route_stages.map((item) => ({ kind: "route_stage" as const, id: item.id, label: item.label ?? item.place.label, detail: "Brede route-etappe", fields: fieldsFor.route_stage })),
      ...loadedPlaces.map((item) => ({ kind: "broad_place" as const, id: item.id, label: item.label, detail: "Brede plaats", fields: fieldsFor.broad_place })),
      ...loadedRoutes.map((item) => ({ kind: "broad_route" as const, id: item.id, label: item.label, detail: "Brede route", fields: fieldsFor.broad_route })),
      ...trip.moment_excerpts.map((item) => ({ kind: "moment_excerpt" as const, id: item.id, label: item.title, detail: "Moment-uittreksel", fields: fieldsFor.moment_excerpt })),
      ...loadedCards.map((item) => ({ kind: "broad_stay_card" as const, id: item.id, label: item.title, detail: "Brede verblijfskaart", fields: fieldsFor.broad_stay_card })),
      ...[...exactPlaces.entries()].map(([id, item]) => ({ kind: "exact_place" as const, id, label: `Navigatie bij ${item.label}`, detail: "Alleen navigatie; geen plaatsdetails", fields: fieldsFor.exact_place })),
      ...mediaDerivatives.flatMap(({ asset, derivatives }) => derivatives.filter((item) => item.review_state === "approved").map((item) => ({ kind: "media_derivative" as const, id: item.id, label: asset.original_filename ?? "Goedgekeurde media-afgeleide", detail: "Goedgekeurde media-afgeleide", fields: fieldsFor.media_derivative }))),
      ...documentDerivatives.flatMap(({ asset, derivatives }) => derivatives.filter((item) => item.review_state === "approved").map((item) => ({ kind: "document_derivative" as const, id: item.id, label: asset.title, detail: "Goedgekeurde geredigeerde kopie", fields: fieldsFor.document_derivative }))),
    ];
    setPublicStatus(loadedStatus); setPublicScope(cloneScope(loadedStatus.scope)); setLinks(loadedLinks); setCatalog(catalogItems);
    setMessage("Kies alleen onderdelen en velden die je bewust wilt delen.");
  }

  useEffect(() => {
    setPreview(null); setRevealedToken(null); setEditingLinkId(null); setLinkLabel(""); setLinkScope(emptyScope());
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je publicaties konden niet worden geladen."));
  }, [session, trip]);

  const selectedLink = useMemo(() => links.find((link) => link.id === editingLinkId) ?? null, [editingLinkId, links]);

  function selectLink(link: ShareLink) {
    setEditingLinkId(link.id); setLinkLabel(link.label); setLinkScope(cloneScope(link.scope)); setPreview(null); setRevealedToken(null); setReason("");
  }

  function updateItem(scope: ShareScope, setScope: (scope: ShareScope) => void, item: CatalogItem, included: boolean) {
    const current = scope.items.find((value) => value.kind === item.kind && value.id === item.id);
    const items = included
      ? current ? scope.items : [...scope.items, { kind: item.kind, id: item.id, fields: [...item.fields] }]
      : scope.items.filter((value) => value !== current);
    setScope({ ...scope, items });
  }

  function updateField(scope: ShareScope, setScope: (scope: ShareScope) => void, item: CatalogItem, field: string, checked: boolean) {
    setScope({ ...scope, items: scope.items.map((value) => value.kind !== item.kind || value.id !== item.id ? value : { ...value, fields: checked ? [...value.fields, field] : value.fields.filter((candidate) => candidate !== field) }) });
  }

  async function savePublicScope() {
    if (!session) return;
    const saved = await responseJson<PublicProjectionStatus>(await fetch(`${endpoint(trip.id)}/public-projection`, { method: "PUT", headers: apiHeaders(session), body: JSON.stringify(publicScope) }), "De publieke scope kon niet worden opgeslagen.");
    setPublicStatus(saved); setPublicScope(cloneScope(saved.scope)); setMessage("Publieke scope opgeslagen. Niet-geselecteerde inhoud blijft afwezig.");
  }

  async function previewPublic() {
    await savePublicScope();
    if (!session) return;
    const document = await responseJson<ProjectionDocument>(await fetch(`${endpoint(trip.id)}/public-projection/preview`, { method: "POST", headers: apiHeaders(session) }), "De publieke preview kon niet worden geladen.");
    setPreview({ name: "Publieke preview", audience: "public", document: document as Projection });
  }

  async function togglePublic() {
    if (!session || !publicStatus) return;
    const isPublished = publicStatus.surface_state === "published";
    const options = isPublished && reason.trim() ? { body: JSON.stringify({ reason: reason.trim() }) } : {};
    const saved = await responseJson<PublicProjectionStatus>(await fetch(`${endpoint(trip.id)}/public-projection/${isPublished ? "unpublish" : "publish"}`, { method: "POST", headers: apiHeaders(session), ...options }), "De publicatiestatus kon niet worden gewijzigd.");
    setPublicStatus(saved); setReason(""); setMessage(isPublished ? "Publieke pagina ingetrokken." : "Publieke pagina gepubliceerd.");
  }

  async function saveLink() {
    if (!session) return;
    const existing = selectedLink;
    const saved = await responseJson<ShareLink>(await fetch(existing ? `${endpoint(trip.id)}/share-links/${existing.id}` : `${endpoint(trip.id)}/share-links`, { method: existing ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify(existing ? { label: linkLabel.trim(), scope: linkScope } : { label: linkLabel.trim(), scope: linkScope }) }), "De deellink kon niet worden opgeslagen.");
    await loadLinks(); selectLink(saved); setMessage(existing ? "Deellink en scope opgeslagen." : "Concept-deellink gemaakt. Activeer hem om een eenmalige link te ontvangen.");
    return saved;
  }

  async function previewLink() {
    const saved = selectedLink && (selectedLink.state === "revoked" || selectedLink.state === "expired") ? selectedLink : await saveLink();
    if (!session || !saved) return;
    const document = await responseJson<ProjectionDocument>(await fetch(`${endpoint(trip.id)}/share-links/${saved.id}/preview`, { method: "POST", headers: apiHeaders(session) }), "De linkpreview kon niet worden geladen.");
    setPreview({ name: `Preview van ${saved.label}`, audience: "share", linkId: saved.id, document: document as Projection });
  }

  async function activateLink(action: "activate" | "rotate") {
    if (!session || !selectedLink) return;
    const response = await responseJson<ShareLink & { token: string }>(await fetch(`${endpoint(trip.id)}/share-links/${selectedLink.id}/${action}`, { method: "POST", headers: apiHeaders(session), body: JSON.stringify({ expires_in_days: expiresInDays, reason: reason.trim() || null }) }), "De veilige link kon niet worden gemaakt.");
    setRevealedToken({ label: response.label, token: response.token }); setReason(""); await loadLinks(); selectLink(response); setMessage("De capability is nu één keer getoond. Bewaar hem nu veilig.");
  }

  async function revokeLink() {
    if (!session || !selectedLink) return;
    const saved = await responseJson<ShareLink>(await fetch(`${endpoint(trip.id)}/share-links/${selectedLink.id}/revoke`, { method: "POST", headers: apiHeaders(session), body: JSON.stringify({ reason: reason.trim() || null }) }), "De link kon niet worden ingetrokken.");
    await loadLinks(); selectLink(saved); setReason(""); setMessage("Deellink ingetrokken.");
  }

  async function copyToken() {
    if (!revealedToken) return;
    await navigator.clipboard.writeText(revealedToken.token);
    setMessage("Capability gekopieerd. Hij wordt niet opnieuw opgevraagd of opgeslagen door deze app.");
  }

  function ScopeEditor({ scope, setScope, name, disabled = false }: { scope: ShareScope; setScope: (scope: ShareScope) => void; name: string; disabled?: boolean }) {
    return <fieldset className="scope-editor" disabled={disabled}><legend>{name}</legend><p>Kies per onderdeel expliciet welke velden de server mag leveren. Alles wat hier niet staat, blijft buiten de response.</p>
      <div className="scope-trip-fields"><label className="scope-choice"><input type="checkbox" checked={scope.trip.title} onChange={(event) => setScope({ ...scope, trip: { ...scope.trip, title: event.target.checked } })} />Reistitel</label><label className="scope-choice"><input type="checkbox" checked={scope.trip.summary} onChange={(event) => setScope({ ...scope, trip: { ...scope.trip, summary: event.target.checked } })} />Samenvatting</label></div>
      <div className="scope-items">{catalog.map((item) => {
        const selected = scope.items.find((value) => value.kind === item.kind && value.id === item.id);
        return <article className={`scope-item ${selected ? "included" : ""}`} key={`${item.kind}-${item.id}`}><label className="scope-choice"><input type="checkbox" checked={Boolean(selected)} onChange={(event) => updateItem(scope, setScope, item, event.target.checked)} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>{selected && <div className="scope-fields">{item.fields.map((field) => <label key={field}><input type="checkbox" checked={selected.fields.includes(field)} onChange={(event) => updateField(scope, setScope, item, field, event.target.checked)} />{field}</label>)}</div>}</article>;
      })}</div>
      {!catalog.length && <p className="help">Er zijn nog geen veilige, deelbare onderdelen. Maak bijvoorbeeld een brede plaats, uittreksel of goedgekeurde afgeleide.</p>}
    </fieldset>;
  }

  return <section className="card manager publication-manager" aria-labelledby="publication-manager-title">
    <div className="capture-heading"><div><h3 id="publication-manager-title">Publiceren en verborgen links</h3><p>Publicatie is een aparte, bewuste keuze. De server levert alleen de scope die je hieronder opslaat.</p></div></div>
    <p className="help" role="status">{message}</p>
    {revealedToken && <section className="token-reveal" aria-live="assertive"><strong>Bewaar deze capability nu</strong><p>Deze token wordt niet opnieuw opgehaald of bewaard. Wie hem heeft, kan de actieve verborgen link openen.</p><code>{revealedToken.token}</code><button type="button" onClick={() => void copyToken().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Kopiëren lukte niet."))}>Kopieer capability</button><button className="secondary compact" type="button" onClick={() => setRevealedToken(null)}>Ik heb hem bewaard</button></section>}
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Publieke pagina</h3><p>{publicStatus?.surface_state === "published" ? "Deze scope is publiek bereikbaar." : "Nog niet publiek bereikbaar."}</p></div></div>
      <ScopeEditor name="Publieke scope" scope={publicScope} setScope={(scope) => { setPublicScope(scope); setPreview(null); }} />
      <div className="button-row"><button type="button" onClick={() => void savePublicScope().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Opslaan lukte niet."))}>Publieke scope opslaan</button><button className="secondary" type="button" onClick={() => void previewPublic().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Preview lukte niet."))}>Preview</button><button className={publicStatus?.surface_state === "published" ? "danger" : ""} type="button" onClick={() => void togglePublic().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Status wijzigen lukte niet."))}>{publicStatus?.surface_state === "published" ? "Publicatie intrekken" : "Publiceren"}</button></div>
    </div>
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Verborgen deellinks</h3><p>Elke link heeft een eigen live scope en kan later worden ingetrokken of geroteerd.</p></div><button className="secondary compact" type="button" onClick={() => { setEditingLinkId(null); setLinkLabel(""); setLinkScope(emptyScope()); setPreview(null); }}>Nieuwe link</button></div>
      {links.length > 0 && <div className="link-list">{links.map((link) => <button type="button" className={`link-row ${link.id === editingLinkId ? "selected" : ""}`} key={link.id} onClick={() => selectLink(link)}><strong>{link.label}</strong><span>{link.state} · verloopt {dateLabel(link.expires_at)}</span></button>)}</div>}
      {(editingLinkId !== null || links.length === 0) && <div className="link-editor"><label>Naam van de link<input required maxLength={120} disabled={selectedLink?.state === "revoked" || selectedLink?.state === "expired"} value={linkLabel} onChange={(event) => { setLinkLabel(event.target.value); setPreview(null); }} placeholder="Bijvoorbeeld: familie" /></label><ScopeEditor name="Scope voor verborgen link" scope={linkScope} setScope={(scope) => { setLinkScope(scope); setPreview(null); }} disabled={selectedLink?.state === "revoked" || selectedLink?.state === "expired"} /><div className="button-row"><button type="button" disabled={!linkLabel.trim() || selectedLink?.state === "revoked" || selectedLink?.state === "expired"} onClick={() => void saveLink().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Opslaan lukte niet."))}>{selectedLink ? "Link opslaan" : "Conceptlink maken"}</button><button className="secondary" type="button" disabled={!linkLabel.trim()} onClick={() => void previewLink().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Preview lukte niet."))}>Preview</button></div>
        {selectedLink && <div className="lifecycle"><div className="field-row"><label>Geldig gedurende (dagen)<input type="number" min="1" max="90" value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} /></label><label>Reden <span className="optional">(optioneel)</span><input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label></div><div className="button-row">{selectedLink.state === "draft" && <button type="button" onClick={() => void activateLink("activate").catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Activeren lukte niet."))}>Activeren en capability tonen</button>}{selectedLink.state === "active" && <><button className="danger" type="button" onClick={() => void revokeLink().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Intrekken lukte niet."))}>Link intrekken</button><button type="button" onClick={() => void activateLink("rotate").catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Roteren lukte niet."))}>Roteren en nieuwe capability tonen</button></>}</div></div>}
      </div>}
    </div>
    {preview && session && <section className="projection-preview" aria-live="polite"><h3>{preview.name}</h3><p>{preview.audience === "public" ? "Doelgroep: iedereen" : "Doelgroep: alleen wie de actieve verborgen link heeft"} · {preview.audience === "public" ? publicStatus?.surface_state === "published" ? "nu gepubliceerd" : "concept of ingetrokken" : links.find((link) => link.id === preview.linkId)?.state ?? "concept"}</p><p>{projectionSummary(preview.document)}</p><p className="help">Alleen geselecteerde velden verschijnen hieronder. Privégegevens, boekingen en andere niet-geselecteerde velden blijven verborgen. Deze preview publiceert niets en maakt geen toegangscode aan.</p><RenderedPreview projection={preview.document} audience={preview.audience} tripId={trip.id} linkId={preview.linkId} session={session} /><details><summary>Geleverde velden inspecteren</summary><pre>{JSON.stringify(preview.document, null, 2)}</pre></details></section>}
  </section>;
}
