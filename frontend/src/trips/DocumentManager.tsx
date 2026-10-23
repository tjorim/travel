import type { ErrorFallback } from "../query/api";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorNotice, useFeedback, textNotice, FeedbackError } from "../query/feedback";
import { Input } from "@/ui/input";
import { Button } from "@/ui/button";
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
import { Field, FieldLabel } from "@/ui/field";

type UploadValues = { title: string; kind: DocumentAsset["document_kind"] };
const blankUpload = (): UploadValues => ({ title: "", kind: "booking" });

export function DocumentManager({
  trip,
  focusId,
}: {
  trip: Trip;
  focusId?: DialogFocusRequest | null;
}) {
  useLocale();
  const owner = useOwner();
  const offline = useOfflineCopies();
  const documentsQuery = useTripResource(trip.id, "documents");
  const documents = documentsQuery.data ?? [];
  const dialog = useRecordDialog(documents);
  useDialogFocus(focusId, dialog.inspect);
  const { selected, editing } = dialog;
  const [notice, setNotice] = useFeedback<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // Remount the file inputs after a finished upload so the chosen files clear.
  const [inputKey, setInputKey] = useState(0);

  const upload = useOwnerMutation<FormData, DocumentAsset>({
    fallback: m.assets_the_document_could_not_be_uploaded,
    request: (body) => ({
      path: `${tripPath(trip.id, "documents")}/uploads`,
      method: "POST",
      body,
    }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "documents")],
  });
  const remove = useOwnerMutation<DocumentAsset>({
    fallback: m.assets_the_document_could_not_be_deleted,
    request: (document) => ({
      path: `${tripPath(trip.id, "documents")}/${document.id}`,
      method: "DELETE",
    }),
    // A route drops the link to a deleted document on the server.
    invalidate: (subject) => [
      ownerKeys.tripResource(subject, trip.id, "documents"),
      ownerKeys.tripResource(subject, trip.id, "routes"),
    ],
  });
  const uploadRecord = useRecordForm<UploadValues>({
    defaultValues: blankUpload(),
    fallback: m.assets_the_document_could_not_be_uploaded,
    serverFields: { title: "title", document_kind: "kind" },
    submit: async (values) => {
      if (!file) throw new FeedbackError(() => m.assets_choose_a_file_to_upload());
      const body = new FormData();
      body.set("title", values.title.trim());
      body.set("document_kind", values.kind);
      body.set("file", file);
      await upload.mutateAsync(body);
    },
    onSuccess: () => {
      close();
      setNotice(textNotice(() => m.assets_private_document_uploaded()));
    },
  });

  const fail = (fallback: ErrorFallback) => (error: unknown) =>
    setNotice(errorNotice(error, fallback));
  const failInDialog = (fallback: ErrorFallback) => (error: unknown) => {
    dialog.setConfirmDelete(false);
    dialog.setError(errorNotice(error, fallback));
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
      setNotice(textNotice(() => m.assets_private_document_deleted()));
    }, failInDialog(m.assets_the_document_could_not_be_deleted));
  }

  async function togglePin(document: DocumentAsset) {
    if (!owner) return;
    if (offline.isPinned("trip_document", document.id)) {
      await offline.removeByResource("trip_document", document.id);
      setNotice(textNotice(() => m.owner_is_no_longer_available_offline({ p0: document.title })));
      return;
    }
    const blob = await ownerFile(
      owner.session,
      document.file_url,
      m.assets_the_document_could_not_be_retrieved_for_offline_use,
    );
    await offline.pin({
      resourceKind: "trip_document",
      resourceId: document.id,
      metadataUrl: `/api/trips/${trip.id}/documents/${document.id}`,
      title: document.title,
      contentType: blob.type || document.content_type,
      bytes: await blob.arrayBuffer(),
    });
    setNotice(textNotice(() => m.owner_is_saved_offline_on_this_device({ p0: document.title })));
  }

  function open(url: string, fallback: ErrorFallback) {
    if (owner) openOwnerFile(owner.session, url, fallback).catch(fail(fallback));
  }

  const readError = documentsQuery.error;
  const message =
    notice ??
    (readError
      ? errorMessage(readError, m.assets_your_documents_could_not_be_loaded)
      : documentsQuery.isPending
        ? m.assets_loading_your_private_documents()
        : documents.length
          ? m.assets_documents_and_originals_stay_in_your_private_tracker()
          : m.assets_upload_a_private_document_when_you_want_to_keep_it());

  return (
    <section className="travel-card manager" aria-labelledby="documents-title">
      <div className="capture-heading">
        <div>
          <h3 id="documents-title">{m.assets_documents()}</h3>
          <p>{m.assets_documents_always_stay_private_and_are_never_shared_with_visitors()}</p>
        </div>
        <Button className="secondary compact" type="button" onClick={create}>
          {m.assets_new_document()}
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
                aria-label={m.assets_view_document({ p0: document.title })}
              >
                <strong>{document.title}</strong>
                <span>
                  {document.original_filename ?? m.owner_unnamed_file()} ·{" "}
                  {bytesLabel(document.byte_size)}
                </span>
              </Button>
              <div className="button-row">
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() =>
                    open(document.file_url, m.assets_the_private_original_could_not_be_opened)
                  }
                >
                  {m.assets_view_original()}
                </Button>
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() =>
                    void togglePin(document).catch(fail(m.assets_saving_offline_failed))
                  }
                >
                  {offline.isPinned("trip_document", document.id)
                    ? m.owner_remove_offline_copy()
                    : m.owner_save_offline()}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <RecordDialog
        open={editing || selected !== null}
        title={editing ? m.assets_upload_document() : m.assets_document()}
        dirty={editing && uploadRecord.dirty}
        error={dialog.error}
        onDismiss={close}
      >
        {!editing && selected && (
          <div className="stack-form">
            <div>
              <h3>{selected.title}</h3>
              <p>
                {selected.original_filename ?? m.owner_unnamed_file()} ·{" "}
                {bytesLabel(selected.byte_size)}
              </p>
            </div>
            <div className="button-row">
              <Button
                className="danger"
                type="button"
                onClick={() => dialog.setConfirmDelete(true)}
              >
                {m.owner_delete()}
              </Button>
            </div>
            {dialog.confirmDelete && (
              <DeleteConfirmation
                title={m.assets_delete_document({ p0: selected.title })}
                onCancel={() => dialog.setConfirmDelete(false)}
                onConfirm={() => erase(selected)}
              />
            )}
          </div>
        )}
        {editing && (
          <RecordForm
            record={uploadRecord}
            submitLabel={m.assets_upload_document()}
            pendingLabel={m.assets_uploading()}
          >
            <div className="field-row">
              <uploadRecord.form.Field
                name="title"
                validators={{
                  onChange: requiredText(m.assets_give_the_document_a_title),
                  onSubmit: requiredText(m.assets_give_the_document_a_title),
                }}
              >
                {(field) => (
                  <TextField field={field} label={m.owner_title()} required maxLength={160} />
                )}
              </uploadRecord.form.Field>
              <uploadRecord.form.Field name="kind">
                {(field) => (
                  <SelectField field={field} label={m.assets_kind()}>
                    <option value="booking">{m.assets_booking()}</option>
                    <option value="itinerary">{m.assets_itinerary()}</option>
                    <option value="receipt">{m.assets_receipt()}</option>
                    <option value="other">{m.owner_other()}</option>
                  </SelectField>
                )}
              </uploadRecord.form.Field>
            </div>
            <Field>
              <FieldLabel>
                {m.assets_private_file()}
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
