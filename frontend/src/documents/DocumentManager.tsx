import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { useState } from "react";

import type { ErrorFallback } from "@/lib/api/api";
import { useLocale } from "@/i18n/locale";
import { m } from "../paraglide/messages.js";
import { errorNotice, useFeedback, textNotice, FeedbackError } from "@/lib/api/feedback";
import {
  AsyncSearchSelect,
  RecordForm,
  requiredText,
  SearchSelect,
  SelectField,
  TextField,
} from "@/components/forms/fields";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "@/hooks/useRecordDialog";
import { useRecordForm } from "@/hooks/useRecordForm";
import { useOfflineCopies } from "@/hooks/useOfflineCopies";
import type { OfflineResourceKind } from "@/lib/offline-store";
import { errorMessage, openOwnerFile, ownerFile } from "@/lib/api/api";
import { ownerKeys } from "@/lib/query/keys";
import {
  documentsPath,
  useDocuments,
  useOwner,
  useOwnerMutation,
  useTripResource,
  useTripSearch,
  useTripsQuery,
} from "@/lib/query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "@/components/RecordDialog";
import { bytesLabel } from "@/lib/files";
import type { DocumentAsset, Trip } from "../api-types";

type Values = { title: string; kind: DocumentAsset["document_kind"]; tripId: string };

/** The offline copies of a document: new ones are `document`, older ones were kept per former home. */
const COPY_KINDS: readonly OfflineResourceKind[] = [
  "document",
  "trip_document",
  "library_document",
];

/** Show every document, or those filed under one trip, or those filed under none. */
const ALL = "all";
const UNFILED = "unfiled";

/**
 * The owner's documents. Filed under a trip a document can be attached to that trip's stays and routes;
 * unfiled it is a reusable essential. With `trip` the manager shows that trip's documents and files uploads
 * under it; without, it shows every document with a trip filter and lets the owner file or unfile each one.
 */
export function DocumentManager({
  trip,
  focusId,
}: {
  trip?: Trip;
  focusId?: DialogFocusRequest | null;
}) {
  useLocale();
  const owner = useOwner();
  const offline = useOfflineCopies();
  const tripDocuments = useTripResource(trip?.id ?? null, "documents");
  const allDocuments = useDocuments(!trip);
  const documentsQuery = trip ? tripDocuments : allDocuments;
  const tripsQuery = useTripsQuery();
  const searchTrips = useTripSearch();
  const trips = tripsQuery.data ?? [];
  const [filter, setFilter] = useState(ALL);
  const all = documentsQuery.data ?? [];
  const documents = trip
    ? all
    : all.filter((document) =>
        filter === ALL
          ? true
          : filter === UNFILED
            ? !document.trip_id
            : document.trip_id === filter,
      );
  const dialog = useRecordDialog(all);
  useDialogFocus(focusId, dialog.inspect);
  const { selected, editing, editingId } = dialog;
  const [notice, setNotice] = useFeedback<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // Remounts the file input so a finished upload clears the chosen file.
  const [fileKey, setFileKey] = useState(0);
  const blank = (): Values => ({ title: "", kind: trip ? "booking" : "other", tripId: "" });

  // A document written here can move between trips or take stays and routes with it, so refresh them all.
  const refresh = (subject: string) => [ownerKeys.documents(subject), ownerKeys.anyTrip(subject)];

  const upload = useOwnerMutation<FormData, DocumentAsset>({
    fallback: m.library_the_document_could_not_be_uploaded,
    request: (body) => ({ path: `${documentsPath()}/uploads`, method: "POST", body }),
    invalidate: refresh,
  });
  const update = useOwnerMutation<{ id: string; payload: Record<string, unknown> }, DocumentAsset>({
    fallback: m.documents_the_document_could_not_be_saved,
    request: ({ id, payload }) => ({
      path: `${documentsPath()}/${id}`,
      method: "PATCH",
      body: payload,
    }),
    invalidate: refresh,
  });
  const remove = useOwnerMutation<DocumentAsset>({
    fallback: m.library_the_document_could_not_be_deleted,
    request: (document) => ({ path: `${documentsPath()}/${document.id}`, method: "DELETE" }),
    // Routes and stays drop links to a deleted document on the server.
    invalidate: refresh,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: m.library_the_document_could_not_be_uploaded,
    serverFields: { title: "title", document_kind: "kind", trip_id: "tripId" },
    submit: async (values) => {
      const filedUnder = trip ? trip.id : values.tripId;
      if (editingId) {
        await update.mutateAsync({
          id: editingId,
          payload: {
            title: values.title.trim(),
            document_kind: values.kind,
            ...(trip ? {} : { trip_id: filedUnder || null }),
          },
        });
        return;
      }
      if (!file) throw new FeedbackError(() => m.library_choose_a_file_to_upload());
      const body = new FormData();
      body.set("title", values.title.trim());
      body.set("document_kind", values.kind);
      body.set("file", file);
      if (filedUnder) body.set("trip_id", filedUnder);
      await upload.mutateAsync(body);
    },
    onSuccess: () => {
      const saved = editingId !== null && editingId !== undefined;
      close();
      setNotice(
        textNotice(() =>
          saved ? m.documents_document_saved() : m.library_private_document_uploaded(),
        ),
      );
    },
  });

  const fail = (fallback: ErrorFallback) => (error: unknown) =>
    setNotice(errorNotice(error, fallback));
  const failInDialog = (fallback: ErrorFallback) => (error: unknown) => {
    dialog.setConfirmDelete(false);
    dialog.setError(errorNotice(error, fallback));
  };
  const tripTitle = (tripId: string) =>
    trips.find((candidate) => candidate.id === tripId)?.title ?? m.library_deleted_trip();

  function close() {
    dialog.close();
    setFile(null);
    setFileKey((current) => current + 1);
    record.load(blank());
  }
  function create() {
    close();
    // Under a trip filter a new document starts there.
    record.load({ ...blank(), tripId: filter !== ALL && filter !== UNFILED ? filter : "" });
    dialog.create();
  }
  function edit(document: DocumentAsset) {
    record.load({
      title: document.title,
      kind: document.document_kind,
      tripId: document.trip_id ?? "",
    });
    dialog.edit(document.id);
  }

  function erase(document: DocumentAsset) {
    remove.mutateAsync(document).then(async () => {
      for (const kind of COPY_KINDS) await offline.removeByResource(kind, document.id);
      close();
      setNotice(textNotice(() => m.library_private_document_deleted()));
    }, failInDialog(m.library_the_document_could_not_be_deleted));
  }

  const pinned = (document: DocumentAsset) =>
    COPY_KINDS.some((kind) => offline.isPinned(kind, document.id));

  async function togglePin(document: DocumentAsset) {
    if (!owner) return;
    if (pinned(document)) {
      for (const kind of COPY_KINDS) await offline.removeByResource(kind, document.id);
      setNotice(
        textNotice(() => m.common_is_no_longer_available_offline({ title: document.title })),
      );
      return;
    }
    const blob = await ownerFile(
      owner.session,
      document.file_url,
      m.offline_the_document_could_not_be_retrieved_for_offline_use,
    );
    await offline.pin({
      resourceKind: "document",
      contentMetadata: document,
      resourceId: document.id,
      metadataUrl: `${documentsPath()}/${document.id}`,
      title: document.title,
      contentType: blob.type || document.content_type,
      bytes: await blob.arrayBuffer(),
    });
    setNotice(
      textNotice(() => m.common_is_saved_offline_on_this_device({ title: document.title })),
    );
  }

  function open(url: string, fallback: ErrorFallback) {
    if (owner) openOwnerFile(owner.session, url, fallback).catch(fail(fallback));
  }

  const summary = (document: DocumentAsset) =>
    `${document.original_filename ?? m.common_unnamed_file()} · ${bytesLabel(document.byte_size)}${
      !trip && document.trip_id ? ` · ${tripTitle(document.trip_id)}` : ""
    }`;

  const readError = documentsQuery.error ?? (trip ? null : tripsQuery.error);
  const loading = notice == null && documentsQuery.isPending && !readError;
  const message =
    notice ??
    (readError
      ? errorMessage(readError, m.library_your_documents_could_not_be_loaded)
      : documentsQuery.isPending
        ? m.library_loading_your_private_documents()
        : trip && documents.length
          ? m.library_originals_private_hint()
          : trip
            ? m.library_upload_a_private_document_when_you_want_to_keep_it()
            : m.library_privacy_hint());

  const tripOptions = (candidates: readonly { id: string; title: string }[]) => [
    { value: "", label: m.documents_no_trip() },
    ...candidates.map((candidate) => ({ value: candidate.id, label: candidate.title })),
  ];

  return (
    <section className="travel-card manager" aria-labelledby="documents-title">
      <div className="capture-heading">
        <div>
          <h3 id="documents-title">{m.library_documents()}</h3>
          <p>{trip ? m.library_documents_never_shared_hint() : m.library_documents_intro()}</p>
        </div>
        <Button className="secondary compact" type="button" onClick={create}>
          {m.library_new_document()}
        </Button>
      </div>
      {!trip && (
        <Field>
          <FieldLabel>{m.documents_filter_by_trip()}</FieldLabel>
          <SearchSelect
            ariaLabel={m.documents_filter_by_trip()}
            value={filter}
            onChange={setFilter}
          >
            <option value={ALL}>{m.documents_all_documents()}</option>
            <option value={UNFILED}>{m.documents_not_filed_under_a_trip()}</option>
            {trips.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </SearchSelect>
        </Field>
      )}
      <p className="help flex items-center gap-2" role="status">
        {loading && <Spinner />}
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
                aria-label={m.library_view_document({ title: document.title })}
              >
                <strong>{document.title}</strong>
                <span>{summary(document)}</span>
              </Button>
              <div className="button-row">
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() =>
                    open(document.file_url, m.library_the_private_original_could_not_be_opened)
                  }
                >
                  {m.library_view_original()}
                </Button>
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() =>
                    void togglePin(document).catch(fail(m.offline_saving_offline_failed))
                  }
                >
                  {pinned(document) ? m.common_remove_offline_copy() : m.common_save_offline()}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!documents.length && !documentsQuery.isPending && !trip && (
        <p>{m.library_documents_empty()}</p>
      )}
      <RecordDialog
        open={editing || selected !== null}
        title={
          editing
            ? editingId
              ? m.documents_edit_document()
              : m.library_upload_document()
            : m.library_document()
        }
        dirty={editing && (record.dirty || file !== null)}
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
              <Button className="secondary" type="button" onClick={() => edit(selected)}>
                {m.common_edit()}
              </Button>
              <Button
                className="danger"
                type="button"
                onClick={() => dialog.setConfirmDelete(true)}
              >
                {m.common_delete()}
              </Button>
            </div>
            {dialog.confirmDelete && (
              <DeleteConfirmation
                title={m.library_delete_document({ title: selected.title })}
                onCancel={() => dialog.setConfirmDelete(false)}
                onConfirm={() => erase(selected)}
              />
            )}
          </div>
        )}
        {editing && (
          <RecordForm
            record={record}
            submitLabel={editingId ? m.common_save() : m.library_upload_document()}
            pendingLabel={editingId ? m.common_saving() : m.library_uploading()}
          >
            <div className="field-row">
              <record.form.Field
                name="title"
                validators={{
                  onChange: requiredText(m.library_give_the_document_a_title),
                  onSubmit: requiredText(m.library_give_the_document_a_title),
                }}
              >
                {(field) => (
                  <TextField field={field} label={m.common_title()} required maxLength={160} />
                )}
              </record.form.Field>
              <record.form.Field name="kind">
                {(field) => (
                  <SelectField field={field} label={m.library_kind()}>
                    <option value="booking">{m.library_booking()}</option>
                    <option value="itinerary">{m.library_itinerary()}</option>
                    <option value="receipt">{m.library_receipt()}</option>
                    <option value="other">{m.common_other()}</option>
                  </SelectField>
                )}
              </record.form.Field>
            </div>
            {!trip && (
              <record.form.Field name="tripId">
                {(field) => (
                  <Field>
                    <FieldLabel>
                      {m.documents_trip()}{" "}
                      <span className="font-medium text-travel-optional">
                        {m.common_optional()}
                      </span>
                    </FieldLabel>
                    <AsyncSearchSelect
                      ariaLabel={m.documents_trip_optional()}
                      value={field.state.value}
                      selectedOption={
                        field.state.value
                          ? { value: field.state.value, label: tripTitle(field.state.value) }
                          : null
                      }
                      defaultOptions={tripOptions(trips.slice(0, 50))}
                      onChange={field.handleChange}
                      loadOptions={async (q) => tripOptions(await searchTrips(q))}
                    />
                  </Field>
                )}
              </record.form.Field>
            )}
            {!editingId && (
              <Field>
                <FieldLabel>
                  {m.library_private_file()}
                  <Input
                    key={fileKey}
                    required
                    type="file"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                </FieldLabel>
              </Field>
            )}
          </RecordForm>
        )}
      </RecordDialog>
    </section>
  );
}
