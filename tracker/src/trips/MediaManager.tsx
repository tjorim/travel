import { useEffect, useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";

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
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [derivatives, setDerivatives] = useState<MediaDerivative[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [derivativeDraft, setDerivativeDraft] = useState<DerivativeDraft>({ purpose: "share", maxDimension: 1600 });
  const [importSession, setImportSession] = useState<ImportSession | null>(null);
  const [message, setMessage] = useState("Laad je private media…");

  async function load(selectId?: string | null) {
    if (!session) return;
    const response = await fetch(`/api/v1/trips/${trip.id}/media`, { headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Je media konden niet worden geladen.");
    const loaded = await response.json() as MediaAsset[];
    setAssets(loaded);
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
    {assets.length > 0 && <div className="saved-moments manager-list">{assets.map((asset) => <article className={`excerpt-row ${asset.id === selectedId ? "selected-item" : ""}`} key={asset.id}><button className="document-select" type="button" onClick={() => setSelectedId(asset.id)}><strong>{asset.original_filename ?? "Naamloos medium"}</strong><span>{asset.media_kind === "photo" ? "Foto" : "Video"} · {bytesLabel(asset.byte_size)}{asset.captured_at ? ` · ${new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(asset.captured_at))}` : ""}</span></button><div className="button-row"><button className="secondary compact" type="button" onClick={() => void openProtectedFile(session!, asset.file_url, "Het private origineel kon niet worden geopend.").catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het private origineel kon niet worden geopend."))}>Origineel bekijken</button><button className="danger compact" type="button" onClick={() => void deleteAsset(asset).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De media konden niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
    {selected && <div className="manager-subsection"><div className="capture-heading"><div><h3>Afgeleiden</h3><p>Voor {selected.original_filename ?? "dit medium"}. {selected.media_kind === "video" ? "Video-afgeleiden zijn nog niet beschikbaar." : "Een nieuwe kopie start altijd als ‘wacht op goedkeuring’."}</p></div></div>
      {selected.media_kind === "photo" && <form className="stack-form" onSubmit={(event) => void requestDerivative(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De afgeleide kon niet worden gemaakt."))}><div className="field-row"><label>Doel<select value={derivativeDraft.purpose} onChange={(event) => setDerivativeDraft((draft) => ({ ...draft, purpose: event.target.value as MediaDerivative["purpose"] }))}><option value="share">Delen</option><option value="static_export">Statisch archief</option><option value="owner_preview">Private voorvertoning</option></select></label><label>Maximale zijde (px)<input required min={64} max={4000} type="number" value={derivativeDraft.maxDimension} onChange={(event) => setDerivativeDraft((draft) => ({ ...draft, maxDimension: Number(event.target.value) }))} /></label></div><button type="submit">Metadata-vrije afgeleide maken</button></form>}
      {derivatives.length > 0 && <div className="saved-moments manager-list">{derivatives.map((derivative) => <article className="excerpt-row" key={derivative.id}><div><strong>{derivative.review_state === "approved" ? "Goedgekeurde afgeleide" : "Wacht op goedkeuring"}</strong><span>{derivative.purpose.replace("_", " ")} · {derivative.width && derivative.height ? `${derivative.width} × ${derivative.height}` : "afmetingen onbekend"}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => void openProtectedFile(session!, derivative.file_url, "De private afgeleide kon niet worden geopend.").catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De private afgeleide kon niet worden geopend."))}>Bekijken</button>{derivative.review_state === "pending" && <button className="compact" type="button" onClick={() => void approveDerivative(derivative).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De afgeleide kon niet worden goedgekeurd."))}>Expliciet goedkeuren</button>}<button className="danger compact" type="button" onClick={() => void deleteDerivative(derivative).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De afgeleide kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
    </div>}
  </section>;
}
