import { useState } from "react";

import { RecordForm, requiredText, TextAreaField, TextField } from "../forms/fields";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import type { Trip, TripHighlight } from "../tracker-model";

type Values = { title: string; summary: string };
const blank = (): Values => ({ title: "", summary: "" });
const fromHighlight = (item: TripHighlight): Values => ({ title: item.title, summary: item.summary ?? "" });
const serverFields = { title: "title", summary: "summary" };

/** Highlights are embedded in the trip, so every write refreshes the trip list. */
export function HighlightManager({ trip }: { trip: Trip }) {
  const highlights = trip.highlights.slice().sort((a, b) => a.position - b.position);
  const dialog = useRecordDialog(highlights);
  const [message, setMessage] = useState("Hoogtepunten zijn korte, deelbare teksten. Ze verschijnen pas wanneer je ze in een publicatie kiest.");
  const path = tripPath(trip.id, "highlights");
  const invalidate = (subject: string) => [ownerKeys.trips(subject)];

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, TripHighlight>({
    fallback: "Het hoogtepunt kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${path}/${id}` : path, method: id ? "PATCH" : "POST", body: payload }),
    invalidate,
  });
  const move = useOwnerMutation<{ item: TripHighlight; position: number }, TripHighlight>({
    fallback: "Het hoogtepunt kon niet worden verplaatst.",
    request: ({ item, position }) => ({ path: `${path}/${item.id}`, method: "PATCH", body: { position } }),
    invalidate,
  });
  const remove = useOwnerMutation<TripHighlight>({
    fallback: "Het hoogtepunt kon niet worden verwijderd.",
    request: (item) => ({ path: `${path}/${item.id}`, method: "DELETE" }),
    invalidate,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "Het hoogtepunt kon niet worden opgeslagen.",
    serverFields,
    submit: async (values) => { await save.mutateAsync({ id: dialog.editingId ?? null, payload: { title: values.title.trim(), summary: values.summary.trim() || null } }); },
    onSuccess: () => { close(); setMessage("Hoogtepunt opgeslagen. Het is nog niet gedeeld."); },
  });

  function close() { dialog.close(); record.load(blank()); }
  function create() { record.load(blank()); dialog.create(); }
  function edit(item: TripHighlight) { record.load(fromHighlight(item)); dialog.edit(item.id); }
  const fail = (fallback: string) => (error: unknown) => setMessage(errorMessage(error, fallback));
  function shift(item: TripHighlight, direction: -1 | 1) {
    const position = item.position + direction;
    if (position < 0 || position >= highlights.length) return;
    move.mutateAsync({ item, position }).catch(fail("Het hoogtepunt kon niet worden verplaatst."));
  }
  function erase(item: TripHighlight) {
    remove.mutateAsync(item).then(() => { close(); setMessage("Hoogtepunt verwijderd."); }, fail("Het hoogtepunt kon niet worden verwijderd."));
  }
  const { selected, editing, editingId } = dialog;

  return <section className="card manager" aria-labelledby="highlights-title">
    <div className="capture-heading"><div><h3 id="highlights-title">Hoogtepunten</h3><p>Wat maakt deze reis bijzonder? Schrijf het apart, zodat je het bewust kunt delen.</p></div><button className="secondary compact" type="button" onClick={create}>Nieuw hoogtepunt</button></div>
    <p className="help" role="status">{message}</p>
    {highlights.length > 0 && <div className="saved-moments manager-list">{highlights.map((item, index) => <article className="excerpt-row" key={item.id}>
      <button className="document-select" type="button" onClick={() => dialog.inspect(item.id)} aria-label={`Hoogtepunt ${item.title} bekijken`}><strong>{item.title}</strong>{item.summary && <span>{item.summary}</span>}</button>
      <div className="button-row"><button className="secondary compact" type="button" disabled={index === 0} onClick={() => shift(item, -1)}>Omhoog</button><button className="secondary compact" type="button" disabled={index === highlights.length - 1} onClick={() => shift(item, 1)}>Omlaag</button></div>
    </article>)}</div>}
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Hoogtepunt bewerken" : "Hoogtepunt toevoegen") : "Hoogtepunt"} dirty={editing && record.dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form">
        <div><h3>{selected.title}</h3>{selected.summary && <p>{selected.summary}</p>}</div>
        <div className="button-row"><button type="button" onClick={() => edit(selected)}>Bewerken</button><button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>Verwijderen</button></div>
        {dialog.confirmDelete && <DeleteConfirmation title={`Hoogtepunt “${selected.title}” verwijderen?`} onCancel={() => dialog.setConfirmDelete(false)} onConfirm={() => erase(selected)} />}
      </div>}
      {editing && <RecordForm record={record} submitLabel={editingId ? "Hoogtepunt opslaan" : "Hoogtepunt toevoegen"} pendingLabel="Opslaan…">
        <record.form.Field name="title" validators={{ onChange: requiredText("Geef het hoogtepunt een titel."), onSubmit: requiredText("Geef het hoogtepunt een titel.") }}>{(field) => <TextField field={field} label="Titel" required maxLength={160} placeholder="Bijvoorbeeld: Stad ↔ natuur" />}</record.form.Field>
        <record.form.Field name="summary">{(field) => <TextAreaField field={field} label="Korte tekst" optional maxLength={2000} rows={2} />}</record.form.Field>
      </RecordForm>}
    </RecordDialog>
  </section>;
}
