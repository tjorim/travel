import { useState } from "react";

import { RecordForm, requiredText, TextAreaField, TextField } from "../forms/fields";
import { useRecordForm } from "../forms/useRecordForm";
import { ownerKeys } from "../query/keys";
import { errorMessage } from "../query/api";
import { useOwnerMutation, useRefreshTrip } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import type { Trip } from "../tracker-model";

type Values = { title: string; summary: string; startsOn: string; endsOn: string };

const blank = (): Values => ({ title: "", summary: "", startsOn: "", endsOn: "" });
const fromTrip = (trip: Trip): Values => ({ title: trip.title, summary: trip.summary ?? "", startsOn: trip.starts_on ?? "", endsOn: trip.ends_on ?? "" });
const serverFields = { title: "title", summary: "summary", starts_on: "startsOn", ends_on: "endsOn" };

/**
 * Creates or edits one trip in a dialog. Mount it with `key={trip?.id ?? "new"}`:
 * the form starts from that record and treats the last saved values as clean.
 */
export function TripEditor({ trip, open, onClose, onSaved, onDeleted, onNotice }: { trip: Trip | null; open: boolean; onClose: () => void; onSaved: (saved: Trip, created: boolean) => void; onDeleted: () => void; onNotice: (message: string) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = useRefreshTrip();
  const save = useOwnerMutation<Values, Trip>({
    fallback: "De reis kon niet worden opgeslagen.",
    request: (values) => {
      const details = { title: values.title.trim(), summary: values.summary.trim() || null, starts_on: values.startsOn || null, ends_on: values.endsOn || null };
      return trip
        ? { path: `/api/trips/${encodeURIComponent(trip.id)}`, method: "PATCH", body: details }
        : { path: "/api/trips", method: "POST", body: details };
    },
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });
  const remove = useOwnerMutation<Trip>({
    fallback: "De reis kon niet worden verwijderd.",
    request: (target) => ({ path: `/api/trips/${encodeURIComponent(target.id)}`, method: "DELETE" }),
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });

  const record = useRecordForm<Values, Trip>({
    defaultValues: trip ? fromTrip(trip) : blank(),
    fallback: "De reis kon niet worden opgeslagen.",
    serverFields,
    submit: (values) => save.mutateAsync(values),
    onSuccess: (saved) => { close(); onSaved(saved, !trip); onNotice(trip ? "Reis opgeslagen." : "Private reis gemaakt."); },
  });
  const { form } = record;
  function close() { setConfirmDelete(false); record.load(trip ? fromTrip(trip) : blank()); onClose(); }

  function deleteTrip(target: Trip) {
    remove.mutateAsync(target).then(() => { refresh.forget(target.id); close(); onDeleted(); onNotice("Reis verwijderd."); }, (error: unknown) => onNotice(errorMessage(error, "De reis kon niet worden verwijderd.")));
  }

  return <RecordDialog open={open} title={trip ? "Reis bewerken" : "Nieuwe reis"} dirty={open && record.dirty} onDismiss={close}>
    {open && <RecordForm record={record} submitLabel={trip ? "Reis opslaan" : "Reis maken"} pendingLabel={trip ? "Reis opslaan…" : "Reis maken…"} actions={trip && <button className="danger compact" type="button" onClick={() => setConfirmDelete(true)}>Reis verwijderen</button>}>
      <form.Field name="title" validators={{ onChange: requiredText("Geef de reis een titel."), onSubmit: requiredText("Geef de reis een titel.") }}>{(field) => <TextField field={field} label="Titel" required maxLength={160} />}</form.Field>
      <form.Field name="summary">{(field) => <TextAreaField field={field} label="Samenvatting" optional maxLength={4000} rows={4} />}</form.Field>
      <div className="field-row">
        <form.Field name="startsOn">{(field) => <TextField field={field} label="Eerste reisdag" optional type="date" />}</form.Field>
        <form.Field name="endsOn" validators={{ onChangeListenTo: ["startsOn"], onChange: ({ value, fieldApi }) => value && value < fieldApi.form.getFieldValue("startsOn") ? "De laatste reisdag ligt vóór de eerste." : undefined, onSubmit: ({ value, fieldApi }) => value && value < fieldApi.form.getFieldValue("startsOn") ? "De laatste reisdag ligt vóór de eerste." : undefined }}>{(field) => <TextField field={field} label="Laatste reisdag" optional type="date" />}</form.Field>
      </div>
    </RecordForm>}
    {open && confirmDelete && trip && <DeleteConfirmation title={`“${trip.title}” verwijderen?`} description="Alle private inhoud van deze reis wordt verwijderd. Deze actie kan niet ongedaan worden gemaakt." onCancel={() => setConfirmDelete(false)} onConfirm={() => deleteTrip(trip)} />}
  </RecordDialog>;
}
