import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { apiError, apiHeaders, bytesLabel, fetchProtectedFile, openProtectedFile, type OwnerDocument, type Trip } from "../tracker-model";
import { useOfflineCopies } from "../offline/useOfflineCopies";

export function DocumentLibraryManager() {
  const { session } = useAuth();
  const offline = useOfflineCopies();
  const [documents, setDocuments] = useState<OwnerDocument[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [message, setMessage] = useState("Laad je bibliotheek…");
  const [upload, setUpload] = useState({ title: "", kind: "other" as OwnerDocument["document_kind"], linkedTripId: "", file: null as File | null });

  async function load() {
    if (!session) return;
    const [documentsResponse, tripsResponse] = await Promise.all([
      fetch("/api/library/documents", { headers: apiHeaders(session) }),
      fetch("/api/trips", { headers: apiHeaders(session) }),
    ]);
    if (!documentsResponse.ok) return apiError(documentsResponse, "Je bibliotheek kon niet worden geladen.");
    if (!tripsResponse.ok) return apiError(tripsResponse, "Je reizen konden niet worden geladen.");
    setDocuments(await documentsResponse.json() as OwnerDocument[]);
    setTrips(await tripsResponse.json() as Trip[]);
  }

  useEffect(() => {
    void load()
      .then(() => setMessage("Reisessentials blijven uitsluitend in je private bibliotheek, los van één specifieke reis."))
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je bibliotheek kon niet worden geladen."));
  }, [session]);

  function tripTitle(tripId: string): string {
    return trips.find((trip) => trip.id === tripId)?.title ?? "verwijderde reis";
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !upload.file) { setMessage("Kies een bestand om te uploaden."); return; }
    const data = new FormData();
    data.set("title", upload.title.trim());
    data.set("document_kind", upload.kind);
    data.set("file", upload.file);
    if (upload.linkedTripId) data.set("linked_trip_id", upload.linkedTripId);
    const response = await fetch("/api/library/documents/uploads", { method: "POST", headers: { Authorization: `Bearer ${session.accessToken}` }, body: data });
    if (!response.ok) return apiError(response, "Het document kon niet worden geüpload.");
    setUpload({ title: "", kind: "other", linkedTripId: "", file: null });
    await load();
    setMessage("Document toegevoegd aan je bibliotheek.");
  }

  async function deleteDocument(document: OwnerDocument) {
    if (!session || !window.confirm(`Verwijder document “${document.title}”?`)) return;
    const response = await fetch(`/api/library/documents/${document.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Het document kon niet worden verwijderd.");
    await offline.removeByResource("library_document", document.id);
    await load();
    setMessage("Document verwijderd.");
  }

  async function togglePin(document: OwnerDocument) {
    if (!session) return;
    if (offline.isPinned("library_document", document.id)) {
      await offline.removeByResource("library_document", document.id);
      setMessage(`“${document.title}” is niet langer offline beschikbaar.`);
      return;
    }
    const blob = await fetchProtectedFile(session, document.file_url, "Het document kon niet worden opgehaald voor offline gebruik.");
    await offline.pin({
      resourceKind: "library_document",
      resourceId: document.id,
      metadataUrl: `/api/library/documents/${document.id}`,
      title: document.title,
      contentType: blob.type || document.content_type,
      bytes: await blob.arrayBuffer(),
    });
    setMessage(`“${document.title}” is offline bewaard op dit toestel.`);
  }

  return <section className="card manager" aria-labelledby="library-documents-title">
    <div className="capture-heading"><div><h3 id="library-documents-title">Documenten</h3><p>Herbruikbare essentials zoals een verzekeringspolis of identiteitskopie, los van één specifieke reis.</p></div></div>
    <p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={(event) => void uploadDocument(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het document kon niet worden geüpload."))}>
      <div className="field-row">
        <label>Titel<input required maxLength={160} value={upload.title} onChange={(event) => setUpload((draft) => ({ ...draft, title: event.target.value }))} /></label>
        <label>Soort<select value={upload.kind} onChange={(event) => setUpload((draft) => ({ ...draft, kind: event.target.value as OwnerDocument["document_kind"] }))}><option value="booking">Boeking</option><option value="itinerary">Routeplan</option><option value="receipt">Bon</option><option value="other">Anders</option></select></label>
      </div>
      <label>Gekoppelde reis <span className="optional">(optioneel)</span><select value={upload.linkedTripId} onChange={(event) => setUpload((draft) => ({ ...draft, linkedTripId: event.target.value }))}><option value="">Geen koppeling</option>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}</select></label>
      <label>Privébestand<input required type="file" onChange={(event) => setUpload((draft) => ({ ...draft, file: event.target.files?.[0] ?? null }))} /></label>
      <button type="submit">Document uploaden</button>
    </form>
    {documents.length > 0 && <div className="saved-moments manager-list">{documents.map((document) => <article className="excerpt-row" key={document.id}>
      <div><strong>{document.title}</strong><span>{document.original_filename ?? "Naamloos bestand"} · {bytesLabel(document.byte_size)}{document.linked_trip_id ? ` · ${tripTitle(document.linked_trip_id)}` : ""}</span></div>
      <div className="button-row">
        <button className="secondary compact" type="button" onClick={() => void openProtectedFile(session!, document.file_url, "Het private origineel kon niet worden geopend.").catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het private origineel kon niet worden geopend."))}>Bekijken</button>
        <button className="secondary compact" type="button" onClick={() => void togglePin(document).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Offline bewaren is mislukt."))}>{offline.isPinned("library_document", document.id) ? "Offline verwijderen" : "Offline bewaren"}</button>
        <button className="danger compact" type="button" onClick={() => void deleteDocument(document).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het document kon niet worden verwijderd."))}>Verwijderen</button>
      </div>
    </article>)}</div>}
    {!documents.length && <p>Nog geen documenten. Upload een privébestand wanneer je het wilt bewaren.</p>}
  </section>;
}
