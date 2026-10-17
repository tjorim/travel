import type { ErrorFallback } from "../query/api";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorNotice, useFeedback, textNotice, FeedbackError } from "../query/feedback";
import { Input } from "@base-ui/react/input";
import { Button } from "@base-ui/react/button";
import { useState } from "react";

import {
  AsyncSearchSelect,
  RecordForm,
  requiredText,
  SelectField,
  TextField,
} from "../forms/fields";
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
import { Field, FieldLabel } from "../ui/field";

type Values = { title: string; kind: OwnerDocument["document_kind"]; linkedTripId: string };
const blank = (): Values => ({ title: "", kind: "other", linkedTripId: "" });

export function DocumentLibraryManager() {
  useLocale();
  const owner = useOwner();
  const offline = useOfflineCopies();
  const documentsQuery = useLibrary("documents");
  const tripsQuery = useTripsQuery();
  const searchTrips = useTripSearch();
  const documents = documentsQuery.data ?? [];
  const trips = tripsQuery.data ?? [];
  const dialog = useRecordDialog(documents);
  const { selected, editing } = dialog;
  const [notice, setNotice] = useFeedback<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // Remounts the file input so a finished upload clears the chosen file.
  const [fileKey, setFileKey] = useState(0);
  // Linked-trip lists nest under the library documents key, so one refresh covers both.
  const refresh = (subject: string) => [ownerKeys.library(subject, "documents")];

  const upload = useOwnerMutation<FormData, OwnerDocument>({
    fallback: m.assets_the_document_could_not_be_uploaded,
    request: (body) => ({ path: `${libraryPath("documents")}/uploads`, method: "POST", body }),
    invalidate: refresh,
  });
  const remove = useOwnerMutation<OwnerDocument>({
    fallback: m.assets_the_document_could_not_be_deleted,
    request: (document) => ({
      path: `${libraryPath("documents")}/${document.id}`,
      method: "DELETE",
    }),
    invalidate: refresh,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: m.assets_the_document_could_not_be_uploaded,
    serverFields: { title: "title", document_kind: "kind", linked_trip_id: "linkedTripId" },
    submit: async (values) => {
      if (!file) throw new FeedbackError(() => m.assets_choose_a_file_to_upload());
      const data = new FormData();
      data.set("title", values.title.trim());
      data.set("document_kind", values.kind);
      data.set("file", file);
      if (values.linkedTripId) data.set("linked_trip_id", values.linkedTripId);
      await upload.mutateAsync(data);
    },
    onSuccess: () => {
      close();
      setNotice(textNotice(() => m.assets_document_added_to_your_library()));
    },
  });

  const fail = (fallback: ErrorFallback) => (error: unknown) =>
    setNotice(errorNotice(error, fallback));
  const failInDialog = (fallback: ErrorFallback) => (error: unknown) => {
    dialog.setConfirmDelete(false);
    dialog.setError(errorNotice(error, fallback));
  };
  const tripTitle = (tripId: string) =>
    trips.find((trip) => trip.id === tripId)?.title ?? m.assets_deleted_trip();

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
      setNotice(textNotice(() => m.assets_document_deleted()));
    }, failInDialog(m.assets_the_document_could_not_be_deleted));
  }

  async function togglePin(document: OwnerDocument) {
    if (!owner) return;
    if (offline.isPinned("library_document", document.id)) {
      await offline.removeByResource("library_document", document.id);
      setNotice(textNotice(() => m.owner_is_no_longer_available_offline({ p0: document.title })));
      return;
    }
    const blob = await ownerFile(
      owner.session,
      document.file_url,
      m.assets_the_document_could_not_be_retrieved_for_offline_use,
    );
    await offline.pin({
      resourceKind: "library_document",
      resourceId: document.id,
      metadataUrl: `${libraryPath("documents")}/${document.id}`,
      title: document.title,
      contentType: blob.type || document.content_type,
      bytes: await blob.arrayBuffer(),
    });
    setNotice(textNotice(() => m.owner_is_saved_offline_on_this_device({ p0: document.title })));
  }

  const readError = documentsQuery.error ?? tripsQuery.error;
  const message =
    notice ??
    (readError
      ? errorMessage(readError, m.assets_your_library_could_not_be_loaded)
      : documentsQuery.isPending
        ? m.assets_loading_your_library()
        : m.assets_travel_essentials_stay_in_your_private_library_separate_from_any_specifi());

  const summary = (document: OwnerDocument) =>
    `${document.original_filename ?? m.owner_unnamed_file()} · ${bytesLabel(document.byte_size)}${document.linked_trip_id ? ` · ${tripTitle(document.linked_trip_id)}` : ""}`;

  return (
    <section className="travel-card manager" aria-labelledby="library-documents-title">
      <div className="capture-heading">
        <div>
          <h3 id="library-documents-title">{m.assets_documents()}</h3>
          <p>
            {m.assets_reusable_essentials_such_as_an_insurance_policy_or_identity_copy_separat()}
          </p>
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
                        m.assets_the_private_original_could_not_be_opened,
                      ).catch(fail(m.assets_the_private_original_could_not_be_opened));
                  }}
                >
                  {m.assets_view()}
                </Button>
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() =>
                    void togglePin(document).catch(fail(m.assets_saving_offline_failed))
                  }
                >
                  {offline.isPinned("library_document", document.id)
                    ? m.owner_remove_offline_copy()
                    : m.owner_save_offline()}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!documents.length && !documentsQuery.isPending && (
        <p>{m.assets_no_documents_yet_upload_a_private_file_when_you_want_to_keep_it()}</p>
      )}
      <RecordDialog
        open={editing || selected !== null}
        title={editing ? m.assets_upload_document() : m.assets_document()}
        dirty={editing && record.dirty}
        error={dialog.error}
        onDismiss={close}
      >
        {!editing && selected && (
          <div className="stack-form">
            <div>
              <h3>{selected.title}</h3>
              <p>{summary(selected)}</p>
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
            record={record}
            submitLabel={m.assets_upload_document()}
            pendingLabel={m.assets_uploading()}
          >
            <div className="field-row">
              <record.form.Field
                name="title"
                validators={{
                  onChange: requiredText(m.assets_give_the_document_a_title),
                  onSubmit: requiredText(m.assets_give_the_document_a_title),
                }}
              >
                {(field) => (
                  <TextField field={field} label={m.owner_title()} required maxLength={160} />
                )}
              </record.form.Field>
              <record.form.Field name="kind">
                {(field) => (
                  <SelectField field={field} label={m.assets_kind()}>
                    <option value="booking">{m.assets_booking()}</option>
                    <option value="itinerary">{m.assets_itinerary()}</option>
                    <option value="receipt">{m.assets_receipt()}</option>
                    <option value="other">{m.owner_other()}</option>
                  </SelectField>
                )}
              </record.form.Field>
            </div>
            <record.form.Field name="linkedTripId">
              {(field) => (
                <Field>
                  <FieldLabel>
                    {m.assets_linked_trip()}{" "}
                    <span className="font-medium text-travel-optional">{m.owner_optional()}</span>
                  </FieldLabel>
                  <AsyncSearchSelect
                    ariaLabel={m.assets_linked_trip_optional()}
                    value={field.state.value}
                    selectedOption={
                      field.state.value
                        ? { value: field.state.value, label: tripTitle(field.state.value) }
                        : null
                    }
                    defaultOptions={[
                      { value: "", label: m.assets_no_link() },
                      ...trips.slice(0, 50).map((trip) => ({ value: trip.id, label: trip.title })),
                    ]}
                    onChange={field.handleChange}
                    loadOptions={async (q) => [
                      { value: "", label: m.assets_no_link() },
                      ...(await searchTrips(q)).map((trip) => ({
                        value: trip.id,
                        label: trip.title,
                      })),
                    ]}
                  />
                </Field>
              )}
            </record.form.Field>
            <Field>
              <FieldLabel>
                {m.assets_private_file()}
                <Input
                  key={fileKey}
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
