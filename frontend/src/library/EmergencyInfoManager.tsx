import type { ErrorFallback } from "../query/api";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorNotice, useFeedback, textNotice } from "../query/feedback";
import { Button } from "@/ui/button";

import { RecordForm, requiredText, SelectField, TextField } from "../forms/fields";
import { MarkdownField } from "../forms/MarkdownField";
import { Markdown } from "../Markdown";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { libraryPath, useLibrary, useOwnerMutation } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import type { EmergencyInfoEntry, EmergencyInfoKind } from "../tracker-model";

const KIND_LABELS: Record<EmergencyInfoKind, string> = {
  get contact() {
    return m.assets_contact_person();
  },
  get number() {
    return m.assets_phone_number();
  },
  get medical_note() {
    return m.assets_medical_note();
  },
};

type Values = { kind: EmergencyInfoKind; label: string; value: string; notes: string };
const blank = (): Values => ({ kind: "contact", label: "", value: "", notes: "" });
const fromEntry = (entry: EmergencyInfoEntry): Values => ({
  kind: entry.kind,
  label: entry.label,
  value: entry.value,
  notes: entry.notes ?? "",
});

export function EmergencyInfoManager() {
  useLocale();
  const offline = useOfflineCopies();
  const entriesQuery = useLibrary("emergency-info");
  const entries = entriesQuery.data ?? [];
  const dialog = useRecordDialog(entries);
  const { selected, editing, editingId } = dialog;
  const [notice, setNotice] = useFeedback<string | null>(null);
  const path = libraryPath("emergency-info");
  const refresh = (subject: string) => [ownerKeys.library(subject, "emergency-info")];

  const save = useOwnerMutation<
    { id: string | null; payload: Record<string, unknown> },
    EmergencyInfoEntry
  >({
    fallback: m.assets_the_emergency_information_could_not_be_saved,
    request: ({ id, payload }) => ({
      path: id ? `${path}/${id}` : path,
      method: id ? "PATCH" : "POST",
      body: payload,
    }),
    invalidate: refresh,
  });
  const remove = useOwnerMutation<EmergencyInfoEntry>({
    fallback: m.assets_the_emergency_information_could_not_be_deleted,
    request: (entry) => ({ path: `${path}/${entry.id}`, method: "DELETE" }),
    invalidate: refresh,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: m.assets_the_emergency_information_could_not_be_saved,
    serverFields: { kind: "kind", label: "label", value: "value", notes: "notes" },
    submit: async (values) => {
      await save.mutateAsync({
        id: dialog.editingId ?? null,
        payload: {
          kind: values.kind,
          label: values.label.trim(),
          value: values.value.trim(),
          notes: values.notes.trim() || null,
        },
      });
    },
    onSuccess: () => {
      close();
      setNotice(textNotice(() => m.assets_emergency_information_saved()));
    },
  });

  function close() {
    dialog.close();
    record.load(blank());
  }
  function create() {
    record.load(blank());
    dialog.create();
  }
  function edit(entry: EmergencyInfoEntry) {
    record.load(fromEntry(entry));
    dialog.edit(entry.id);
  }
  const fail = (fallback: ErrorFallback) => (error: unknown) =>
    setNotice(errorNotice(error, fallback));
  const failInDialog = (fallback: ErrorFallback) => (error: unknown) => {
    dialog.setConfirmDelete(false);
    dialog.setError(errorNotice(error, fallback));
  };

  function erase(entry: EmergencyInfoEntry) {
    remove.mutateAsync(entry).then(async () => {
      await offline.removeByResource("emergency_info", entry.id);
      close();
      setNotice(textNotice(() => m.assets_emergency_information_deleted()));
    }, failInDialog(m.assets_the_emergency_information_could_not_be_deleted));
  }

  async function togglePin(entry: EmergencyInfoEntry) {
    if (offline.isPinned("emergency_info", entry.id)) {
      await offline.removeByResource("emergency_info", entry.id);
      setNotice(textNotice(() => m.owner_is_no_longer_available_offline({ p0: entry.label })));
      return;
    }
    const snapshot = {
      kind: entry.kind,
      label: entry.label,
      value: entry.value,
      notes: entry.notes,
    };
    await offline.pin({
      resourceKind: "emergency_info",
      resourceId: entry.id,
      metadataUrl: `${path}/${entry.id}`,
      title: entry.label,
      contentType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(snapshot, null, 2)).buffer as ArrayBuffer,
    });
    setNotice(textNotice(() => m.owner_is_saved_offline_on_this_device({ p0: entry.label })));
  }

  const message =
    notice ??
    (entriesQuery.error
      ? errorMessage(entriesQuery.error, m.assets_your_emergency_information_could_not_be_loaded)
      : entriesQuery.isPending
        ? m.assets_loading_your_emergency_information()
        : m.assets_contacts_numbers_and_medical_notes_are_visible_only_to_you());

  return (
    <section className="travel-card manager" aria-labelledby="emergency-info-title">
      <div className="capture-heading">
        <div>
          <h3 id="emergency-info-title">{m.assets_emergency_information()}</h3>
          <p>
            {m.assets_contacts_relevant_numbers_and_brief_medical_or_care_notes_separate_from_()}
          </p>
        </div>
        <Button className="secondary compact" type="button" onClick={create}>
          {m.assets_new_entry()}
        </Button>
      </div>
      <p className="help" role="status">
        {message}
      </p>
      {entries.length > 0 && (
        <div className="saved-records mt-0.5">
          {entries.map((entry) => (
            <article className="excerpt-row" data-stacked="" key={entry.id}>
              <Button
                className="document-select"
                type="button"
                onClick={() => dialog.inspect(entry.id)}
                aria-label={m.assets_view_emergency_information({ p0: entry.label })}
              >
                <strong>{entry.label}</strong>
                <span>
                  {KIND_LABELS[entry.kind]} · {entry.value}
                  {entry.notes ? ` · ${entry.notes_text ?? entry.notes}` : ""}
                </span>
              </Button>
              <div className="button-row">
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() => void togglePin(entry).catch(fail(m.assets_saving_offline_failed))}
                >
                  {offline.isPinned("emergency_info", entry.id)
                    ? m.owner_remove_offline_copy()
                    : m.owner_save_offline()}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!entries.length && !entriesQuery.isPending && (
        <p>{m.assets_no_emergency_information_yet_add_a_contact_number_or_medical_note()}</p>
      )}
      <RecordDialog
        open={editing || selected !== null}
        title={
          editing
            ? editingId
              ? m.assets_edit_emergency_information()
              : m.assets_add_emergency_information()
            : m.assets_emergency_information()
        }
        dirty={editing && record.dirty}
        error={dialog.error}
        onDismiss={close}
      >
        {!editing && selected && (
          <div className="stack-form">
            <div>
              <h3>{selected.label}</h3>
              <p>
                {KIND_LABELS[selected.kind]} · {selected.value}
              </p>
              <Markdown html={selected.notes_html} text={selected.notes} />
            </div>
            <div className="button-row">
              <Button type="button" onClick={() => edit(selected)}>
                {m.owner_edit()}
              </Button>
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
                title={m.owner_delete_2({ p0: selected.label })}
                onCancel={() => dialog.setConfirmDelete(false)}
                onConfirm={() => erase(selected)}
              />
            )}
          </div>
        )}
        {editing && (
          <RecordForm
            record={record}
            submitLabel={editingId ? m.assets_save() : m.assets_add()}
            pendingLabel={m.owner_saving()}
          >
            <div className="field-row">
              <record.form.Field name="kind">
                {(field) => (
                  <SelectField field={field} label={m.assets_kind()}>
                    {Object.entries(KIND_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectField>
                )}
              </record.form.Field>
              <record.form.Field
                name="label"
                validators={{
                  onChange: requiredText(m.assets_give_the_entry_a_label),
                  onSubmit: requiredText(m.assets_give_the_entry_a_label),
                }}
              >
                {(field) => (
                  <TextField
                    field={field}
                    label={m.assets_label()}
                    required
                    maxLength={160}
                    placeholder={m.assets_for_example_mum_embassy_allergy()}
                  />
                )}
              </record.form.Field>
            </div>
            <record.form.Field
              name="value"
              validators={{
                onChange: requiredText(m.assets_enter_a_value),
                onSubmit: requiredText(m.assets_enter_a_value),
              }}
            >
              {(field) => (
                <TextField
                  field={field}
                  label={m.assets_value()}
                  required
                  maxLength={255}
                  placeholder={m.assets_phone_number_or_short_description()}
                />
              )}
            </record.form.Field>
            <record.form.Field name="notes">
              {(field) => (
                <MarkdownField
                  field={field}
                  label={m.owner_notes()}
                  optional
                  maxLength={4000}
                  rows={3}
                />
              )}
            </record.form.Field>
          </RecordForm>
        )}
      </RecordDialog>
    </section>
  );
}
