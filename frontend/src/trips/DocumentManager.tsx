import { useState, type FormEvent } from "react";

import { RecordForm, requiredText, SelectField, TextField } from "../forms/fields";
import { useConfirmation } from "../forms/useConfirmation";
import { useRecordForm } from "../forms/useRecordForm";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage, openOwnerFile, ownerFile } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useDerivatives, useOwner, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { bytesLabel, type DocumentAsset, type DocumentDerivative, type Trip } from "../tracker-model";

type UploadValues = { title: string; kind: DocumentAsset["document_kind"] };
const blankUpload = (): UploadValues => ({ title: "", kind: "booking" });

export function DocumentManager({ trip }: { trip: Trip }) {
  const confirmation = useConfirmation();
  const owner = useOwner();
  const offline = useOfflineCopies();
  const documentsQuery = useTripResource(trip.id, "documents");
  const documents = documentsQuery.data ?? [];
  // undefined: follow the first document; null: none chosen (after a delete); a string: the chosen document.
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const selected = selectedId === undefined ? documents[0] ?? null : documents.find((document) => document.id === selectedId) ?? null;
  const derivativesQuery = useDerivatives(trip.id, "documents", selected?.id ?? null);
  const derivatives = derivativesQuery.data ?? [];
  const [notice, setNotice] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [redaction, setRedaction] = useState({ file: null as File | null, manifest: null as File | null });
  // Remount the file inputs after a finished upload so the chosen files clear.
  const [inputKey, setInputKey] = useState(0);

  const upload = useOwnerMutation<FormData, DocumentAsset>({
    fallback: "Het document kon niet worden geüpload.",
    request: (body) => ({ path: `${tripPath(trip.id, "documents")}/uploads`, method: "POST", body }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "documents")],
  });
  const remove = useOwnerMutation<DocumentAsset>({
    fallback: "Het document kon niet worden verwijderd.",
    request: (document) => ({ path: `${tripPath(trip.id, "documents")}/${document.id}`, method: "DELETE" }),
    // A leg drops the link to a deleted document on the server.
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "documents"), ownerKeys.tripResource(subject, trip.id, "transport-legs")],
  });
  const addDerivative = useOwnerMutation<{ documentId: string; body: FormData }, DocumentDerivative>({
    fallback: "De geredigeerde afgeleide kon niet worden opgeslagen.",
    request: ({ documentId, body }) => ({ path: `${tripPath(trip.id, "documents")}/${documentId}/derivatives`, method: "POST", body }),
    invalidate: (subject, { documentId }) => [ownerKeys.derivatives(subject, trip.id, "documents", documentId)],
  });
  const approve = useOwnerMutation<{ documentId: string; derivative: DocumentDerivative }, DocumentDerivative>({
    fallback: "De afgeleide kon niet worden goedgekeurd.",
    request: ({ documentId, derivative }) => ({ path: `${tripPath(trip.id, "documents")}/${documentId}/derivatives/${derivative.id}/approve`, method: "POST" }),
    invalidate: (subject, { documentId }) => [ownerKeys.derivatives(subject, trip.id, "documents", documentId)],
  });

  const uploadRecord = useRecordForm<UploadValues>({
    defaultValues: blankUpload(),
    fallback: "Het document kon niet worden geüpload.",
    serverFields: { title: "title", document_kind: "kind" },
    submit: async (values) => {
      if (!file) throw new Error("Kies een bestand om te uploaden.");
      const body = new FormData();
      body.set("title", values.title.trim());
      body.set("document_kind", values.kind);
      body.set("file", file);
      const saved = await upload.mutateAsync(body);
      setSelectedId(saved.id);
    },
    onSuccess: () => { setFile(null); setInputKey((current) => current + 1); uploadRecord.load(blankUpload()); setNotice("Privédocument geüpload."); },
  });

  const fail = (fallback: string) => (error: unknown) => setNotice(errorMessage(error, fallback));

  function erase(document: DocumentAsset) {
    confirmation.ask({ title: `Document “${document.title}” verwijderen?`, onConfirm: () => performErase(document) });
  }

  function performErase(document: DocumentAsset) {
    remove.mutateAsync(document).then(async () => {
      await offline.removeByResource("trip_document", document.id);
      setSelectedId(null);
      setNotice("Privédocument verwijderd.");
    }, fail("Het document kon niet worden verwijderd."));
  }

  async function togglePin(document: DocumentAsset) {
    if (!owner) return;
    if (offline.isPinned("trip_document", document.id)) {
      await offline.removeByResource("trip_document", document.id);
      setNotice(`“${document.title}” is niet langer offline beschikbaar.`);
      return;
    }
    const blob = await ownerFile(owner.session, document.file_url, "Het document kon niet worden opgehaald voor offline gebruik.");
    await offline.pin({
      resourceKind: "trip_document",
      resourceId: document.id,
      metadataUrl: `/api/trips/${trip.id}/documents/${document.id}`,
      title: document.title,
      contentType: blob.type || document.content_type,
      bytes: await blob.arrayBuffer(),
    });
    setNotice(`“${document.title}” is offline bewaard op dit toestel.`);
  }

  function open(url: string, fallback: string) {
    if (owner) openOwnerFile(owner.session, url, fallback).catch(fail(fallback));
  }

  function submitDerivative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !redaction.file || !redaction.manifest) { setNotice("Kies een geredigeerd bestand én een redactie-manifest."); return; }
    const body = new FormData();
    body.set("file", redaction.file);
    body.set("redaction_manifest", redaction.manifest);
    addDerivative.mutateAsync({ documentId: selected.id, body }).then(() => {
      setRedaction({ file: null, manifest: null });
      setInputKey((current) => current + 1);
      setNotice("Geredigeerde afgeleide opgeslagen en wacht op jouw expliciete goedkeuring.");
    }, fail("De geredigeerde afgeleide kon niet worden opgeslagen."));
  }

  const readError = documentsQuery.error ?? derivativesQuery.error;
  const message = notice ?? (readError ? errorMessage(readError, "Je documenten konden niet worden geladen.") : documentsQuery.isPending ? "Laad je private documenten…" : documents.length ? "Documenten en originelen blijven uitsluitend in je private tracker." : "Upload een privédocument wanneer je het wilt bewaren.");

  return <section className="card manager" aria-labelledby="documents-title"><div className="capture-heading"><div><h3 id="documents-title">Documenten</h3><p>Originelen staan alleen in je private tracker. Een mogelijke gedeelde kopie moet eerst geredigeerd én goedgekeurd zijn.</p></div></div><p className="help" role="status">{message}</p>
    <RecordForm record={uploadRecord} submitLabel="Document uploaden" pendingLabel="Uploaden…">
      <div className="field-row">
        <uploadRecord.form.Field name="title" validators={{ onChange: requiredText("Geef het document een titel."), onSubmit: requiredText("Geef het document een titel.") }}>{(field) => <TextField field={field} label="Titel" required maxLength={160} />}</uploadRecord.form.Field>
        <uploadRecord.form.Field name="kind">{(field) => <SelectField field={field} label="Soort"><option value="booking">Boeking</option><option value="itinerary">Routeplan</option><option value="receipt">Bon</option><option value="other">Anders</option></SelectField>}</uploadRecord.form.Field>
      </div>
      <div className="field"><label>Privébestand<input key={inputKey} required type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label></div>
    </RecordForm>
    {documents.length > 0 && <div className="saved-moments manager-list">{documents.map((document) => <article className={`excerpt-row ${document.id === selected?.id ? "selected-item" : ""}`} key={document.id}><button className="document-select" type="button" onClick={() => setSelectedId(document.id)}><strong>{document.title}</strong><span>{document.original_filename ?? "Naamloos bestand"} · {bytesLabel(document.byte_size)}</span></button><div className="button-row"><button className="secondary compact" type="button" onClick={() => open(document.file_url, "Het private origineel kon niet worden geopend.")}>Origineel bekijken</button><button className="secondary compact" type="button" onClick={() => void togglePin(document).catch(fail("Offline bewaren is mislukt."))}>{offline.isPinned("trip_document", document.id) ? "Offline verwijderen" : "Offline bewaren"}</button><button className="danger compact" type="button" onClick={() => erase(document)}>Verwijderen</button></div></article>)}</div>}
    {selected && <div className="manager-subsection"><div className="capture-heading"><div><h3>Geredigeerde afgeleiden</h3><p>Voor {selected.title}. Upload een nieuw geredigeerd bestand met zijn manifest; het origineel wordt nooit als afgeleide gebruikt.</p></div></div><form className="stack-form" onSubmit={submitDerivative}><label>Geredigeerd bestand<input key={`file-${inputKey}`} required type="file" onChange={(event) => setRedaction((draft) => ({ ...draft, file: event.target.files?.[0] ?? null }))} /></label><label>Redactie-manifest<input key={`manifest-${inputKey}`} required type="file" accept="application/json,.json" onChange={(event) => setRedaction((draft) => ({ ...draft, manifest: event.target.files?.[0] ?? null }))} /></label><button type="submit" disabled={addDerivative.isPending}>Geredigeerde kopie toevoegen</button></form>{derivatives.length > 0 && <div className="saved-moments manager-list">{derivatives.map((derivative) => <article className="excerpt-row" key={derivative.id}><div><strong>{derivative.review_state === "approved" ? "Goedgekeurde afgeleide" : "Wacht op goedkeuring"}</strong><span>{derivative.content_type} · {bytesLabel(derivative.byte_size)}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => open(derivative.file_url, "De geredigeerde kopie kon niet worden geopend.")}>Bekijken</button>{derivative.review_state === "pending" && <button className="compact" type="button" onClick={() => approve.mutateAsync({ documentId: selected.id, derivative }).then(() => setNotice("Afgeleide expliciet goedgekeurd. Delen gebeurt nog steeds alleen via een aparte scope."), fail("De afgeleide kon niet worden goedgekeurd."))}>Expliciet goedkeuren</button>}</div></article>)}</div>}</div>}
    {confirmation.dialog}
  </section>;
}
