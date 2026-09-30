import { Button } from "@base-ui/react/button";
import { useState } from "react";

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
  contact: "Contactpersoon",
  number: "Telefoonnummer",
  medical_note: "Medische notitie",
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
  const offline = useOfflineCopies();
  const entriesQuery = useLibrary("emergency-info");
  const entries = entriesQuery.data ?? [];
  const dialog = useRecordDialog(entries);
  const { selected, editing, editingId } = dialog;
  const [notice, setNotice] = useState<string | null>(null);
  const path = libraryPath("emergency-info");
  const refresh = (subject: string) => [ownerKeys.library(subject, "emergency-info")];

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, EmergencyInfoEntry>({
    fallback: "De noodinformatie kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${path}/${id}` : path, method: id ? "PATCH" : "POST", body: payload }),
    invalidate: refresh,
  });
  const remove = useOwnerMutation<EmergencyInfoEntry>({
    fallback: "De noodinformatie kon niet worden verwijderd.",
    request: (entry) => ({ path: `${path}/${entry.id}`, method: "DELETE" }),
    invalidate: refresh,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "De noodinformatie kon niet worden opgeslagen.",
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
      setNotice("Noodinformatie opgeslagen.");
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
  const fail = (fallback: string) => (error: unknown) => setNotice(errorMessage(error, fallback));
  const failInDialog = (fallback: string) => (error: unknown) => {
    dialog.setConfirmDelete(false);
    dialog.setError(errorMessage(error, fallback));
  };

  function erase(entry: EmergencyInfoEntry) {
    remove.mutateAsync(entry).then(async () => {
      await offline.removeByResource("emergency_info", entry.id);
      close();
      setNotice("Noodinformatie verwijderd.");
    }, failInDialog("De noodinformatie kon niet worden verwijderd."));
  }

  async function togglePin(entry: EmergencyInfoEntry) {
    if (offline.isPinned("emergency_info", entry.id)) {
      await offline.removeByResource("emergency_info", entry.id);
      setNotice(`“${entry.label}” is niet langer offline beschikbaar.`);
      return;
    }
    const snapshot = { kind: KIND_LABELS[entry.kind], label: entry.label, value: entry.value, notes: entry.notes };
    await offline.pin({
      resourceKind: "emergency_info",
      resourceId: entry.id,
      metadataUrl: `${path}/${entry.id}`,
      title: entry.label,
      contentType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(snapshot, null, 2)).buffer as ArrayBuffer,
    });
    setNotice(`“${entry.label}” is offline bewaard op dit toestel.`);
  }

  const message =
    notice ??
    (entriesQuery.error
      ? errorMessage(entriesQuery.error, "Je noodinformatie kon niet worden geladen.")
      : entriesQuery.isPending
        ? "Laad je noodinformatie…"
        : "Contacten, nummers en medische notities blijven uitsluitend voor jou zichtbaar.");

  return (
    <section className="travel-card manager" aria-labelledby="emergency-info-title">
      <div className="capture-heading">
        <div>
          <h3 id="emergency-info-title">Noodinformatie</h3>
          <p>
            Contacten, relevante nummers en beknopte medische of hulpverlenersnotities, los van één specifieke reis.
          </p>
        </div>
        <Button className="secondary compact" type="button" onClick={create}>
          Nieuwe invoer
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
                aria-label={`Noodinformatie ${entry.label} bekijken`}
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
                  onClick={() => void togglePin(entry).catch(fail("Offline bewaren is mislukt."))}
                >
                  {offline.isPinned("emergency_info", entry.id) ? "Offline verwijderen" : "Offline bewaren"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!entries.length && !entriesQuery.isPending && (
        <p>Nog geen noodinformatie. Voeg een contact, nummer of medische notitie toe.</p>
      )}
      <RecordDialog
        open={editing || selected !== null}
        title={editing ? (editingId ? "Noodinformatie bewerken" : "Noodinformatie toevoegen") : "Noodinformatie"}
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
                Bewerken
              </Button>
              <Button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>
                Verwijderen
              </Button>
            </div>
            {dialog.confirmDelete && (
              <DeleteConfirmation
                title={`“${selected.label}” verwijderen?`}
                onCancel={() => dialog.setConfirmDelete(false)}
                onConfirm={() => erase(selected)}
              />
            )}
          </div>
        )}
        {editing && (
          <RecordForm record={record} submitLabel={editingId ? "Opslaan" : "Toevoegen"} pendingLabel="Opslaan…">
            <div className="field-row">
              <record.form.Field name="kind">
                {(field) => (
                  <SelectField field={field} label="Soort">
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
                  onChange: requiredText("Geef de invoer een label."),
                  onSubmit: requiredText("Geef de invoer een label."),
                }}
              >
                {(field) => (
                  <TextField
                    field={field}
                    label="Label"
                    required
                    maxLength={160}
                    placeholder="Bijvoorbeeld: Mama, Ambassade, Allergie"
                  />
                )}
              </record.form.Field>
            </div>
            <record.form.Field
              name="value"
              validators={{
                onChange: requiredText("Vul een waarde in."),
                onSubmit: requiredText("Vul een waarde in."),
              }}
            >
              {(field) => (
                <TextField
                  field={field}
                  label="Waarde"
                  required
                  maxLength={255}
                  placeholder="Telefoonnummer of korte omschrijving"
                />
              )}
            </record.form.Field>
            <record.form.Field name="notes">
              {(field) => <MarkdownField field={field} label="Notities" optional maxLength={4000} rows={3} />}
            </record.form.Field>
          </RecordForm>
        )}
      </RecordDialog>
    </section>
  );
}
