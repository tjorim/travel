import { useState } from "react";

import { RecordForm, requiredText, SelectField, TextAreaField, TextField } from "../forms/fields";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import type { BroadPlace, MomentExcerpt, Trip } from "../tracker-model";

type Values = { sourceMomentId: string; broadPlaceId: string; datePrecision: MomentExcerpt["date_precision"]; storyDate: string; title: string; body: string };
const blank = (): Values => ({ sourceMomentId: "", broadPlaceId: "", datePrecision: "day", storyDate: "", title: "", body: "" });
const fromExcerpt = (excerpt: MomentExcerpt): Values => ({ sourceMomentId: excerpt.source_moment_id ?? "", broadPlaceId: excerpt.broad_place_id ?? "", datePrecision: excerpt.date_precision, storyDate: excerpt.story_date ?? "", title: excerpt.title, body: excerpt.body });
const serverFields = { source_moment_id: "sourceMomentId", broad_place_id: "broadPlaceId", date_precision: "datePrecision", story_date: "storyDate", title: "title", body: "body" };

/** Excerpts are embedded in the trip, so every write refreshes the trip list. */
export function MomentExcerptManager({ trip, broadPlaces }: { trip: Trip; broadPlaces: BroadPlace[] }) {
  const dialog = useRecordDialog(trip.moment_excerpts);
  const [message, setMessage] = useState("Een uittreksel is afzonderlijk geschreven en blijft privé totdat je het expliciet publiceert.");
  const path = tripPath(trip.id, "moment-excerpts");
  const invalidate = (subject: string) => [ownerKeys.trips(subject)];

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, MomentExcerpt>({
    fallback: "Het uittreksel kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${path}/${id}` : path, method: id ? "PATCH" : "POST", body: payload }),
    invalidate,
  });
  const remove = useOwnerMutation<MomentExcerpt>({
    fallback: "Het uittreksel kon niet worden verwijderd.",
    request: (item) => ({ path: `${path}/${item.id}`, method: "DELETE" }),
    invalidate,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "Het uittreksel kon niet worden opgeslagen.",
    serverFields,
    submit: async (values) => {
      await save.mutateAsync({
        id: dialog.editingId ?? null,
        payload: { source_moment_id: values.sourceMomentId || null, broad_place_id: values.broadPlaceId || null, date_precision: values.datePrecision, story_date: values.storyDate || null, title: values.title.trim(), body: values.body.trim() },
      });
    },
    onSuccess: () => { close(); setMessage("Uittreksel opgeslagen. Het is nog niet gedeeld."); },
  });

  function close() { dialog.close(); record.load(blank()); }
  function create() { record.load(blank()); dialog.create(); }
  function edit(item: MomentExcerpt) { record.load(fromExcerpt(item)); dialog.edit(item.id); }
  function erase(item: MomentExcerpt) {
    remove.mutateAsync(item).then(() => { close(); setMessage("Uittreksel verwijderd."); }, (error: unknown) => setMessage(errorMessage(error, "Het uittreksel kon niet worden verwijderd.")));
  }
  const { selected, editing, editingId } = dialog;

  return <section className="card manager" aria-labelledby="excerpts-title">
    <div className="capture-heading"><div><h3 id="excerpts-title">Moment-uittreksels</h3><p>Een uittreksel is afzonderlijk geschreven en blijft privé totdat je het expliciet publiceert.</p></div><button className="secondary compact" type="button" onClick={create}>Nieuw uittreksel</button></div>
    <p className="help" role="status">{message}</p>
    {trip.moment_excerpts.length > 0 && <div className="saved-moments manager-list">{trip.moment_excerpts.map((item) => <article className="excerpt-row" key={item.id}>
      <button className="document-select" type="button" onClick={() => dialog.inspect(item.id)} aria-label={`Uittreksel ${item.title} bekijken`}><strong>{item.title}</strong><span>{item.date_precision} · {item.broad_place_id ? broadPlaces.find((place) => place.id === item.broad_place_id)?.label ?? "brede plaats" : "geen plaats"}</span></button>
    </article>)}</div>}
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Uittreksel bewerken" : "Uittreksel maken") : "Moment-uittreksel"} dirty={editing && record.dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form">
        <div><h3>{selected.title}</h3><p>{selected.body}</p></div>
        <div className="button-row"><button type="button" onClick={() => edit(selected)}>Bewerken</button><button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>Verwijderen</button></div>
        {dialog.confirmDelete && <DeleteConfirmation title={`Uittreksel “${selected.title}” verwijderen?`} onCancel={() => dialog.setConfirmDelete(false)} onConfirm={() => erase(selected)} />}
      </div>}
      {editing && <RecordForm record={record} submitLabel={editingId ? "Uittreksel opslaan" : "Uittreksel maken"} pendingLabel="Opslaan…">
        <div className="field-row">
          <record.form.Field name="sourceMomentId">{(field) => <SelectField field={field} label="Bronmoment" optional><option value="">Geen bronmoment</option>{trip.moments.map((moment) => <option key={moment.id} value={moment.id}>{moment.title}</option>)}</SelectField>}</record.form.Field>
          <record.form.Field name="datePrecision">{(field) => <SelectField field={field} label="Datumprecisie"><option value="day">Dag</option><option value="month">Maand</option><option value="year">Jaar</option></SelectField>}</record.form.Field>
        </div>
        <div className="field-row">
          <record.form.Field name="storyDate">{(field) => <TextField field={field} label="Verhaalsdatum" optional type="date" />}</record.form.Field>
          <record.form.Field name="broadPlaceId">{(field) => <SelectField field={field} label="Brede plaats" optional><option value="">Geen plaats</option>{broadPlaces.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</SelectField>}</record.form.Field>
        </div>
        <record.form.Field name="title" validators={{ onChange: requiredText("Geef het uittreksel een titel."), onSubmit: requiredText("Geef het uittreksel een titel.") }}>{(field) => <TextField field={field} label="Titel" required maxLength={160} />}</record.form.Field>
        <record.form.Field name="body" validators={{ onChange: requiredText("Schrijf het uittreksel."), onSubmit: requiredText("Schrijf het uittreksel.") }}>{(field) => <TextAreaField field={field} label="Uittreksel" required maxLength={10000} rows={5} />}</record.form.Field>
      </RecordForm>}
    </RecordDialog>
  </section>;
}
