import { Input } from "@base-ui/react/input";
import { Button } from "@base-ui/react/button";
import { useState } from "react";

import { AsyncSearchSelect, RecordForm, requiredText, SelectField, TextField } from "../forms/fields";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage, openOwnerFile, ownerFile } from "../query/api";
import { ownerKeys } from "../query/keys";
import {
  libraryPath,
  useLibrary,
  useOwner,
  useOwnerMutation,
  useTripSearch,
  useTripsQuery,
} from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { bytesLabel, type OwnerDocument } from "../tracker-model";

type Values = { title: string; kind: OwnerDocument["document_kind"]; linkedTripId: string };
const blank = (): Values => ({ title: "", kind: "other", linkedTripId: "" });

export function DocumentLibraryManager() {
  const owner = useOwner();
  const offline = useOfflineCopies();
  const documentsQuery = useLibrary("documents");
  const tripsQuery = useTripsQuery();
  const searchTrips = useTripSearch();
  const documents = documentsQuery.data ?? [];
  const trips = tripsQuery.data ?? [];
  const dialog = useRecordDialog(documents);
  const { selected, editing } = dialog;
  const [notice, setNotice] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // Remounts the file input so a finished upload clears the chosen file.
  const [fileKey, setFileKey] = useState(0);
  // Linked-trip lists nest under the library documents key, so one refresh covers both.
  const refresh = (subject: string) => [ownerKeys.library(subject, "documents")];

  const upload = useOwnerMutation<FormData, OwnerDocument>({
    fallback: "Het document kon niet worden geüpload.",
    request: (body) => ({ path: `${libraryPath("documents")}/uploads`, method: "POST", body }),
    invalidate: refresh,
  });
  const remove = useOwnerMutation<OwnerDocument>({
    fallback: "Het document kon niet worden verwijderd.",
    request: (document) => ({ path: `${libraryPath("documents")}/${document.id}`, method: "DELETE" }),
    invalidate: refresh,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "Het document kon niet worden geüpload.",
    serverFields: { title: "title", document_kind: "kind", linked_trip_id: "linkedTripId" },
    submit: async (values) => {
      if (!file) throw new Error("Kies een bestand om te uploaden.");
      const data = new FormData();
      data.set("title", values.title.trim());
      data.set("document_kind", values.kind);
      data.set("file", file);
      if (values.linkedTripId) data.set("linked_trip_id", values.linkedTripId);
      await upload.mutateAsync(data);
    },
    onSuccess: () => {
      close();
      setNotice("Document toegevoegd aan je bibliotheek.");
    },
  });

  const fail = (fallback: string) => (error: unknown) => setNotice(errorMessage(error, fallback));
  const tripTitle = (tripId: string) => trips.find((trip) => trip.id === tripId)?.title ?? "verwijderde reis";

  function close() {
    dialog.close();
    setFile(null);
    setFileKey((current) => current + 1);
    record.load(blank());
  }
  function create() {
    close();
    dialog.create();
  }

  function erase(document: OwnerDocument) {
    remove.mutateAsync(document).then(async () => {
      await offline.removeByResource("library_document", document.id);
      close();
      setNotice("Document verwijderd.");
    }, fail("Het document kon niet worden verwijderd."));
  }

  async function togglePin(document: OwnerDocument) {
    if (!owner) return;
    if (offline.isPinned("library_document", document.id)) {
      await offline.removeByResource("library_document", document.id);
      setNotice(`“${document.title}” is niet langer offline beschikbaar.`);
      return;
    }
    const blob = await ownerFile(
      owner.session,
      document.file_url,
      "Het document kon niet worden opgehaald voor offline gebruik.",
    );
    await offline.pin({
      resourceKind: "library_document",
      resourceId: document.id,
      metadataUrl: `${libraryPath("documents")}/${document.id}`,
      title: document.title,
      contentType: blob.type || document.content_type,
      bytes: await blob.arrayBuffer(),
    });
    setNotice(`“${document.title}” is offline bewaard op dit toestel.`);
  }

  const readError = documentsQuery.error ?? tripsQuery.error;
  const message =
    notice ??
    (readError
      ? errorMessage(readError, "Je bibliotheek kon niet worden geladen.")
      : documentsQuery.isPending
        ? "Laad je bibliotheek…"
        : "Reisessentials blijven uitsluitend in je private bibliotheek, los van één specifieke reis.");

  const summary = (document: OwnerDocument) =>
    `${document.original_filename ?? "Naamloos bestand"} · ${bytesLabel(document.byte_size)}${document.linked_trip_id ? ` · ${tripTitle(document.linked_trip_id)}` : ""}`;

  return (
    <section className="travel-card manager" aria-labelledby="library-documents-title">
      <div className="capture-heading">
        <div>
          <h3 id="library-documents-title">Documenten</h3>
          <p>Herbruikbare essentials zoals een verzekeringspolis of identiteitskopie, los van één specifieke reis.</p>
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
                <span>{summary(document)}</span>
              </Button>
              <div className="button-row">
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() => {
                    if (owner)
                      openOwnerFile(
                        owner.session,
                        document.file_url,
                        "Het private origineel kon niet worden geopend.",
                      ).catch(fail("Het private origineel kon niet worden geopend."));
                  }}
                >
                  Bekijken
                </Button>
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() => void togglePin(document).catch(fail("Offline bewaren is mislukt."))}
                >
                  {offline.isPinned("library_document", document.id) ? "Offline verwijderen" : "Offline bewaren"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!documents.length && !documentsQuery.isPending && (
        <p>Nog geen documenten. Upload een privébestand wanneer je het wilt bewaren.</p>
      )}
      <RecordDialog
        open={editing || selected !== null}
        title={editing ? "Document uploaden" : "Document"}
        dirty={editing && record.dirty}
        onDismiss={close}
      >
        {!editing && selected && (
          <div className="stack-form">
            <div>
              <h3>{selected.title}</h3>
              <p>{summary(selected)}</p>
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
          <RecordForm record={record} submitLabel="Document uploaden" pendingLabel="Uploaden…">
            <div className="field-row">
              <record.form.Field
                name="title"
                validators={{
                  onChange: requiredText("Geef het document een titel."),
                  onSubmit: requiredText("Geef het document een titel."),
                }}
              >
                {(field) => <TextField field={field} label="Titel" required maxLength={160} />}
              </record.form.Field>
              <record.form.Field name="kind">
                {(field) => (
                  <SelectField field={field} label="Soort">
                    <option value="booking">Boeking</option>
                    <option value="itinerary">Routeplan</option>
                    <option value="receipt">Bon</option>
                    <option value="other">Anders</option>
                  </SelectField>
                )}
              </record.form.Field>
            </div>
            <record.form.Field name="linkedTripId">
              {(field) => (
                <div className="field">
                  <label>
                    Gekoppelde reis <span className="font-medium text-travel-optional">(optioneel)</span>
                    <AsyncSearchSelect
                      ariaLabel="Gekoppelde reis (optioneel)"
                      value={field.state.value}
                      selectedOption={
                        field.state.value ? { value: field.state.value, label: tripTitle(field.state.value) } : null
                      }
                      defaultOptions={[
                        { value: "", label: "Geen koppeling" },
                        ...trips.slice(0, 50).map((trip) => ({ value: trip.id, label: trip.title })),
                      ]}
                      onChange={field.handleChange}
                      loadOptions={async (q) => [
                        { value: "", label: "Geen koppeling" },
                        ...(await searchTrips(q)).map((trip) => ({ value: trip.id, label: trip.title })),
                      ]}
                    />
                  </label>
                </div>
              )}
            </record.form.Field>
            <div className="field">
              <label>
                Privébestand
                <Input
                  key={fileKey}
                  required
                  type="file"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          </RecordForm>
        )}
      </RecordDialog>
    </section>
  );
}
