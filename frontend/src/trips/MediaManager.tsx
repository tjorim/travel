import { useEffect, useState, type FormEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { RecordForm, SelectField, TextField } from "../forms/fields";
import { MarkdownField } from "../forms/MarkdownField";
import { useConfirmation } from "../forms/useConfirmation";
import { useRecordForm } from "../forms/useRecordForm";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage, openOwnerFile, ownerFile } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useDerivatives, useOwner, useOwnerMutation, useProviderConnections, useTripResource } from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import { VisibilityControl } from "./visibility";
import { dayjs } from "../dayjs";
import {
  bytesLabel,
  formatInstant,
  visitTitle,
  type AreaSuggestion,
  type ImportCompleteResult,
  type ImportSession,
  type MediaAsset,
  type MediaDerivative,
  type TravelUpdate,
  type Trip,
  type VisitCandidate,
  type VisitCandidatesResponse,
} from "../tracker-model";

const providerLabel = {
  google_photos_picker: "Google Photos",
  gopro_cloud: "GoPro Cloud",
} as const;

type DerivativeValues = { purpose: MediaDerivative["purpose"]; maxDimension: string; removeAudio: boolean };
const blankDerivative = (): DerivativeValues => ({ purpose: "share", maxDimension: "1600", removeAudio: false });
const dimensionInRange = ({ value }: { value: string }) => {
  const size = Number(value);
  return value.trim() && Number.isInteger(size) && size >= 64 && size <= 4000 ? undefined : "Kies een maximale zijde tussen 64 en 4000 px.";
};

type PresentationValues = { travelUpdateId: string; caption: string; altText: string; focalX: string; focalY: string };
const fromDerivative = (derivative: MediaDerivative): PresentationValues => ({ travelUpdateId: derivative.travel_update_id ?? "", caption: derivative.caption ?? "", altText: derivative.alt_text ?? "", focalX: derivative.focal_x?.toString() ?? "", focalY: derivative.focal_y?.toString() ?? "" });
const percentage = ({ value }: { value: string }) => value === "" || (Number(value) >= 0 && Number(value) <= 100) ? undefined : "Kies een waarde tussen 0 en 100.";

function PresentationForm({ derivative, updates, save }: { derivative: MediaDerivative; updates: TravelUpdate[]; save: (values: Record<string, unknown>) => Promise<void> }) {
  const record = useRecordForm<PresentationValues>({
    defaultValues: fromDerivative(derivative),
    fallback: "De presentatie kon niet worden opgeslagen.",
    serverFields: { travel_update_id: "travelUpdateId", caption: "caption", alt_text: "altText", focal_x: "focalX", focal_y: "focalY" },
    submit: (values) => save({
      travel_update_id: values.travelUpdateId || null,
      caption: values.caption || null,
      alt_text: values.altText || null,
      focal_x: values.focalX === "" ? null : Number(values.focalX),
      focal_y: values.focalY === "" ? null : Number(values.focalY),
    }),
  });
  return <div className="derivative-presentation">
    <RecordForm record={record} submitLabel="Presentatie opslaan" pendingLabel="Opslaan…">
      <record.form.Field name="travelUpdateId">{(field) => <SelectField field={field} label="Bij reisupdate"><option value="">Losse galerijfoto</option>{updates.map((update) => <option key={update.id} value={update.id}>{update.title}</option>)}</SelectField>}</record.form.Field>
      <record.form.Field name="caption">{(field) => <MarkdownField field={field} format="inline" label="Bijschrift" maxLength={500} rows={2} />}</record.form.Field>
      <record.form.Field name="altText">{(field) => <TextField field={field} label="Alternatieve tekst" maxLength={300} />}</record.form.Field>
      <div className="field-row">
        <record.form.Field name="focalX" validators={{ onChange: percentage, onSubmit: percentage }}>{(field) => <TextField field={field} label="Focus horizontaal (%)" type="number" min="0" max="100" />}</record.form.Field>
        <record.form.Field name="focalY" validators={{ onChange: percentage, onSubmit: percentage }}>{(field) => <TextField field={field} label="Focus verticaal (%)" type="number" min="0" max="100" />}</record.form.Field>
      </div>
    </RecordForm>
  </div>;
}

export function MediaManager({ trip }: { trip: Trip }) {
  const confirmation = useConfirmation();
  const owner = useOwner();
  const offline = useOfflineCopies();
  const navigate = useNavigate();
  const mediaQuery = useTripResource(trip.id, "media");
  const visits = useTripResource(trip.id, "visits").data ?? [];
  const assets = mediaQuery.data ?? [];
  // undefined: follow the first asset; null: none chosen (after a delete); a string: the chosen asset.
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const selected = selectedId === undefined ? assets[0] ?? null : assets.find((asset) => asset.id === selectedId) ?? null;
  const derivativesQuery = useDerivatives(trip.id, "media", selected?.id ?? null);
  const derivatives = derivativesQuery.data ?? [];
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [importSession, setImportSession] = useState<ImportSession | null>(null);
  // Only providers this server offers are shown; one the owner has not connected yet is disabled.
  const providers = (useProviderConnections().data ?? []).filter((item) => item.available);
  const [selection, setSelection] = useState<string[]>([]);
  const reviewSelection = selection.filter((id) => assets.some((asset) => asset.id === id));
  const [candidateReview, setCandidateReview] = useState<VisitCandidatesResponse | null>(null);
  const [candidateTimes, setCandidateTimes] = useState<Record<string, string>>({});
  const [candidateLocations, setCandidateLocations] = useState<Record<string, string>>({});
  const [candidateAttachments, setCandidateAttachments] = useState<Record<string, string>>({});
  const [candidateAreas, setCandidateAreas] = useState<Record<string, AreaSuggestion>>({});
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
    // The server also drops the deleted asset from the reisupdates that used it.
    invalidate: (subject) => [...refreshMedia(subject), ownerKeys.trips(subject)],
  });
  const requestDerivative = useOwnerMutation<{ assetId: string; purpose: MediaDerivative["purpose"]; maxDimension: number; removeAudio: boolean }, MediaDerivative>({
    fallback: "De afgeleide kon niet worden gemaakt.",
    request: ({ assetId, purpose, maxDimension, removeAudio }) => ({ path: `${mediaPath}/${assetId}/derivatives`, method: "POST", body: { purpose, max_dimension: maxDimension, ...(selected?.media_kind === "video" ? { remove_audio: removeAudio } : {}) } }),
    invalidate: refreshDerivatives,
  });
  const approve = useOwnerMutation<{ assetId: string; derivative: MediaDerivative }, MediaDerivative>({
    fallback: "De afgeleide kon niet worden goedgekeurd.",
    request: ({ assetId, derivative }) => ({ path: `${mediaPath}/${assetId}/derivatives/${derivative.id}/approve`, method: "POST" }),
    invalidate: refreshDerivatives,
  });
  const retry = useOwnerMutation<{ assetId: string; derivative: MediaDerivative }, MediaDerivative>({
    fallback: "De video kon niet opnieuw worden verwerkt.",
    request: ({ assetId, derivative }) => ({ path: `${mediaPath}/${assetId}/derivatives/${derivative.id}/retry`, method: "POST" }),
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
  const suggestArea = useOwnerMutation<{ latitude: number; longitude: number }, AreaSuggestion>({
    fallback: "Gebied kon niet worden voorgesteld.",
    request: (body) => ({ path: tripPath(trip.id, "areas/suggest"), method: "POST", body }),
    invalidate: () => [],
    gcTime: 0,
  });
  const attach = useOwnerMutation<{ updateId: string; mediaAssetIds: string[] }>({
    fallback: "De private media konden niet aan de reisupdate worden gekoppeld.",
    request: ({ updateId, mediaAssetIds }) => ({ path: tripPath(trip.id, `travel-updates/${updateId}`), method: "PATCH", body: { media_asset_ids: mediaAssetIds } }),
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });

  const derivativeRecord = useRecordForm<DerivativeValues>({
    defaultValues: blankDerivative(),
    fallback: "De afgeleide kon niet worden gemaakt.",
    serverFields: { purpose: "purpose", max_dimension: "maxDimension" },
    submit: async (values) => { if (selected) await requestDerivative.mutateAsync({ assetId: selected.id, purpose: values.purpose, maxDimension: Number(values.maxDimension), removeAudio: values.removeAudio }); },
    onSuccess: () => setNotice("Afgeleide gestart. Controleer de kopie en keur hem daarna expliciet goed."),
  });

  useEffect(() => {
    if (!derivatives.some((item) => item.processing_state === "processing")) return;
    const timer = window.setInterval(() => { void derivativesQuery.refetch(); }, 3000);
    return () => window.clearInterval(timer);
  }, [derivatives, derivativesQuery]);

  const fail = (fallback: string) => (error: unknown) => setNotice(errorMessage(error, fallback));
  const timestamp = formatInstant;

  function openUpload() { setUploadFile(null); setUploadKey((current) => current + 1); setUploading(true); }
  function closeUpload() { setUploading(false); setUploadFile(null); setUploadKey((current) => current + 1); }

  function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadFile) { setNotice("Kies eerst een foto of video."); return; }
    const data = new FormData();
    data.set("file", uploadFile);
    setNotice("Privémedia uploaden…");
    upload.mutateAsync(data).then((saved) => {
      closeUpload();
      setSelectedId(saved.id);
      setNotice("Privémedia geüpload. Je kunt ze nu aan een reisupdate koppelen.");
    }, fail("De media konden niet worden geüpload."));
  }

  function erase(asset: MediaAsset) {
    confirmation.ask({ title: `“${asset.original_filename ?? "dit medium"}” uit deze reis verwijderen?`, description: "Eventuele koppelingen aan reisupdates worden ook weggehaald.", onConfirm: () => performErase(asset) });
  }

  function performErase(asset: MediaAsset) {
    remove.mutateAsync(asset).then(async () => {
      await offline.removeByResource("media_asset", asset.id);
      setSelectedId(null);
      setNotice("Privémedia verwijderd. Eventuele koppelingen aan reisupdates zijn ook weggehaald.");
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

  async function toggleDerivativeOffline(derivative: MediaDerivative) {
    if (!owner || !selected) return;
    if (offline.isPinned("media_derivative", derivative.id)) {
      await offline.removeByResource("media_derivative", derivative.id);
      setNotice("De afgeleide is offline verwijderd.");
      return;
    }
    const blob = await ownerFile(owner.session, derivative.file_url, "De afgeleide kon niet offline worden bewaard.", { cache: "no-store" });
    await offline.pin({
      resourceKind: "media_derivative", resourceId: derivative.id,
      metadataUrl: `${mediaPath}/${selected.id}/derivatives/${derivative.id}`,
      title: selected.original_filename ?? "Afgeleide media", contentType: blob.type,
      bytes: await blob.arrayBuffer(),
    });
    setNotice("De afgeleide is offline bewaard op dit toestel.");
  }

  function eraseDerivative(derivative: MediaDerivative) {
    if (!selected) return;
    confirmation.ask({ title: "Deze afgeleide verwijderen?", description: "Hij wordt direct uit eventuele deelscopes gehaald.", onConfirm: () => performEraseDerivative(selected, derivative) });
  }

  function performEraseDerivative(asset: MediaAsset, derivative: MediaDerivative) {
    removeDerivative.mutateAsync({ assetId: asset.id, derivative }).then(async () => { await offline.removeByResource("media_derivative", derivative.id); setNotice("Afgeleide verwijderd en uit eventuele deelscopes gehaald."); }, fail("De afgeleide kon niet worden verwijderd."));
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
      setCandidateAreas({});
      setNotice(result.candidates.length ? "Kandidaten zijn alleen voor deze private review berekend; er is niets opgeslagen." : "Deze selectie bevat geen bruikbare opname- of locatiegegevens.");
    }, fail("De mogelijke bezoeken konden niet worden berekend."));
  }

  function candidateAssetNames(candidate: VisitCandidate) {
    return candidate.media_asset_ids.map((id) => assets.find((asset) => asset.id === id)?.original_filename ?? "naamloos medium").join(", ");
  }

  function suggestCandidateArea(candidate: VisitCandidate) {
    const locationIndex = candidateLocations[candidate.id];
    if (candidate.location_options.length > 1 && locationIndex === undefined) { setNotice("Kies eerst een GPS-optie."); return; }
    const location = candidate.location_options[locationIndex === undefined ? 0 : Number(locationIndex)];
    if (!location) return;
    suggestArea.mutateAsync({ latitude: location.latitude, longitude: location.longitude }).then(
      (suggestion) => setCandidateAreas((current) => ({ ...current, [candidate.id]: suggestion })),
      fail("Gebied kon niet worden voorgesteld."),
    );
  }

  function startCandidateUpdate(candidate: VisitCandidate) {
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
    const update = trip.travel_updates.find((item) => item.id === candidateAttachments[candidate.id]);
    if (!update) { setNotice("Kies eerst een bestaande reisupdate om de private media aan te koppelen."); return; }
    attach.mutateAsync({ updateId: update.id, mediaAssetIds: [...new Set([...update.media_asset_ids, ...candidate.media_asset_ids])] }).then(
      () => setNotice(`Private media gekoppeld aan “${update.title}”. Er is geen locatie of deelbare inhoud gemaakt.`),
      fail("De private media konden niet aan de reisupdate worden gekoppeld."),
    );
  }

  const readError = mediaQuery.error ?? derivativesQuery.error;
  const message = notice ?? (readError ? errorMessage(readError, "Je media konden niet worden geladen.") : mediaQuery.isPending ? "Laad je private media…" : assets.length ? "Originelen, EXIF en koppelingen blijven alleen in je private tracker." : "Upload foto’s of video’s vanaf dit apparaat, of importeer je geselecteerde media.");

  return <section className="card manager" aria-labelledby="media-title">
    <div className="capture-heading"><div><h3 id="media-title">Mediabibliotheek</h3><p>Originelen en metadata blijven privé. Alleen een aparte, metadata-vrije en goedgekeurde afgeleide kan later bewust worden gedeeld.</p></div><button className="secondary compact" type="button" onClick={openUpload}>Media uploaden</button></div>
    <p className="help" role="status">{message}</p>
    <RecordDialog open={uploading} title="Media uploaden" dirty={uploading && uploadFile !== null} onDismiss={closeUpload}>
      {uploading && <form className="stack-form" onSubmit={submitUpload}>
        <label>Foto of video van dit apparaat<input key={uploadKey} required type="file" accept="image/*,video/*" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} /></label>
        <button type="submit" disabled={upload.isPending}>Privémedia uploaden</button>
      </form>}
    </RecordDialog>
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Importeren</h3><p>{providers.length > 0 ? <>Verbind je provider in <NavLink to="/settings">Instellingen</NavLink> en kies daarna de media die je wilt importeren.</> : "Providerimport is op deze server nog niet beschikbaar. Je kunt media vanaf dit apparaat uploaden."}</p></div></div>
      {providers.length > 0 && <div className="button-row">{providers.map((item) => <button key={item.provider} className="secondary" type="button" disabled={!item.connected} title={item.connected ? undefined : "Verbind eerst in Instellingen"} onClick={() => startProvider(item.provider)}>Kies in {providerLabel[item.provider]}</button>)}</div>}
      {importSession && <aside className="import-session"><strong>{providerLabel[importSession.provider]}-selectie</strong><span>Kies eerst alleen de media die je naar deze private reis wilt kopiëren.</span>{importSession.picker_uri && <a className="action-link" href={importSession.picker_uri} target="_blank" rel="noreferrer">Selectie openen</a>}<button type="button" onClick={finishImport}>Selectie importeren</button></aside>}
    </div>
    {assets.length > 0 && <div className="saved-records manager-list">{assets.map((asset) => <article className={`excerpt-row ${asset.id === selected?.id ? "selected-item" : ""}`} key={asset.id}><button className="document-select" type="button" onClick={() => setSelectedId(asset.id)}><strong>{asset.original_filename ?? "Naamloos medium"}</strong><span>{asset.media_kind === "photo" ? "Foto" : "Video"} · {bytesLabel(asset.byte_size)}{asset.captured_at ? ` · ${timestamp(asset.captured_at)}` : ""}</span></button><div className="button-row"><label className="scope-choice"><input type="checkbox" checked={reviewSelection.includes(asset.id)} onChange={() => toggleReviewSelection(asset.id)} />Bezoeken beoordelen</label><button className="secondary compact" type="button" onClick={() => open(asset.file_url, "Het private origineel kon niet worden geopend.")}>Origineel bekijken</button><button className="secondary compact" type="button" onClick={() => void toggleOffline(asset).catch(fail("Het private medium kon niet offline worden bewaard."))}>{offline.isPinned("media_asset", asset.id) ? "Offline verwijderen" : "Offline bewaren"}</button><button className="danger compact" type="button" onClick={() => erase(asset)}>Verwijderen</button></div></article>)}</div>}
    {assets.length > 0 && <div className="manager-subsection"><div className="capture-heading"><div><h3>Mogelijke bezoeken beoordelen</h3><p>Kies hierboven private media. Kandidaten gebruiken een venster van twee uur en houden GPS-punten die meer dan {candidateReview?.gps_agreement_metres ?? 500} meter verschillen als afzonderlijke keuzes. Ze worden nooit automatisch opgeslagen.</p></div></div><button type="button" onClick={review}>Geselecteerde media beoordelen</button>{candidateReview?.unavailable_media_asset_ids.length ? <p className="help">{candidateReview.unavailable_media_asset_ids.length} geselecteerd medium heeft geen bruikbare opname- of GPS-metadata en is niet gegokt in een kandidaat.</p> : null}{candidateReview?.candidates.map((candidate) => <article className="scope-item" key={candidate.id}><strong>{candidateAssetNames(candidate)}</strong><span>{candidate.starts_at ? `${timestamp(candidate.starts_at)}${candidate.ends_at && candidate.ends_at !== candidate.starts_at ? ` – ${dayjs(candidate.ends_at).format("HH:mm")}` : ""}` : "Geen opnametijd beschikbaar"}</span>{candidate.time_options.length > 1 && <label>Gebruik opnametijd<select value={candidateTimes[candidate.id] ?? ""} onChange={(event) => setCandidateTimes((current) => ({ ...current, [candidate.id]: event.target.value }))}><option value="">Kies zelf een tijd</option>{candidate.time_options.map((option) => <option key={option.media_asset_id} value={option.captured_at}>{timestamp(option.captured_at)}</option>)}</select></label>}{candidate.location_options.length > 1 && <label>GPS-keuze<select value={candidateLocations[candidate.id] ?? ""} onChange={(event) => setCandidateLocations((current) => ({ ...current, [candidate.id]: event.target.value }))}><option value="">Locatie negeren</option>{candidate.location_options.map((option, index) => <option key={option.media_asset_ids.join("-")} value={index}>Locatie uit {option.media_asset_ids.length} medium/media</option>)}</select></label>}{candidate.location_options.length === 0 && <p className="help">Geen GPS beschikbaar; er wordt geen plaats voorgesteld.</p>}{candidate.location_options.length > 1 && <p className="help">De GPS-metagegevens spreken elkaar tegen. Kies hoogstens één optie; er wordt niets samengevoegd.</p>}{candidate.location_options.length > 0 && <button className="secondary compact" type="button" onClick={() => suggestCandidateArea(candidate)}>Gebied en bezoek voorstellen</button>}{candidateAreas[candidate.id] && <p className="help">{candidateAreas[candidate.id].existing_area_id ? `Bestaand gebied: ${candidateAreas[candidate.id].area.label}` : `Nieuw gebied mogelijk: ${candidateAreas[candidate.id].area.label} (${candidateAreas[candidate.id].area.timezone ?? "tijdzone onbekend"})`}. {visits.filter((visit) => visit.area.id === candidateAreas[candidate.id].existing_area_id && candidate.starts_at && visit.starts_on && candidate.starts_at.slice(0, 10) >= visit.starts_on && candidate.starts_at.slice(0, 10) <= (visit.ends_on ?? visit.starts_on)).map((visit) => visitTitle(visit)).join(", ") || "Nieuw bezoek mogelijk"}. Dit voorstel is niet opgeslagen.</p>}<div className="button-row"><button type="button" onClick={() => startCandidateUpdate(candidate)}>Als nieuwe reisupdate openen</button>{trip.travel_updates.length > 0 && <><label className="scope-choice">Koppel aan<select value={candidateAttachments[candidate.id] ?? ""} onChange={(event) => setCandidateAttachments((current) => ({ ...current, [candidate.id]: event.target.value }))}><option value="">Kies bestaande reisupdate</option>{trip.travel_updates.map((update) => <option value={update.id} key={update.id}>{update.title}</option>)}</select></label><button className="secondary" type="button" onClick={() => attachCandidate(candidate)}>Aan reisupdate koppelen</button></>}</div></article>)}</div>}
    {selected && <div className="manager-subsection"><div className="capture-heading"><div><h3>Afgeleiden</h3><p>Voor {selected.original_filename ?? "dit medium"}. Een nieuwe kopie vereist altijd expliciete goedkeuring.</p></div></div>
      <RecordForm record={derivativeRecord} submitLabel={selected.media_kind === "video" ? "Veilige videokopie maken" : "Metadata-vrije afgeleide maken"} pendingLabel="Afgeleide maken…">
        <div className="field-row">
          <derivativeRecord.form.Field name="purpose">{(field) => <SelectField field={field} label="Doel"><option value="share">Delen</option><option value="static_export">Statisch archief</option><option value="owner_preview">Private voorvertoning</option></SelectField>}</derivativeRecord.form.Field>
          {selected.media_kind === "photo" && <derivativeRecord.form.Field name="maxDimension" validators={{ onChange: dimensionInRange, onSubmit: dimensionInRange }}>{(field) => <TextField field={field} label="Maximale zijde (px)" required min={64} max={4000} type="number" />}</derivativeRecord.form.Field>}
          {selected.media_kind === "video" && <derivativeRecord.form.Field name="removeAudio">{(field) => <label className="scope-choice"><input type="checkbox" checked={field.state.value} onChange={(event) => field.handleChange(event.target.checked)} />Geluid verwijderen</label>}</derivativeRecord.form.Field>}
        </div>
      </RecordForm>
      {derivatives.length > 0 && <div className="saved-records manager-list">{derivatives.map((derivative) => <article className="scope-item" key={derivative.id}><div><strong>{derivative.processing_state === "processing" ? "Video wordt verwerkt…" : derivative.processing_state === "failed" ? "Verwerking mislukt" : derivative.review_state === "approved" ? "Goedgekeurde afgeleide" : "Wacht op goedkeuring"}</strong><span>{derivative.purpose.replace("_", " ")} · {derivative.width && derivative.height ? `${derivative.width} × ${derivative.height}` : "afmetingen onbekend"}{derivative.media_kind === "video" && ` · ${derivative.duration_seconds?.toFixed(1) ?? "?"} s · ${derivative.remove_audio ? "zonder geluid" : "met geluid"}`}</span>{derivative.review_state === "approved" && derivative.processing_state !== "failed" && derivative.purpose === "share" && <VisibilityControl tripId={trip.id} kind="media_derivative" id={derivative.id} value={derivative.visibility} name={`afgeleide van ${selected.original_filename ?? "foto"}`} followsUpdate={trip.travel_updates.find((update) => update.id === derivative.travel_update_id)?.title} />}</div><div className="button-row">{derivative.processing_state !== "processing" && derivative.processing_state !== "failed" && <button className="secondary compact" type="button" onClick={() => open(derivative.file_url, "De private afgeleide kon niet worden geopend.")}>{derivative.media_kind === "video" ? "Video en geluid controleren" : "Bekijken"}</button>}{derivative.processing_state !== "processing" && derivative.processing_state !== "failed" && <button className="secondary compact" type="button" onClick={() => void toggleDerivativeOffline(derivative).catch(fail("De afgeleide kon niet offline worden bewaard."))}>{offline.isPinned("media_derivative", derivative.id) ? "Offline verwijderen" : `Offline bewaren (${bytesLabel(derivative.byte_size ?? 0)})`}</button>}{derivative.processing_state === "failed" && <button className="secondary compact" type="button" onClick={() => retry.mutateAsync({ assetId: selected.id, derivative }).catch(fail("De video kon niet opnieuw worden verwerkt."))}>Opnieuw proberen</button>}{derivative.review_state === "pending" && derivative.processing_state !== "processing" && derivative.processing_state !== "failed" && <button className="compact" type="button" onClick={() => approve.mutateAsync({ assetId: selected.id, derivative }).then(() => setNotice("Afgeleide expliciet goedgekeurd. Kies nu wie hem mag zien."), fail("De afgeleide kon niet worden goedgekeurd."))}>Expliciet goedkeuren</button>}<button className="danger compact" type="button" onClick={() => eraseDerivative(derivative)}>Verwijderen</button></div>{derivative.purpose === "share" && derivative.processing_state !== "processing" && <PresentationForm key={derivative.id} derivative={derivative} updates={trip.travel_updates} save={async (values) => { await presentation.mutateAsync({ assetId: selected.id, derivative, values }); setNotice("Presentatie opgeslagen. Alleen geselecteerde velden in een deelscope worden zichtbaar."); }} />}</article>)}</div>}
    </div>}
    {confirmation.dialog}
  </section>;
}
