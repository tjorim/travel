import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { RecordForm, requiredText, TextField } from "../forms/fields";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { derivativesQueryOptions, tripPath, useOwner, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { RenderedPreview } from "./RenderedPreview";
import type { Projection } from "../ProjectionView";
import type { ProjectionDocument, PublicProjectionStatus, ShareLink, ShareScope, ShareScopeKind, Trip } from "../tracker-model";

type CatalogItem = { kind: ShareScopeKind; id: string; label: string; detail: string; fields: string[] };

const fieldsFor: Record<ShareScopeKind, string[]> = {
  exact_place: ["navigation"],
  route_stage: ["position", "label", "summary", "place", "navigation"],
  broad_place: ["label", "country_code", "region", "latitude", "longitude", "navigation"],
  broad_route: ["label", "geometry", "date_precision"],
  moment_excerpt: ["title", "body", "date_precision", "story_date", "place", "navigation"],
  broad_stay_card: ["title", "date_precision", "place", "navigation"],
  media_derivative: ["image", "caption", "alt_text", "width", "height", "focal_x", "focal_y", "moment"],
  document_derivative: ["title", "file"],
  trip_highlight: ["title", "summary"],
};

const DATE_PRECISIONS = { day: "per dag", month: "per maand", year: "alleen het jaar" } as const;

const emptyScope = (): ShareScope => ({ schema_version: "travel/share-scope@1", trip: { title: true, summary: true, dates: null }, items: [] });
function cloneScope(scope: Partial<ShareScope> | null | undefined): ShareScope {
  return {
    schema_version: "travel/share-scope@1",
    trip: { title: scope?.trip?.title ?? true, summary: scope?.trip?.summary ?? true, dates: scope?.trip?.dates ?? null },
    items: Array.isArray(scope?.items) ? scope.items.map((item) => ({ ...item, fields: [...item.fields] })) : [],
  };
}

function shareUrl(token: string): string {
  return new URL(`/share/${encodeURIComponent(token)}`, window.location.origin).toString();
}

function dateLabel(value: string | null): string {
  return value ? new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium" }).format(new Date(value)) : "—";
}

function projectionSummary(document: ProjectionDocument): string {
  const count = document.highlights.length + document.route_stages.length + document.places.length + document.moments.length + document.stays.length + document.media.length + document.documents.length + document.route.length;
  return `${count} gekozen onderdelen · ${document.title ? "titel" : "geen titel"} · ${document.summary ? "samenvatting" : "geen samenvatting"} · ${document.dates ? "reisdatums" : "geen reisdatums"}`;
}

function updateItem(scope: ShareScope, item: CatalogItem, included: boolean): ShareScope {
  const current = scope.items.find((value) => value.kind === item.kind && value.id === item.id);
  const items = included
    ? current ? scope.items : [...scope.items, { kind: item.kind, id: item.id, fields: [...item.fields] }]
    : scope.items.filter((value) => value !== current);
  return { ...scope, items };
}

function updateField(scope: ShareScope, item: CatalogItem, field: string, checked: boolean): ShareScope {
  return { ...scope, items: scope.items.map((value) => value.kind !== item.kind || value.id !== item.id ? value : { ...value, fields: checked ? [...value.fields, field] : value.fields.filter((candidate) => candidate !== field) }) };
}

function ScopeEditor({ scope, setScope, name, catalog, hasDates, disabled = false }: { scope: ShareScope; setScope: (scope: ShareScope) => void; name: string; catalog: CatalogItem[]; hasDates: boolean; disabled?: boolean }) {
  return <fieldset className="scope-editor" disabled={disabled}><legend>{name}</legend><p>Kies per onderdeel expliciet welke velden de server mag leveren. Alles wat hier niet staat, blijft buiten de response.</p>
    <div className="scope-trip-fields"><label className="scope-choice"><input type="checkbox" checked={scope.trip.title} onChange={(event) => setScope({ ...scope, trip: { ...scope.trip, title: event.target.checked } })} />Reistitel</label><label className="scope-choice"><input type="checkbox" checked={scope.trip.summary} onChange={(event) => setScope({ ...scope, trip: { ...scope.trip, summary: event.target.checked } })} />Samenvatting</label><label>Reisdatums<select value={scope.trip.dates ?? ""} onChange={(event) => setScope({ ...scope, trip: { ...scope.trip, dates: (event.target.value || null) as ShareScope["trip"]["dates"] } })}><option value="">Niet delen</option>{Object.entries(DATE_PRECISIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{scope.trip.dates && !hasDates && <small>Deze reis heeft nog geen reisdatums.</small>}</div>
    <div className="scope-items">{catalog.map((item) => {
      const selected = scope.items.find((value) => value.kind === item.kind && value.id === item.id);
      return <article className={`scope-item ${selected ? "included" : ""}`} key={`${item.kind}-${item.id}`}><label className="scope-choice"><input type="checkbox" checked={Boolean(selected)} onChange={(event) => setScope(updateItem(scope, item, event.target.checked))} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>{selected && <div className="scope-fields">{item.fields.map((field) => <label key={field}><input type="checkbox" checked={selected.fields.includes(field)} onChange={(event) => setScope(updateField(scope, item, field, event.target.checked))} />{field}</label>)}</div>}</article>;
    })}</div>
    {!catalog.length && <p className="help">Er zijn nog geen veilige, deelbare onderdelen. Maak bijvoorbeeld een brede plaats, uittreksel of goedgekeurde afgeleide.</p>}
  </fieldset>;
}

function combineDerivatives<T>(results: { data: T | undefined; error: Error | null }[]) {
  return { data: results.map((result) => result.data), error: results.find((result) => result.error)?.error ?? null };
}

type PublicValues = { scope: ShareScope };
type LinkValues = { label: string; scope: ShareScope };
type Preview = { name: string; audience: "public" | "share"; linkId?: string; document: Projection };
type LinkAction = { link: ShareLink; action: "activate" | "rotate"; expiresInDays: number | null; reason: string | null };

export function PublicationManager({ trip }: { trip: Trip }) {
  const owner = useOwner();
  const statusQuery = useTripResource(trip.id, "public-projection");
  const linksQuery = useTripResource(trip.id, "share-links");
  const placesQuery = useTripResource(trip.id, "places/broad");
  const routesQuery = useTripResource(trip.id, "broad-routes");
  const cardsQuery = useTripResource(trip.id, "broad-stay-cards");
  const mediaQuery = useTripResource(trip.id, "media");
  const documentsQuery = useTripResource(trip.id, "documents");
  const media = useMemo(() => mediaQuery.data ?? [], [mediaQuery.data]);
  const documents = useMemo(() => documentsQuery.data ?? [], [documentsQuery.data]);
  // One derivative read per asset; the combined result keeps a fixed shape however many assets there are.
  const mediaDerivatives = useQueries({ queries: media.map((asset) => derivativesQueryOptions(owner, trip.id, "media", asset.id)), combine: combineDerivatives });
  const documentDerivatives = useQueries({ queries: documents.map((asset) => derivativesQueryOptions(owner, trip.id, "documents", asset.id)), combine: combineDerivatives });
  const publicStatus = statusQuery.data ?? null;
  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data]);

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
  // The answer carries the one-time link token, so it never lingers in the mutation cache.
  const activate = useOwnerMutation<LinkAction, ShareLink & { token: string }>({
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
    onSuccess: (saved) => { publicRecord.load({ scope: cloneScope(saved.scope) }); setNotice("Publieke scope opgeslagen. Niet-geselecteerde inhoud blijft afwezig."); },
  });
  const linkRecord = useRecordForm<LinkValues, ShareLink>({
    defaultValues: { label: "", scope: emptyScope() },
    fallback: "De deellink kon niet worden opgeslagen.",
    serverFields: { label: "label" },
    submit: (values) => saveLink.mutateAsync({ id: editingLinkId, label: values.label.trim(), scope: values.scope }),
    onSuccess: (saved) => { selectLink(saved); setNotice(editingLinkId ? "Deellink en scope opgeslagen." : "Concept-deellink gemaakt. Activeer hem om een eenmalige link te ontvangen."); },
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

  function selectLink(link: ShareLink) {
    setLinkEditor({ linkId: link.id });
    linkRecord.load({ label: link.label, scope: cloneScope(link.scope) });
    setPreview(null);
    setRevealedLink(null);
    setReason("");
  }

  function newLink() {
    setLinkEditor({ linkId: null });
    linkRecord.load({ label: "", scope: emptyScope() });
    setPreview(null);
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
      selectLink(target);
    }
    const document = await previewLinkScope.mutateAsync(target);
    setPreview({ name: `Preview van ${target.label}`, audience: "share", linkId: target.id, document: document as Projection });
  }

  function activateLink(action: "activate" | "rotate") {
    if (!selectedLink) return;
    activate.mutateAsync({ link: selectedLink, action, expiresInDays, reason: reason.trim() || null }).then((result) => {
      activate.reset();
      selectLink(result);
      // Selecting a link clears any earlier reveal, so the new secret is shown after it.
      setRevealedLink({ label: result.label, url: shareUrl(result.token) });
      setNotice("De veilige link is nu één keer getoond. Bewaar hem nu veilig.");
    }, fail("De veilige link kon niet worden gemaakt."));
  }

  function revokeLink() {
    if (!selectedLink) return;
    revoke.mutateAsync({ link: selectedLink, reason: reason.trim() || null }).then((saved) => { selectLink(saved); setNotice("Deellink ingetrokken."); }, fail("De link kon niet worden ingetrokken."));
  }

  async function copyLink() {
    if (!revealedLink) return;
    await navigator.clipboard.writeText(revealedLink.url);
    setNotice("Veilige link gekopieerd. Hij wordt niet opnieuw opgevraagd of opgeslagen door deze app.");
  }

  const catalog = useMemo<CatalogItem[]>(() => {
    const exactPlaces = new Map<string, { label: string }>();
    for (const moment of trip.moments) if (moment.place) exactPlaces.set(moment.place.id, { label: moment.title });
    const approved = <T extends { review_state: string }>(items: T[] | undefined) => (items ?? []).filter((item) => item.review_state === "approved");
    return [
      ...trip.highlights.map((item) => ({ kind: "trip_highlight" as const, id: item.id, label: item.title, detail: "Hoogtepunt", fields: fieldsFor.trip_highlight })),
      ...trip.route_stages.map((item) => ({ kind: "route_stage" as const, id: item.id, label: item.label ?? item.place.label, detail: "Brede route-etappe", fields: fieldsFor.route_stage })),
      ...(placesQuery.data ?? []).map((item) => ({ kind: "broad_place" as const, id: item.id, label: item.label, detail: "Brede plaats", fields: fieldsFor.broad_place })),
      ...(routesQuery.data ?? []).map((item) => ({ kind: "broad_route" as const, id: item.id, label: item.label, detail: "Brede route", fields: fieldsFor.broad_route })),
      ...trip.moment_excerpts.map((item) => ({ kind: "moment_excerpt" as const, id: item.id, label: item.title, detail: "Moment-uittreksel", fields: fieldsFor.moment_excerpt })),
      ...(cardsQuery.data ?? []).map((item) => ({ kind: "broad_stay_card" as const, id: item.id, label: item.title, detail: "Brede verblijfskaart", fields: fieldsFor.broad_stay_card })),
      ...[...exactPlaces.entries()].map(([id, item]) => ({ kind: "exact_place" as const, id, label: `Navigatie bij ${item.label}`, detail: "Alleen navigatie; geen plaatsdetails", fields: fieldsFor.exact_place })),
      ...media.flatMap((asset, index) => approved(mediaDerivatives.data[index]).map((item) => ({ kind: "media_derivative" as const, id: item.id, label: asset.original_filename ?? "Goedgekeurde media-afgeleide", detail: "Goedgekeurde media-afgeleide", fields: fieldsFor.media_derivative }))),
      ...documents.flatMap((asset, index) => approved(documentDerivatives.data[index]).map((item) => ({ kind: "document_derivative" as const, id: item.id, label: asset.title, detail: "Goedgekeurde geredigeerde kopie", fields: fieldsFor.document_derivative }))),
    ];
  }, [trip, placesQuery.data, routesQuery.data, cardsQuery.data, media, documents, mediaDerivatives.data, documentDerivatives.data]);

  const readError = [statusQuery, linksQuery, placesQuery, routesQuery, cardsQuery, mediaQuery, documentsQuery].find((query) => query.isError)?.error ?? mediaDerivatives.error ?? documentDerivatives.error;
  const message = notice ?? (readError ? errorMessage(readError, "Je publicaties konden niet worden geladen.") : statusQuery.isPending ? "Laad je publicaties…" : "Kies alleen onderdelen en velden die je bewust wilt delen.");
  const isPublished = publicStatus?.surface_state === "published";

  return <section className="card manager publication-manager" aria-labelledby="publication-manager-title">
    <div className="capture-heading"><div><h3 id="publication-manager-title">Publiceren en verborgen links</h3><p>Publicatie is een aparte, bewuste keuze. De server levert alleen de scope die je hieronder opslaat.</p></div></div>
    <p className="help" role="status">{message}</p>
    {revealedLink && <section className="token-reveal" aria-live="assertive"><strong>Bewaar deze veilige link nu</strong><p>Deze capability wordt niet opnieuw opgehaald of bewaard. Wie deze link heeft, kan de actieve verborgen pagina openen.</p><code>{revealedLink.url}</code><button type="button" onClick={() => void copyLink().catch(fail("Kopiëren lukte niet."))}>Kopieer veilige link</button><button className="secondary compact" type="button" onClick={() => setRevealedLink(null)}>Ik heb hem bewaard</button></section>}
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Publieke pagina</h3><p>{isPublished ? "Deze scope is publiek bereikbaar." : "Nog niet publiek bereikbaar."}</p></div></div>
      <RecordForm record={publicRecord} submitLabel="Publieke scope opslaan" pendingLabel="Opslaan…" actions={<>
        <button className="secondary" type="button" onClick={() => void previewPublic().catch(fail("Preview lukte niet."))}>Preview</button>
        <button className={isPublished ? "danger" : ""} type="button" disabled={!publicStatus || togglePublic.isPending} onClick={toggle}>{isPublished ? "Publicatie intrekken" : "Publiceren"}</button>
      </>}>
        <publicRecord.form.Field name="scope">{(field) => <ScopeEditor name="Publieke scope" scope={field.state.value} setScope={(scope) => { field.handleChange(scope); setPreview(null); }} catalog={catalog} hasDates={Boolean(trip.starts_on)} />}</publicRecord.form.Field>
      </RecordForm>
    </div>
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Verborgen deellinks</h3><p>Elke link heeft een eigen live scope en kan later worden ingetrokken of geroteerd.</p></div><button className="secondary compact" type="button" onClick={newLink}>Nieuwe link</button></div>
      {links.length > 0 && <div className="link-list">{links.map((link) => <button type="button" className={`link-row ${link.id === editingLinkId ? "selected" : ""}`} key={link.id} onClick={() => selectLink(link)}><strong>{link.label}</strong><span>{link.state} · verloopt {dateLabel(link.expires_at)}</span></button>)}</div>}
      {(linkEditor !== null || links.length === 0) && <div className="link-editor">
        <RecordForm record={linkRecord} submitLabel={selectedLink ? "Link opslaan" : "Conceptlink maken"} pendingLabel="Opslaan…" disabled={lockedLink} actions={<button className="secondary" type="button" onClick={() => void previewLink().catch(fail("Preview lukte niet."))}>Preview</button>}>
          <linkRecord.form.Field name="label" listeners={{ onChange: () => setPreview(null) }} validators={{ onChange: requiredText("Geef de link een naam."), onSubmit: requiredText("Geef de link een naam.") }}>{(field) => <TextField field={field} label="Naam van de link" required maxLength={120} disabled={lockedLink} placeholder="Bijvoorbeeld: familie" />}</linkRecord.form.Field>
          <linkRecord.form.Field name="scope">{(field) => <ScopeEditor name="Scope voor verborgen link" scope={field.state.value} setScope={(scope) => { field.handleChange(scope); setPreview(null); }} catalog={catalog} hasDates={Boolean(trip.starts_on)} disabled={lockedLink} />}</linkRecord.form.Field>
        </RecordForm>
        {selectedLink && <div className="lifecycle"><div className="field-row"><label>Geldig gedurende (dagen)<input type="number" min="1" max="90" disabled={expiresInDays === null} value={expiresInDays ?? 30} onChange={(event) => setExpiresInDays(Number(event.target.value))} /></label><label className="scope-choice"><input type="checkbox" checked={expiresInDays === null} onChange={(event) => setExpiresInDays(event.target.checked ? null : 30)} />Geen vervaldatum</label><label>Reden <span className="optional">(optioneel)</span><input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label></div>{expiresInDays === null && <p className="help">Deze link blijft geldig totdat je hem intrekt of roteert. Behandel hem als een wachtwoord.</p>}<div className="button-row">{selectedLink.state === "draft" && <button type="button" onClick={() => activateLink("activate")}>Activeren en veilige link tonen</button>}{selectedLink.state === "active" && <><button className="danger" type="button" onClick={revokeLink}>Link intrekken</button><button type="button" onClick={() => activateLink("rotate")}>Roteren en nieuwe veilige link tonen</button></>}</div></div>}
      </div>}
    </div>
    {preview && owner && <section className="projection-preview" aria-live="polite"><h3>{preview.name}</h3><p>{preview.audience === "public" ? "Doelgroep: iedereen" : "Doelgroep: alleen wie de actieve verborgen link heeft"} · {preview.audience === "public" ? isPublished ? "nu gepubliceerd" : "concept of ingetrokken" : links.find((link) => link.id === preview.linkId)?.state ?? "concept"}</p><p>{projectionSummary(preview.document)}</p><p className="help">Alleen geselecteerde velden verschijnen hieronder. Privégegevens, boekingen en andere niet-geselecteerde velden blijven verborgen. Deze preview publiceert niets en maakt geen toegangscode aan.</p><RenderedPreview projection={preview.document} audience={preview.audience} tripId={trip.id} linkId={preview.linkId} session={owner.session} /><details><summary>Geleverde velden inspecteren</summary><pre>{JSON.stringify(preview.document, null, 2)}</pre></details></section>}
  </section>;
}
