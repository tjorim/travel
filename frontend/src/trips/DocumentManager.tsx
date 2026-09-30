import { Input } from "@base-ui/react/input";
import { Button } from "@base-ui/react/button";
import { useState } from "react";

import { RecordForm, requiredText, SelectField, TextField } from "../forms/fields";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage, openOwnerFile, ownerFile } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwner, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { bytesLabel, type DocumentAsset, type Trip } from "../tracker-model";
import { Field, FieldLabel } from "../ui/field";

export const DOCUMENT_KIND_LABELS: Record<DocumentAsset["document_kind"], string> = {
  booking: "Boeking",
  itinerary: "Routeplan",
  receipt: "Bon",
  other: "Anders",
};

type UploadValues = { title: string; kind: DocumentAsset["document_kind"] };
const blankUpload = (): UploadValues => ({ title: "", kind: "booking" });

export function DocumentManager({ trip, focusId }: { trip: Trip; focusId?: DialogFocusRequest | null }) {
  const owner = useOwner();
  const offline = useOfflineCopies();
  const documentsQuery = useTripResource(trip.id, "documents");
  const documents = documentsQuery.data ?? [];
  const dialog = useRecordDialog(documents);
  useDialogFocus(focusId, dialog.inspect);
  const { selected, editing } = dialog;
  const [notice, setNotice] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
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
    // A route drops the link to a deleted document on the server.
    invalidate: (subject) => [
      ownerKeys.tripResource(subject, trip.id, "documents"),
      ownerKeys.tripResource(subject, trip.id, "routes"),
    ],
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
      await upload.mutateAsync(body);
    },
    onSuccess: () => {
      close();
      setNotice("Privédocument geüpload.");
    },
  });

  const fail = (fallback: string) => (error: unknown) => setNotice(errorMessage(error, fallback));
  const failInDialog = (fallback: string) => (error: unknown) => {
    dialog.setConfirmDelete(false);
    dialog.setError(errorMessage(error, fallback));
  };

  function close() {
    dialog.close();
    setFile(null);
    setInputKey((current) => current + 1);
    uploadRecord.load(blankUpload());
  }
  function create() {
    close();
    dialog.create();
  }

  function erase(document: DocumentAsset) {
    remove.mutateAsync(document).then(async () => {
      await offline.removeByResource("trip_document", document.id);
      close();
      setNotice("Privédocument verwijderd.");
    }, failInDialog("Het document kon niet worden verwijderd."));
  }

  async function togglePin(document: DocumentAsset) {
    if (!owner) return;
    if (offline.isPinned("trip_document", document.id)) {
      await offline.removeByResource("trip_document", document.id);
      setNotice(`“${document.title}” is niet langer offline beschikbaar.`);
      return;
    }
    const blob = await ownerFile(
      owner.session,
      document.file_url,
      "Het document kon niet worden opgehaald voor offline gebruik.",
    );
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

  const readError = documentsQuery.error;
  const message =
    notice ??
    (readError
      ? errorMessage(readError, "Je documenten konden niet worden geladen.")
      : documentsQuery.isPending
        ? "Laad je private documenten…"
        : documents.length
          ? "Documenten en originelen blijven uitsluitend in je private tracker."
          : "Upload een privédocument wanneer je het wilt bewaren.");

  return (
    <section className="travel-card manager" aria-labelledby="documents-title">
      <div className="capture-heading">
        <div>
          <h3 id="documents-title">Documenten</h3>
          <p>Documenten blijven altijd privé en worden nooit met bezoekers gedeeld.</p>
        </div>
        <Button className="secondary compact" type="button" onClick={create}>
          Nieuw document
        </Button>
      </div>
      <p className="help" role="status">
        {message}
      </p>
      {documents.length > 0 && (
        <div className="saved-records mt-0.5">
          {documents.map((document) => (
            <article className="excerpt-row" data-stacked="" key={document.id}>
              <Button
                className="document-select"
                type="button"
                onClick={() => dialog.inspect(document.id)}
                aria-label={`Document ${document.title} bekijken`}
              >
                <strong>{document.title}</strong>
                <span>
                  {document.original_filename ?? "Naamloos bestand"} · {bytesLabel(document.byte_size)}
                </span>
              </Button>
              <div className="button-row">
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() => open(document.file_url, "Het private origineel kon niet worden geopend.")}
                >
                  Origineel bekijken
                </Button>
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() => void togglePin(document).catch(fail("Offline bewaren is mislukt."))}
                >
                  {offline.isPinned("trip_document", document.id) ? "Offline verwijderen" : "Offline bewaren"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <RecordDialog
        open={editing || selected !== null}
        title={editing ? "Document uploaden" : "Document"}
        dirty={editing && uploadRecord.dirty}
        error={dialog.error}
        onDismiss={close}
      >
        {!editing && selected && (
          <div className="stack-form">
            <div>
              <h3>{selected.title}</h3>
              <p>
                {selected.original_filename ?? "Naamloos bestand"} · {bytesLabel(selected.byte_size)}
              </p>
            </div>
            <div className="button-row">
              <Button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>
                Verwijderen
              </Button>
            </div>
            {dialog.confirmDelete && (
              <DeleteConfirmation
                title={`Document “${selected.title}” verwijderen?`}
                onCancel={() => dialog.setConfirmDelete(false)}
                onConfirm={() => erase(selected)}
              />
            )}
          </div>
        )}
        {editing && (
          <RecordForm record={uploadRecord} submitLabel="Document uploaden" pendingLabel="Uploaden…">
            <div className="field-row">
              <uploadRecord.form.Field
                name="title"
                validators={{
                  onChange: requiredText("Geef het document een titel."),
                  onSubmit: requiredText("Geef het document een titel."),
                }}
              >
                {(field) => <TextField field={field} label="Titel" required maxLength={160} />}
              </uploadRecord.form.Field>
              <uploadRecord.form.Field name="kind">
                {(field) => (
                  <SelectField field={field} label="Soort">
                    <option value="booking">Boeking</option>
                    <option value="itinerary">Routeplan</option>
                    <option value="receipt">Bon</option>
                    <option value="other">Anders</option>
                  </SelectField>
                )}
              </uploadRecord.form.Field>
            </div>
            <Field>
              <FieldLabel>
                Privébestand
                <Input
                  key={inputKey}
                  required
                  type="file"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </FieldLabel>
            </Field>
          </RecordForm>
        )}
      </RecordDialog>
    </section>
  );
}
