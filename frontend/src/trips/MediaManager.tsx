import { useState, type FormEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { RecordForm, SelectField, TextField } from "../forms/fields";
import { useRecordForm } from "../forms/useRecordForm";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage, openOwnerFile, ownerFile } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useDerivatives, useOwner, useOwnerMutation, useTripResource } from "../query/owner-queries";
import {
  bytesLabel,
  type ImportCompleteResult,
  type ImportSession,
  type MediaAsset,
  type MediaDerivative,
  type MomentExcerpt,
  type Trip,
  type VisitCandidate,
  type VisitCandidatesResponse,
} from "../tracker-model";

const providerLabel = {
  google_photos_picker: "Google Photos",
  gopro_cloud: "GoPro Cloud",
} as const;

type DerivativeValues = { purpose: MediaDerivative["purpose"]; maxDimension: string };
const blankDerivative = (): DerivativeValues => ({ purpose: "share", maxDimension: "1600" });
const dimensionInRange = ({ value }: { value: string }) => {
  const size = Number(value);
  return value.trim() && Number.isInteger(size) && size >= 64 && size <= 4000 ? undefined : "Kies een maximale zijde tussen 64 en 4000 px.";
};

type PresentationValues = { momentExcerptId: string; caption: string; altText: string; focalX: string; focalY: string };
const fromDerivative = (derivative: MediaDerivative): PresentationValues => ({ momentExcerptId: derivative.moment_excerpt_id ?? "", caption: derivative.caption ?? "", altText: derivative.alt_text ?? "", focalX: derivative.focal_x?.toString() ?? "", focalY: derivative.focal_y?.toString() ?? "" });
const percentage = ({ value }: { value: string }) => value === "" || (Number(value) >= 0 && Number(value) <= 100) ? undefined : "Kies een waarde tussen 0 en 100.";

function PresentationForm({ derivative, excerpts, save }: { derivative: MediaDerivative; excerpts: MomentExcerpt[]; save: (values: Record<string, unknown>) => Promise<void> }) {
  const record = useRecordForm<PresentationValues>({
    defaultValues: fromDerivative(derivative),
    fallback: "De presentatie kon niet worden opgeslagen.",
    serverFields: { moment_excerpt_id: "momentExcerptId", caption: "caption", alt_text: "altText", focal_x: "focalX", focal_y: "focalY" },
    submit: (values) => save({
      moment_excerpt_id: values.momentExcerptId || null,
      caption: values.caption || null,
      alt_text: values.altText || null,
      focal_x: values.focalX === "" ? null : Number(values.focalX),
      focal_y: values.focalY === "" ? null : Number(values.focalY),
    }),
  });
  return <div className="derivative-presentation">
    <RecordForm record={record} submitLabel="Presentatie opslaan" pendingLabel="Opslaan…">
      <record.form.Field name="momentExcerptId">{(field) => <SelectField field={field} label="Gedeeld moment"><option value="">Losse galerijfoto</option>{excerpts.map((excerpt) => <option key={excerpt.id} value={excerpt.id}>{excerpt.title}</option>)}</SelectField>}</record.form.Field>
      <record.form.Field name="caption">{(field) => <TextField field={field} label="Bijschrift" maxLength={500} />}</record.form.Field>
      <record.form.Field name="altText">{(field) => <TextField field={field} label="Alternatieve tekst" maxLength={300} />}</record.form.Field>
      <div className="field-row">
        <record.form.Field name="focalX" validators={{ onChange: percentage, onSubmit: percentage }}>{(field) => <TextField field={field} label="Focus horizontaal (%)" type="number" min="0" max="100" />}</record.form.Field>
        <record.form.Field name="focalY" validators={{ onChange: percentage, onSubmit: percentage }}>{(field) => <TextField field={field} label="Focus verticaal (%)" type="number" min="0" max="100" />}</record.form.Field>
      </div>
    </RecordForm>
  </div>;
}

export function MediaManager({ trip }: { trip: Trip }) {
  const owner = useOwner();
  const offline = useOfflineCopies();
  const navigate = useNavigate();
  const mediaQuery = useTripResource(trip.id, "media");
  const assets = mediaQuery.data ?? [];
  // undefined: follow the first asset; null: none chosen (after a delete); a string: the chosen asset.
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const selected = selectedId === undefined ? assets[0] ?? null : assets.find((asset) => asset.id === selectedId) ?? null;
  const derivativesQuery = useDerivatives(trip.id, "media", selected?.id ?? null);
  const derivatives = derivativesQuery.data ?? [];
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [importSession, setImportSession] = useState<ImportSession | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const reviewSelection = selection.filter((id) => assets.some((asset) => asset.id === id));
  const [candidateReview, setCandidateReview] = useState<VisitCandidatesResponse | null>(null);
  const [candidateTimes, setCandidateTimes] = useState<Record<string, string>>({});
  const [candidateLocations, setCandidateLocations] = useState<Record<string, string>>({});
  const [candidateAttachments, setCandidateAttachments] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const mediaPath = tripPath(trip.id, "media");
  const refreshMedia = (subject: string) => [ownerKeys.tripResource(subject, trip.id, "media")];
  const refreshDerivatives = (subject: string, { assetId }: { assetId: string }) => [ownerKeys.derivatives(subject, trip.id, "media", assetId)];

  const upload = useOwnerMutation<FormData, MediaAsset>({
    fallback: "De media konden niet worden geüpload.",
    request: (body) => ({ path: `${mediaPath}/uploads`, method: "POST", body }),
    invalidate: refreshMedia,
  });
  const remove = useOwnerMutation<MediaAsset>({
    fallback: "De media konden niet worden verwijderd.",
    request: (asset) => ({ path: `${mediaPath}/${asset.id}`, method: "DELETE" }),
    // The server also drops the deleted asset from the moments that used it.
    invalidate: (subject) => [...refreshMedia(subject), ownerKeys.trips(subject)],
  });
  const requestDerivative = useOwnerMutation<{ assetId: string; purpose: MediaDerivative["purpose"]; maxDimension: number }, MediaDerivative>({
    fallback: "De afgeleide kon niet worden gemaakt.",
    request: ({ assetId, purpose, maxDimension }) => ({ path: `${mediaPath}/${assetId}/derivatives`, method: "POST", body: { purpose, max_dimension: maxDimension } }),
    invalidate: refreshDerivatives,
  });
  const approve = useOwnerMutation<{ assetId: string; derivative: MediaDerivative }, MediaDerivative>({
    fallback: "De afgeleide kon niet worden goedgekeurd.",
    request: ({ assetId, derivative }) => ({ path: `${mediaPath}/${assetId}/derivatives/${derivative.id}/approve`, method: "POST" }),
    invalidate: refreshDerivatives,
  });
  const presentation = useOwnerMutation<{ assetId: string; derivative: MediaDerivative; values: Record<string, unknown> }, MediaDerivative>({
    fallback: "De presentatie kon niet worden opgeslagen.",
    request: ({ assetId, derivative, values }) => ({ path: `${mediaPath}/${assetId}/derivatives/${derivative.id}/presentation`, method: "PATCH", body: values }),
    invalidate: refreshDerivatives,
  });
  const removeDerivative = useOwnerMutation<{ assetId: string; derivative: MediaDerivative }>({
    fallback: "De afgeleide kon niet worden verwijderd.",
    request: ({ assetId, derivative }) => ({ path: `${mediaPath}/${assetId}/derivatives/${derivative.id}`, method: "DELETE" }),
    invalidate: refreshDerivatives,
  });
  const startImport = useOwnerMutation<ImportSession["provider"], ImportSession>({
    fallback: "De importsessie kon niet worden gestart.",
    request: (provider) => ({ path: `${mediaPath}/imports/${provider}/sessions`, method: "POST" }),
    invalidate: () => [],
  });
  const completeImport = useOwnerMutation<ImportSession, ImportCompleteResult>({
    fallback: "De importsessie kon niet worden voltooid.",
    request: (session) => ({ path: `${mediaPath}/imports/${session.provider}/sessions/${session.id}/complete`, method: "POST" }),
    invalidate: (subject, _session, result) => result?.ready ? refreshMedia(subject) : [],
  });
  const reviewVisits = useOwnerMutation<string[], VisitCandidatesResponse>({
    fallback: "De mogelijke bezoeken konden niet worden berekend.",
    request: (mediaAssetIds) => ({ path: `${mediaPath}/visit-candidates`, method: "POST", body: { media_asset_ids: mediaAssetIds } }),
    // A review is computed for this screen only; nothing is stored.
    invalidate: () => [],
  });
  const attach = useOwnerMutation<{ momentId: string; mediaAssetIds: string[] }>({
    fallback: "De private media konden niet aan het moment worden gekoppeld.",
    request: ({ momentId, mediaAssetIds }) => ({ path: tripPath(trip.id, `moments/${momentId}`), method: "PATCH", body: { media_asset_ids: mediaAssetIds } }),
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });

  const derivativeRecord = useRecordForm<DerivativeValues>({
    defaultValues: blankDerivative(),
    fallback: "De afgeleide kon niet worden gemaakt.",
    serverFields: { purpose: "purpose", max_dimension: "maxDimension" },
    submit: async (values) => { if (selected) await requestDerivative.mutateAsync({ assetId: selected.id, purpose: values.purpose, maxDimension: Number(values.maxDimension) }); },
    onSuccess: () => setNotice("Metadata-vrije afgeleide gemaakt. Controleer hem en keur hem daarna expliciet goed."),
  });

  const fail = (fallback: string) => (error: unknown) => setNotice(errorMessage(error, fallback));
  const timestamp = (value: string) => new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadFile) { setNotice("Kies eerst een foto of video."); return; }
    const data = new FormData();
    data.set("file", uploadFile);
    setNotice("Privémedia uploaden…");
    upload.mutateAsync(data).then((saved) => {
      setUploadFile(null);
      setUploadKey((current) => current + 1);
      setSelectedId(saved.id);
      setNotice("Privémedia geüpload. Je kunt ze nu aan een moment koppelen.");
    }, fail("De media konden niet worden geüpload."));
  }

  function erase(asset: MediaAsset) {
    if (!window.confirm(`Verwijder “${asset.original_filename ?? "dit medium"}” uit deze reis?`)) return;
    remove.mutateAsync(asset).then(async () => {
      await offline.removeByResource("media_asset", asset.id);
      setSelectedId(null);
      setNotice("Privémedia verwijderd. Eventuele momentkoppelingen zijn ook weggehaald.");
    }, fail("De media konden niet worden verwijderd."));
  }

  async function toggleOffline(asset: MediaAsset) {
    if (!owner) return;
    if (offline.isPinned("media_asset", asset.id)) {
      await offline.removeByResource("media_asset", asset.id);
      setNotice(`“${asset.original_filename ?? "Dit medium"}” is niet langer offline beschikbaar.`);
      return;
    }
    const blob = await ownerFile(owner.session, asset.file_url, "Het private medium kon niet offline worden bewaard.", { cache: "no-store" });
    await offline.pin({
      resourceKind: "media_asset",
      resourceId: asset.id,
      metadataUrl: `${mediaPath}/${asset.id}`,
      title: asset.original_filename ?? "Naamloos medium",
      contentType: asset.content_type,
      bytes: await blob.arrayBuffer(),
    });
    setNotice(`“${asset.original_filename ?? "Dit medium"}” is offline bewaard op dit toestel.`);
  }

  function open(url: string, fallback: string) {
    if (owner) openOwnerFile(owner.session, url, fallback).catch(fail(fallback));
  }

  function eraseDerivative(derivative: MediaDerivative) {
    if (!selected || !window.confirm("Verwijder deze afgeleide? Hij wordt direct uit eventuele deelscopes gehaald.")) return;
    removeDerivative.mutateAsync({ assetId: selected.id, derivative }).then(() => setNotice("Afgeleide verwijderd en uit eventuele deelscopes gehaald."), fail("De afgeleide kon niet worden verwijderd."));
  }

  function startProvider(provider: ImportSession["provider"]) {
    setNotice(`${providerLabel[provider]}-selectie starten…`);
    startImport.mutateAsync(provider).then((created) => {
      setImportSession(created);
      setNotice(`Kies media in ${providerLabel[provider]} en kom daarna hier terug om je selectie te importeren.`);
    }, fail("De importsessie kon niet worden gestart."));
  }

  function finishImport() {
    if (!importSession) return;
    setNotice("Geselecteerde media veilig kopiëren naar je private reis…");
    completeImport.mutateAsync(importSession).then((outcome) => {
      if (!outcome.ready) { setNotice("Je selectie is nog niet klaar bij de provider. Probeer opnieuw wanneer je klaar bent."); return; }
      if (outcome.imported[0]) setSelectedId(outcome.imported[0].id);
      setNotice(`${outcome.imported.length} item(s) geïmporteerd${outcome.failed.length ? `; ${outcome.failed.length} kon(den) niet worden gekopieerd.` : "."}`);
    }, fail("De importsessie kon niet worden voltooid."));
  }

  function toggleReviewSelection(assetId: string) {
    setSelection(() => reviewSelection.includes(assetId) ? reviewSelection.filter((id) => id !== assetId) : [...reviewSelection, assetId]);
  }

  function review() {
    if (reviewSelection.length === 0) { setNotice("Kies eerst private media om als mogelijke bezoeken te bekijken."); return; }
    reviewVisits.mutateAsync(reviewSelection).then((result) => {
      setCandidateReview(result);
      setCandidateTimes({});
      setCandidateLocations({});
      setCandidateAttachments({});
      setNotice(result.candidates.length ? "Kandidaten zijn alleen voor deze private review berekend; er is niets opgeslagen." : "Deze selectie bevat geen bruikbare opname- of locatiegegevens.");
    }, fail("De mogelijke bezoeken konden niet worden berekend."));
  }

  function candidateAssetNames(candidate: VisitCandidate) {
    return candidate.media_asset_ids.map((id) => assets.find((asset) => asset.id === id)?.original_filename ?? "naamloos medium").join(", ");
  }

  function startCandidateMoment(candidate: VisitCandidate) {
    const time = candidateTimes[candidate.id] || (candidate.time_options.length === 1 ? candidate.time_options[0].captured_at : "");
    const locationIndex = candidateLocations[candidate.id];
    if (candidate.time_options.length > 1 && !time) { setNotice("Kies eerst welke opnametijd je voor dit kandidaatbezoek wilt gebruiken."); return; }
    if (candidate.location_options.length > 1 && locationIndex === undefined) { setNotice("De GPS-metagegevens verschillen. Kies eerst zelf een locatieoptie, of negeer de locatie."); return; }
    const selectedLocation = locationIndex === "" ? undefined : candidate.location_options[locationIndex === undefined ? 0 : Number(locationIndex)];
    navigate("/capture", {
      state: { candidate: { tripId: trip.id, mediaAssetIds: candidate.media_asset_ids, occurredAt: time || undefined, gps: selectedLocation && { latitude: selectedLocation.latitude, longitude: selectedLocation.longitude } } },
    });
  }

  function attachCandidate(candidate: VisitCandidate) {
    const moment = trip.moments.find((item) => item.id === candidateAttachments[candidate.id]);
    if (!moment) { setNotice("Kies eerst een bestaand moment om de private media aan te koppelen."); return; }
    attach.mutateAsync({ momentId: moment.id, mediaAssetIds: [...new Set([...moment.media_asset_ids, ...candidate.media_asset_ids])] }).then(
      () => setNotice(`Private media gekoppeld aan “${moment.title}”. Er is geen plaats of deelbare inhoud gemaakt.`),
      fail("De private media konden niet aan het moment worden gekoppeld."),
    );
  }

  const readError = mediaQuery.error ?? derivativesQuery.error;
  const message = notice ?? (readError ? errorMessage(readError, "Je media konden niet worden geladen.") : mediaQuery.isPending ? "Laad je private media…" : assets.length ? "Originelen, EXIF en koppelingen blijven alleen in je private tracker." : "Upload foto’s of video’s vanaf dit apparaat, of importeer je geselecteerde media.");

  return <section className="card manager" aria-labelledby="media-title">
    <div className="capture-heading"><div><h3 id="media-title">Mediabibliotheek</h3><p>Originelen en metadata blijven privé. Alleen een aparte, metadata-vrije en goedgekeurde afgeleide kan later bewust worden gedeeld.</p></div></div>
    <p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={submitUpload}>
      <label>Foto of video van dit apparaat<input key={uploadKey} required type="file" accept="image/*,video/*" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} /></label>
      <button type="submit" disabled={upload.isPending}>Privémedia uploaden</button>
    </form>
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Importeren</h3><p>Verbind je provider in <NavLink to="/settings">Instellingen</NavLink>. De volledige OAuth-koppeling volgt in #55; hier start en voltooi je alleen een expliciete selectie.</p></div></div>
      <div className="button-row"><button className="secondary" type="button" onClick={() => startProvider("google_photos_picker")}>Kies in Google Photos</button><button className="secondary" type="button" onClick={() => startProvider("gopro_cloud")}>Kies in GoPro Cloud</button></div>
      {importSession && <aside className="import-session"><strong>{providerLabel[importSession.provider]}-selectie</strong><span>Kies eerst alleen de media die je naar deze private reis wilt kopiëren.</span>{importSession.picker_uri && <a className="action-link" href={importSession.picker_uri} target="_blank" rel="noreferrer">Selectie openen</a>}<button type="button" onClick={finishImport}>Selectie importeren</button></aside>}
    </div>
    {assets.length > 0 && <div className="saved-moments manager-list">{assets.map((asset) => <article className={`excerpt-row ${asset.id === selected?.id ? "selected-item" : ""}`} key={asset.id}><button className="document-select" type="button" onClick={() => setSelectedId(asset.id)}><strong>{asset.original_filename ?? "Naamloos medium"}</strong><span>{asset.media_kind === "photo" ? "Foto" : "Video"} · {bytesLabel(asset.byte_size)}{asset.captured_at ? ` · ${timestamp(asset.captured_at)}` : ""}</span></button><div className="button-row"><label className="scope-choice"><input type="checkbox" checked={reviewSelection.includes(asset.id)} onChange={() => toggleReviewSelection(asset.id)} />Bezoeken beoordelen</label><button className="secondary compact" type="button" onClick={() => open(asset.file_url, "Het private origineel kon niet worden geopend.")}>Origineel bekijken</button><button className="secondary compact" type="button" onClick={() => void toggleOffline(asset).catch(fail("Het private medium kon niet offline worden bewaard."))}>{offline.isPinned("media_asset", asset.id) ? "Offline verwijderen" : "Offline bewaren"}</button><button className="danger compact" type="button" onClick={() => erase(asset)}>Verwijderen</button></div></article>)}</div>}
    {assets.length > 0 && <div className="manager-subsection"><div className="capture-heading"><div><h3>Mogelijke bezoeken beoordelen</h3><p>Kies hierboven private media. Kandidaten gebruiken een venster van twee uur en houden GPS-punten die meer dan {candidateReview?.gps_agreement_metres ?? 500} meter verschillen als afzonderlijke keuzes. Ze worden nooit automatisch opgeslagen.</p></div></div><button type="button" onClick={review}>Geselecteerde media beoordelen</button>{candidateReview?.unavailable_media_asset_ids.length ? <p className="help">{candidateReview.unavailable_media_asset_ids.length} geselecteerd medium heeft geen bruikbare opname- of GPS-metadata en is niet gegokt in een kandidaat.</p> : null}{candidateReview?.candidates.map((candidate) => <article className="scope-item" key={candidate.id}><strong>{candidateAssetNames(candidate)}</strong><span>{candidate.starts_at ? `${timestamp(candidate.starts_at)}${candidate.ends_at && candidate.ends_at !== candidate.starts_at ? ` – ${new Intl.DateTimeFormat("nl-BE", { timeStyle: "short" }).format(new Date(candidate.ends_at))}` : ""}` : "Geen opnametijd beschikbaar"}</span>{candidate.time_options.length > 1 && <label>Gebruik opnametijd<select value={candidateTimes[candidate.id] ?? ""} onChange={(event) => setCandidateTimes((current) => ({ ...current, [candidate.id]: event.target.value }))}><option value="">Kies zelf een tijd</option>{candidate.time_options.map((option) => <option key={option.media_asset_id} value={option.captured_at}>{timestamp(option.captured_at)}</option>)}</select></label>}{candidate.location_options.length > 1 && <label>GPS-keuze<select value={candidateLocations[candidate.id] ?? ""} onChange={(event) => setCandidateLocations((current) => ({ ...current, [candidate.id]: event.target.value }))}><option value="">Locatie negeren</option>{candidate.location_options.map((option, index) => <option key={option.media_asset_ids.join("-")} value={index}>Locatie uit {option.media_asset_ids.length} medium/media</option>)}</select></label>}{candidate.location_options.length === 0 && <p className="help">Geen GPS beschikbaar; er wordt geen plaats voorgesteld.</p>}{candidate.location_options.length > 1 && <p className="help">De GPS-metagegevens spreken elkaar tegen. Kies hoogstens één optie; er wordt niets samengevoegd.</p>}<div className="button-row"><button type="button" onClick={() => startCandidateMoment(candidate)}>Als nieuw moment openen</button>{trip.moments.length > 0 && <><label className="scope-choice">Koppel aan<select value={candidateAttachments[candidate.id] ?? ""} onChange={(event) => setCandidateAttachments((current) => ({ ...current, [candidate.id]: event.target.value }))}><option value="">Kies bestaand moment</option>{trip.moments.map((moment) => <option value={moment.id} key={moment.id}>{moment.title}</option>)}</select></label><button className="secondary" type="button" onClick={() => attachCandidate(candidate)}>Aan moment koppelen</button></>}</div></article>)}</div>}
    {selected && <div className="manager-subsection"><div className="capture-heading"><div><h3>Afgeleiden</h3><p>Voor {selected.original_filename ?? "dit medium"}. {selected.media_kind === "video" ? "Video-afgeleiden zijn nog niet beschikbaar." : "Een nieuwe kopie start altijd als ‘wacht op goedkeuring’."}</p></div></div>
      {selected.media_kind === "photo" && <RecordForm record={derivativeRecord} submitLabel="Metadata-vrije afgeleide maken" pendingLabel="Afgeleide maken…">
        <div className="field-row">
          <derivativeRecord.form.Field name="purpose">{(field) => <SelectField field={field} label="Doel"><option value="share">Delen</option><option value="static_export">Statisch archief</option><option value="owner_preview">Private voorvertoning</option></SelectField>}</derivativeRecord.form.Field>
          <derivativeRecord.form.Field name="maxDimension" validators={{ onChange: dimensionInRange, onSubmit: dimensionInRange }}>{(field) => <TextField field={field} label="Maximale zijde (px)" required min={64} max={4000} type="number" />}</derivativeRecord.form.Field>
        </div>
      </RecordForm>}
      {derivatives.length > 0 && <div className="saved-moments manager-list">{derivatives.map((derivative) => <article className="scope-item" key={derivative.id}><div><strong>{derivative.review_state === "approved" ? "Goedgekeurde afgeleide" : "Wacht op goedkeuring"}</strong><span>{derivative.purpose.replace("_", " ")} · {derivative.width && derivative.height ? `${derivative.width} × ${derivative.height}` : "afmetingen onbekend"}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => open(derivative.file_url, "De private afgeleide kon niet worden geopend.")}>Bekijken</button>{derivative.review_state === "pending" && <button className="compact" type="button" onClick={() => approve.mutateAsync({ assetId: selected.id, derivative }).then(() => setNotice("Afgeleide expliciet goedgekeurd. Delen vraagt nog altijd een aparte scope."), fail("De afgeleide kon niet worden goedgekeurd."))}>Expliciet goedkeuren</button>}<button className="danger compact" type="button" onClick={() => eraseDerivative(derivative)}>Verwijderen</button></div>{derivative.purpose === "share" && <PresentationForm key={derivative.id} derivative={derivative} excerpts={trip.moment_excerpts} save={async (values) => { await presentation.mutateAsync({ assetId: selected.id, derivative, values }); setNotice("Presentatie opgeslagen. Alleen geselecteerde velden in een deelscope worden zichtbaar."); }} />}</article>)}</div>}
    </div>}
  </section>;
}
