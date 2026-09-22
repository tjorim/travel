import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { apiError, apiHeaders, bytesLabel, openProtectedFile, type DocumentAsset, type DocumentDerivative, type Trip } from "../tracker-model";

export function DocumentManager({ trip }: { trip: Trip }) {
  const { session } = useAuth();
  const [documents, setDocuments] = useState<DocumentAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [derivatives, setDerivatives] = useState<DocumentDerivative[]>([]);
  const [message, setMessage] = useState("Laad je private documenten…");
  const [upload, setUpload] = useState({ title: "", kind: "booking" as DocumentAsset["document_kind"], file: null as File | null });
  const [redaction, setRedaction] = useState({ file: null as File | null, manifest: null as File | null });

  async function load(selectId?: string | null) {
    if (!session) return;
    const response = await fetch(`/api/trips/${trip.id}/documents`, { headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Je documenten konden niet worden geladen.");
    const loaded = await response.json() as DocumentAsset[];
    setDocuments(loaded);
    setSelectedId((current) => selectId === null ? null : loaded.some((document) => document.id === (selectId ?? current)) ? (selectId ?? current) : loaded[0]?.id ?? null);
    setMessage(loaded.length ? "Documenten en originelen blijven uitsluitend in je private tracker." : "Upload een privédocument wanneer je het wilt bewaren.");
  }

  useEffect(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je documenten konden niet worden geladen.")); }, [session, trip.id]);
  useEffect(() => {
    if (!session || !selectedId) { setDerivatives([]); return; }
    void fetch(`/api/trips/${trip.id}/documents/${selectedId}/derivatives`, { headers: apiHeaders(session) })
      .then((response) => response.ok ? response.json() as Promise<DocumentDerivative[]> : apiError(response, "De afgeleide documenten konden niet worden geladen."))
      .then(setDerivatives)
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De afgeleide documenten konden niet worden geladen."));
  }, [selectedId, session, trip.id]);

  const selected = documents.find((document) => document.id === selectedId) ?? null;

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !upload.file) { setMessage("Kies een bestand om te uploaden."); return; }
    const data = new FormData(); data.set("title", upload.title.trim()); data.set("document_kind", upload.kind); data.set("file", upload.file);
    const response = await fetch(`/api/trips/${trip.id}/documents/uploads`, { method: "POST", headers: { Authorization: `Bearer ${session.accessToken}` }, body: data });
    if (!response.ok) return apiError(response, "Het document kon niet worden geüpload.");
    const saved = await response.json() as DocumentAsset;
    setUpload({ title: "", kind: "booking", file: null }); await load(saved.id); setMessage("Privédocument geüpload.");
  }

  async function deleteDocument(document: DocumentAsset) {
    if (!session || !window.confirm(`Verwijder document “${document.title}”?`)) return;
    const response = await fetch(`/api/trips/${trip.id}/documents/${document.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Het document kon niet worden verwijderd.");
    await load(null); setMessage("Privédocument verwijderd.");
  }

  async function addDerivative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selected || !redaction.file || !redaction.manifest) { setMessage("Kies een geredigeerd bestand én een redactie-manifest."); return; }
    const data = new FormData(); data.set("file", redaction.file); data.set("redaction_manifest", redaction.manifest);
    const response = await fetch(`/api/trips/${trip.id}/documents/${selected.id}/derivatives`, { method: "POST", headers: { Authorization: `Bearer ${session.accessToken}` }, body: data });
    if (!response.ok) return apiError(response, "De geredigeerde afgeleide kon niet worden opgeslagen.");
    const saved = await response.json() as DocumentDerivative;
    setRedaction({ file: null, manifest: null }); setDerivatives((current) => [saved, ...current]); setMessage("Geredigeerde afgeleide opgeslagen en wacht op jouw expliciete goedkeuring.");
  }

  async function approveDerivative(derivative: DocumentDerivative) {
    if (!session || !selected) return;
    const response = await fetch(`/api/trips/${trip.id}/documents/${selected.id}/derivatives/${derivative.id}/approve`, { method: "POST", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De afgeleide kon niet worden goedgekeurd.");
    const saved = await response.json() as DocumentDerivative;
    setDerivatives((current) => current.map((item) => item.id === saved.id ? saved : item)); setMessage("Afgeleide expliciet goedgekeurd. Delen gebeurt nog steeds alleen via een aparte scope.");
  }

  return <section className="card manager" aria-labelledby="documents-title"><div className="capture-heading"><div><h3 id="documents-title">Documenten</h3><p>Originelen staan alleen in je private tracker. Een mogelijke gedeelde kopie moet eerst geredigeerd én goedgekeurd zijn.</p></div></div><p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={(event) => void uploadDocument(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het document kon niet worden geüpload."))}><div className="field-row"><label>Titel<input required maxLength={160} value={upload.title} onChange={(event) => setUpload((draft) => ({ ...draft, title: event.target.value }))} /></label><label>Soort<select value={upload.kind} onChange={(event) => setUpload((draft) => ({ ...draft, kind: event.target.value as DocumentAsset["document_kind"] }))}><option value="booking">Boeking</option><option value="itinerary">Routeplan</option><option value="receipt">Bon</option><option value="other">Anders</option></select></label></div><label>Privébestand<input required type="file" onChange={(event) => setUpload((draft) => ({ ...draft, file: event.target.files?.[0] ?? null }))} /></label><button type="submit">Document uploaden</button></form>
    {documents.length > 0 && <div className="saved-moments manager-list">{documents.map((document) => <article className={`excerpt-row ${document.id === selectedId ? "selected-item" : ""}`} key={document.id}><button className="document-select" type="button" onClick={() => setSelectedId(document.id)}><strong>{document.title}</strong><span>{document.original_filename ?? "Naamloos bestand"} · {bytesLabel(document.byte_size)}</span></button><div className="button-row"><button className="secondary compact" type="button" onClick={() => void openProtectedFile(session!, document.file_url, "Het private origineel kon niet worden geopend.").catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het private origineel kon niet worden geopend."))}>Origineel bekijken</button><button className="danger compact" type="button" onClick={() => void deleteDocument(document).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het document kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
    {selected && <div className="manager-subsection"><div className="capture-heading"><div><h3>Geredigeerde afgeleiden</h3><p>Voor {selected.title}. Upload een nieuw geredigeerd bestand met zijn manifest; het origineel wordt nooit als afgeleide gebruikt.</p></div></div><form className="stack-form" onSubmit={(event) => void addDerivative(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De afgeleide kon niet worden opgeslagen."))}><label>Geredigeerd bestand<input required type="file" onChange={(event) => setRedaction((draft) => ({ ...draft, file: event.target.files?.[0] ?? null }))} /></label><label>Redactie-manifest<input required type="file" accept="application/json,.json" onChange={(event) => setRedaction((draft) => ({ ...draft, manifest: event.target.files?.[0] ?? null }))} /></label><button type="submit">Geredigeerde kopie toevoegen</button></form>{derivatives.length > 0 && <div className="saved-moments manager-list">{derivatives.map((derivative) => <article className="excerpt-row" key={derivative.id}><div><strong>{derivative.review_state === "approved" ? "Goedgekeurde afgeleide" : "Wacht op goedkeuring"}</strong><span>{derivative.content_type} · {bytesLabel(derivative.byte_size)}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => void openProtectedFile(session!, derivative.file_url, "De geredigeerde kopie kon niet worden geopend.").catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De geredigeerde kopie kon niet worden geopend."))}>Bekijken</button>{derivative.review_state === "pending" && <button className="compact" type="button" onClick={() => void approveDerivative(derivative).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De afgeleide kon niet worden goedgekeurd."))}>Expliciet goedkeuren</button>}</div></article>)}</div>}</div>}
  </section>;
}
