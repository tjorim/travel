import { useEffect, useState, type FormEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../auth-context";
import {
  apiError,
  apiHeaders,
  bytesLabel,
  openProtectedFile,
  type ImportCompleteResult,
  type ImportSession,
  type MediaAsset,
  type MediaDerivative,
  type Trip,
  type VisitCandidate,
  type VisitCandidatesResponse,
} from "../tracker-model";

type DerivativeDraft = {
  purpose: MediaDerivative["purpose"];
  maxDimension: number;
};

const providerLabel = {
  google_photos_picker: "Google Photos",
  gopro_cloud: "GoPro Cloud",
} as const;

export function MediaManager({ trip }: { trip: Trip }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [derivatives, setDerivatives] = useState<MediaDerivative[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [derivativeDraft, setDerivativeDraft] = useState<DerivativeDraft>({ purpose: "share", maxDimension: 1600 });
  const [importSession, setImportSession] = useState<ImportSession | null>(null);
  const [reviewSelection, setReviewSelection] = useState<string[]>([]);
  const [candidateReview, setCandidateReview] = useState<VisitCandidatesResponse | null>(null);
  const [candidateTimes, setCandidateTimes] = useState<Record<string, string>>({});
  const [candidateLocations, setCandidateLocations] = useState<Record<string, string>>({});
  const [candidateAttachments, setCandidateAttachments] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("Laad je private media…");

  async function load(selectId?: string | null) {
    if (!session) return;
    const response = await fetch(`/api/v1/trips/${trip.id}/media`, { headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Je media konden niet worden geladen.");
    const loaded = await response.json() as MediaAsset[];
    setAssets(loaded);
    setReviewSelection((current) => current.filter((id) => loaded.some((asset) => asset.id === id)));
    setSelectedId((current) => selectId === null ? null : loaded.some((asset) => asset.id === (selectId ?? current)) ? (selectId ?? current) : loaded[0]?.id ?? null);
    setMessage(loaded.length ? "Originelen, EXIF en koppelingen blijven alleen in je private tracker." : "Upload foto’s of video’s vanaf dit apparaat, of importeer je geselecteerde media.");
  }

  useEffect(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je media konden niet worden geladen.")); }, [session, trip.id]);

  useEffect(() => {
    if (!session || !selectedId) { setDerivatives([]); return; }
    void fetch(`/api/v1/trips/${trip.id}/media/${selectedId}/derivatives`, { headers: apiHeaders(session) })
      .then((response) => response.ok ? response.json() as Promise<MediaDerivative[]> : apiError(response, "De afgeleiden konden niet worden geladen."))
      .then(setDerivatives)
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De afgeleiden konden niet worden geladen."));
  }, [selectedId, session, trip.id]);

  const selected = assets.find((asset) => asset.id === selectedId) ?? null;

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !uploadFile) { setMessage("Kies eerst een foto of video."); return; }
    const data = new FormData();
    data.set("file", uploadFile);
    setMessage("Privémedia uploaden…");
    const response = await fetch(`/api/v1/trips/${trip.id}/media/uploads`, {
      method: "POST", headers: { Authorization: `Bearer ${session.accessToken}` }, body: data,
    });
    if (!response.ok) return apiError(response, "De media konden niet worden geüpload.");
    const saved = await response.json() as MediaAsset;
    setUploadFile(null);
    await load(saved.id);
    setMessage("Privémedia geüpload. Je kunt ze nu aan een moment koppelen.");
  }

  async function deleteAsset(asset: MediaAsset) {
    if (!session || !window.confirm(`Verwijder “${asset.original_filename ?? "dit medium"}” uit deze reis?`)) return;
    const response = await fetch(`/api/v1/trips/${trip.id}/media/${asset.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De media konden niet worden verwijderd.");
    await load(null);
    setMessage("Privémedia verwijderd. Eventuele momentkoppelingen zijn ook weggehaald.");
  }

  async function requestDerivative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selected) return;
    const response = await fetch(`/api/v1/trips/${trip.id}/media/${selected.id}/derivatives`, {
      method: "POST", headers: apiHeaders(session), body: JSON.stringify({ purpose: derivativeDraft.purpose, max_dimension: derivativeDraft.maxDimension }),
    });
    if (!response.ok) return apiError(response, "De afgeleide kon niet worden gemaakt.");
    const saved = await response.json() as MediaDerivative;
    setDerivatives((current) => [saved, ...current]);
    setMessage("Metadata-vrije afgeleide gemaakt. Controleer hem en keur hem daarna expliciet goed.");
  }

  async function approveDerivative(derivative: MediaDerivative) {
    if (!session || !selected) return;
    const response = await fetch(`/api/v1/trips/${trip.id}/media/${selected.id}/derivatives/${derivative.id}/approve`, { method: "POST", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De afgeleide kon niet worden goedgekeurd.");
    const saved = await response.json() as MediaDerivative;
    setDerivatives((current) => current.map((item) => item.id === saved.id ? saved : item));
    setMessage("Afgeleide expliciet goedgekeurd. Delen vraagt nog altijd een aparte scope.");
  }

  async function deleteDerivative(derivative: MediaDerivative) {
    if (!session || !selected || !window.confirm("Verwijder deze afgeleide? Hij wordt direct uit eventuele deelscopes gehaald.")) return;
    const response = await fetch(`/api/v1/trips/${trip.id}/media/${selected.id}/derivatives/${derivative.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De afgeleide kon niet worden verwijderd.");
    setDerivatives((current) => current.filter((item) => item.id !== derivative.id));
    setMessage("Afgeleide verwijderd en uit eventuele deelscopes gehaald.");
  }

  async function startImport(provider: ImportSession["provider"]) {
    if (!session) return;
    setMessage(`${providerLabel[provider]}-selectie starten…`);
    const response = await fetch(`/api/v1/trips/${trip.id}/media/imports/${provider}/sessions`, { method: "POST", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De importsessie kon niet worden gestart.");
    const created = await response.json() as ImportSession;
    setImportSession(created);
    setMessage(`Kies media in ${providerLabel[provider]} en kom daarna hier terug om je selectie te importeren.`);
  }

  async function completeImport() {
    if (!session || !importSession) return;
    setMessage("Geselecteerde media veilig kopiëren naar je private reis…");
    const response = await fetch(`/api/v1/trips/${trip.id}/media/imports/${importSession.provider}/sessions/${importSession.id}/complete`, { method: "POST", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De importsessie kon niet worden voltooid.");
    const outcome = await response.json() as ImportCompleteResult;
    if (!outcome.ready) { setMessage("Je selectie is nog niet klaar bij de provider. Probeer opnieuw wanneer je klaar bent."); return; }
    await load(outcome.imported[0]?.id);
    setMessage(`${outcome.imported.length} item(s) geïmporteerd${outcome.failed.length ? `; ${outcome.failed.length} kon(den) niet worden gekopieerd.` : "."}`);
  }

  function toggleReviewSelection(assetId: string) {
    setReviewSelection((current) => current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]);
  }

  async function reviewVisits() {
    if (!session || reviewSelection.length === 0) { setMessage("Kies eerst private media om als mogelijke bezoeken te bekijken."); return; }
    const response = await fetch(`/api/v1/trips/${trip.id}/media/visit-candidates`, {
      method: "POST", headers: apiHeaders(session), body: JSON.stringify({ media_asset_ids: reviewSelection }),
    });
    if (!response.ok) return apiError(response, "De mogelijke bezoeken konden niet worden berekend.");
    const review = await response.json() as VisitCandidatesResponse;
    setCandidateReview(review);
    setCandidateTimes({});
    setCandidateLocations({});
    setCandidateAttachments({});
    setMessage(review.candidates.length ? "Kandidaten zijn alleen voor deze private review berekend; er is niets opgeslagen." : "Deze selectie bevat geen bruikbare opname- of locatiegegevens.");
  }

  function candidateAssetNames(candidate: VisitCandidate) {
    return candidate.media_asset_ids.map((id) => assets.find((asset) => asset.id === id)?.original_filename ?? "naamloos medium").join(", ");
  }

  function startCandidateMoment(candidate: VisitCandidate) {
    const time = candidateTimes[candidate.id] || (candidate.time_options.length === 1 ? candidate.time_options[0].captured_at : "");
    const locationIndex = candidateLocations[candidate.id];
    if (candidate.time_options.length > 1 && !time) { setMessage("Kies eerst welke opnametijd je voor dit kandidaatbezoek wilt gebruiken."); return; }
    if (candidate.location_options.length > 1 && locationIndex === undefined) { setMessage("De GPS-metagegevens verschillen. Kies eerst zelf een locatieoptie, of negeer de locatie."); return; }
    const selectedLocation = locationIndex === "" ? undefined : candidate.location_options[locationIndex === undefined ? 0 : Number(locationIndex)];
    navigate("/capture", {
      state: { candidate: { tripId: trip.id, mediaAssetIds: candidate.media_asset_ids, occurredAt: time || undefined, gps: selectedLocation && { latitude: selectedLocation.latitude, longitude: selectedLocation.longitude } } },
    });
  }

  async function attachCandidate(candidate: VisitCandidate) {
    if (!session) return;
    const momentId = candidateAttachments[candidate.id];
    const moment = trip.moments.find((item) => item.id === momentId);
    if (!moment) { setMessage("Kies eerst een bestaand moment om de private media aan te koppelen."); return; }
    const response = await fetch(`/api/v1/trips/${trip.id}/moments/${moment.id}`, {
      method: "PATCH",
      headers: apiHeaders(session),
      body: JSON.stringify({ media_asset_ids: [...new Set([...moment.media_asset_ids, ...candidate.media_asset_ids])] }),
    });
    if (!response.ok) return apiError(response, "De private media konden niet aan het moment worden gekoppeld.");
    setMessage(`Private media gekoppeld aan “${moment.title}”. Er is geen plaats of deelbare inhoud gemaakt.`);
  }

  return <section className="card manager" aria-labelledby="media-title">
    <div className="capture-heading"><div><h3 id="media-title">Mediabibliotheek</h3><p>Originelen en metadata blijven privé. Alleen een aparte, metadata-vrije en goedgekeurde afgeleide kan later bewust worden gedeeld.</p></div></div>
    <p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={(event) => void upload(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De media konden niet worden geüpload."))}>
      <label>Foto of video van dit apparaat<input required type="file" accept="image/*,video/*" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} /></label>
      <button type="submit">Privémedia uploaden</button>
    </form>
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Importeren</h3><p>Verbind je provider in <NavLink to="/settings">Instellingen</NavLink>. De volledige OAuth-koppeling volgt in #55; hier start en voltooi je alleen een expliciete selectie.</p></div></div>
      <div className="button-row"><button className="secondary" type="button" onClick={() => void startImport("google_photos_picker").catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De importsessie kon niet worden gestart."))}>Kies in Google Photos</button><button className="secondary" type="button" onClick={() => void startImport("gopro_cloud").catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De importsessie kon niet worden gestart."))}>Kies in GoPro Cloud</button></div>
      {importSession && <aside className="import-session"><strong>{providerLabel[importSession.provider]}-selectie</strong><span>Kies eerst alleen de media die je naar deze private reis wilt kopiëren.</span>{importSession.picker_uri && <a className="action-link" href={importSession.picker_uri} target="_blank" rel="noreferrer">Selectie openen</a>}<button type="button" onClick={() => void completeImport().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De importsessie kon niet worden voltooid."))}>Selectie importeren</button></aside>}
    </div>
    {assets.length > 0 && <div className="saved-moments manager-list">{assets.map((asset) => <article className={`excerpt-row ${asset.id === selectedId ? "selected-item" : ""}`} key={asset.id}><button className="document-select" type="button" onClick={() => setSelectedId(asset.id)}><strong>{asset.original_filename ?? "Naamloos medium"}</strong><span>{asset.media_kind === "photo" ? "Foto" : "Video"} · {bytesLabel(asset.byte_size)}{asset.captured_at ? ` · ${new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(asset.captured_at))}` : ""}</span></button><div className="button-row"><label className="scope-choice"><input type="checkbox" checked={reviewSelection.includes(asset.id)} onChange={() => toggleReviewSelection(asset.id)} />Bezoeken beoordelen</label><button className="secondary compact" type="button" onClick={() => void openProtectedFile(session!, asset.file_url, "Het private origineel kon niet worden geopend.").catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het private origineel kon niet worden geopend."))}>Origineel bekijken</button><button className="danger compact" type="button" onClick={() => void deleteAsset(asset).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De media konden niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
    {assets.length > 0 && <div className="manager-subsection"><div className="capture-heading"><div><h3>Mogelijke bezoeken beoordelen</h3><p>Kies hierboven private media. Kandidaten gebruiken een venster van twee uur en houden GPS-punten die meer dan {candidateReview?.gps_agreement_metres ?? 500} meter verschillen als afzonderlijke keuzes. Ze worden nooit automatisch opgeslagen.</p></div></div><button type="button" onClick={() => void reviewVisits().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De mogelijke bezoeken konden niet worden berekend."))}>Geselecteerde media beoordelen</button>{candidateReview?.unavailable_media_asset_ids.length ? <p className="help">{candidateReview.unavailable_media_asset_ids.length} geselecteerd medium heeft geen bruikbare opname- of GPS-metadata en is niet gegokt in een kandidaat.</p> : null}{candidateReview?.candidates.map((candidate) => <article className="scope-item" key={candidate.id}><strong>{candidateAssetNames(candidate)}</strong><span>{candidate.starts_at ? `${new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(candidate.starts_at))}${candidate.ends_at && candidate.ends_at !== candidate.starts_at ? ` – ${new Intl.DateTimeFormat("nl-BE", { timeStyle: "short" }).format(new Date(candidate.ends_at))}` : ""}` : "Geen opnametijd beschikbaar"}</span>{candidate.time_options.length > 1 && <label>Gebruik opnametijd<select value={candidateTimes[candidate.id] ?? ""} onChange={(event) => setCandidateTimes((current) => ({ ...current, [candidate.id]: event.target.value }))}><option value="">Kies zelf een tijd</option>{candidate.time_options.map((option) => <option key={option.media_asset_id} value={option.captured_at}>{new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(option.captured_at))}</option>)}</select></label>}{candidate.location_options.length > 1 && <label>GPS-keuze<select value={candidateLocations[candidate.id] ?? ""} onChange={(event) => setCandidateLocations((current) => ({ ...current, [candidate.id]: event.target.value }))}><option value="">Locatie negeren</option>{candidate.location_options.map((option, index) => <option key={option.media_asset_ids.join("-")} value={index}>Locatie uit {option.media_asset_ids.length} medium/media</option>)}</select></label>}{candidate.location_options.length === 0 && <p className="help">Geen GPS beschikbaar; er wordt geen plaats voorgesteld.</p>}{candidate.location_options.length > 1 && <p className="help">De GPS-metagegevens spreken elkaar tegen. Kies hoogstens één optie; er wordt niets samengevoegd.</p>}<div className="button-row"><button type="button" onClick={() => startCandidateMoment(candidate)}>Als nieuw moment openen</button>{trip.moments.length > 0 && <><label className="scope-choice">Koppel aan<select value={candidateAttachments[candidate.id] ?? ""} onChange={(event) => setCandidateAttachments((current) => ({ ...current, [candidate.id]: event.target.value }))}><option value="">Kies bestaand moment</option>{trip.moments.map((moment) => <option value={moment.id} key={moment.id}>{moment.title}</option>)}</select></label><button className="secondary" type="button" onClick={() => void attachCandidate(candidate).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De private media konden niet worden gekoppeld."))}>Aan moment koppelen</button></>}</div></article>)}</div>}
    {selected && <div className="manager-subsection"><div className="capture-heading"><div><h3>Afgeleiden</h3><p>Voor {selected.original_filename ?? "dit medium"}. {selected.media_kind === "video" ? "Video-afgeleiden zijn nog niet beschikbaar." : "Een nieuwe kopie start altijd als ‘wacht op goedkeuring’."}</p></div></div>
      {selected.media_kind === "photo" && <form className="stack-form" onSubmit={(event) => void requestDerivative(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De afgeleide kon niet worden gemaakt."))}><div className="field-row"><label>Doel<select value={derivativeDraft.purpose} onChange={(event) => setDerivativeDraft((draft) => ({ ...draft, purpose: event.target.value as MediaDerivative["purpose"] }))}><option value="share">Delen</option><option value="static_export">Statisch archief</option><option value="owner_preview">Private voorvertoning</option></select></label><label>Maximale zijde (px)<input required min={64} max={4000} type="number" value={derivativeDraft.maxDimension} onChange={(event) => setDerivativeDraft((draft) => ({ ...draft, maxDimension: Number(event.target.value) }))} /></label></div><button type="submit">Metadata-vrije afgeleide maken</button></form>}
      {derivatives.length > 0 && <div className="saved-moments manager-list">{derivatives.map((derivative) => <article className="excerpt-row" key={derivative.id}><div><strong>{derivative.review_state === "approved" ? "Goedgekeurde afgeleide" : "Wacht op goedkeuring"}</strong><span>{derivative.purpose.replace("_", " ")} · {derivative.width && derivative.height ? `${derivative.width} × ${derivative.height}` : "afmetingen onbekend"}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => void openProtectedFile(session!, derivative.file_url, "De private afgeleide kon niet worden geopend.").catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De private afgeleide kon niet worden geopend."))}>Bekijken</button>{derivative.review_state === "pending" && <button className="compact" type="button" onClick={() => void approveDerivative(derivative).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De afgeleide kon niet worden goedgekeurd."))}>Expliciet goedkeuren</button>}<button className="danger compact" type="button" onClick={() => void deleteDerivative(derivative).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De afgeleide kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
    </div>}
  </section>;
}
