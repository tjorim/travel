import { RecordForm, requiredText, SelectField, TextAreaField, TextField } from "../forms/fields";
import { useRecordForm } from "../forms/useRecordForm";
import { ownerKeys } from "../query/keys";
import { errorMessage } from "../query/api";
import { useOwnerMutation, useRefreshTrip } from "../query/owner-queries";
import type { Trip } from "../tracker-model";

type Values = { title: string; summary: string; startsOn: string; endsOn: string; visibility: Trip["visibility"]; publicationState: Trip["publication_state"] };

const blank = (): Values => ({ title: "", summary: "", startsOn: "", endsOn: "", visibility: "private", publicationState: "draft" });
const fromTrip = (trip: Trip): Values => ({ title: trip.title, summary: trip.summary ?? "", startsOn: trip.starts_on ?? "", endsOn: trip.ends_on ?? "", visibility: trip.visibility, publicationState: trip.publication_state });
const serverFields = { title: "title", summary: "summary", starts_on: "startsOn", ends_on: "endsOn", visibility: "visibility", publication_state: "publicationState" };

/**
 * Creates or edits one trip. Mount it with `key={trip?.id ?? "new"}`: the
 * form starts from that record and treats the last saved values as clean.
 */
export function TripEditor({ trip, onSaved, onDeleted, onNotice }: { trip: Trip | null; onSaved: (saved: Trip, created: boolean) => void; onDeleted: () => void; onNotice: (message: string) => void }) {
  const refresh = useRefreshTrip();
  const save = useOwnerMutation<Values, Trip>({
    fallback: "De reis kon niet worden opgeslagen.",
    request: (values) => {
      const details = { title: values.title.trim(), summary: values.summary.trim() || null, starts_on: values.startsOn || null, ends_on: values.endsOn || null };
      return trip
        ? { path: `/api/trips/${encodeURIComponent(trip.id)}`, method: "PATCH", body: { ...details, visibility: values.visibility, publication_state: values.publicationState } }
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
    onSuccess: (saved) => { onSaved(saved, !trip); onNotice(trip ? "Reis opgeslagen." : "Private reis gemaakt."); },
  });
  const { form } = record;

  function deleteTrip() {
    if (!trip || !window.confirm(`Verwijder ${trip.title} met alle private inhoud?`)) return;
    remove.mutateAsync(trip).then(() => { refresh.forget(trip.id); onDeleted(); onNotice("Reis verwijderd."); }, (error: unknown) => onNotice(errorMessage(error, "De reis kon niet worden verwijderd.")));
  }

  return <section className="card">
    <h3>{trip ? "Reis bewerken" : "Nieuwe reis"}</h3>
    <RecordForm record={record} submitLabel={trip ? "Reis opslaan" : "Reis maken"} pendingLabel={trip ? "Reis opslaan…" : "Reis maken…"} actions={trip && <button className="danger compact" type="button" onClick={deleteTrip}>Reis verwijderen</button>}>
      <form.Field name="title" validators={{ onChange: requiredText("Geef de reis een titel."), onSubmit: requiredText("Geef de reis een titel.") }}>{(field) => <TextField field={field} label="Titel" required maxLength={160} />}</form.Field>
      <form.Field name="summary">{(field) => <TextAreaField field={field} label="Samenvatting" optional maxLength={4000} rows={4} />}</form.Field>
      <div className="field-row">
        <form.Field name="startsOn">{(field) => <TextField field={field} label="Eerste reisdag" optional type="date" />}</form.Field>
        <form.Field name="endsOn" validators={{ onChangeListenTo: ["startsOn"], onChange: ({ value, fieldApi }) => value && value < fieldApi.form.getFieldValue("startsOn") ? "De laatste reisdag ligt vóór de eerste." : undefined, onSubmit: ({ value, fieldApi }) => value && value < fieldApi.form.getFieldValue("startsOn") ? "De laatste reisdag ligt vóór de eerste." : undefined }}>{(field) => <TextField field={field} label="Laatste reisdag" optional type="date" />}</form.Field>
      </div>
      {trip && <>
        <form.Field name="visibility" listeners={{ onChange: ({ value }) => { if (value === "private") form.setFieldValue("publicationState", "draft"); } }}>{(field) => <SelectField field={field} label="Zichtbaarheid"><option value="private">Privé</option><option value="unlisted">Verborgen link</option><option value="public">Publiek</option></SelectField>}</form.Field>
        <form.Subscribe selector={(state) => state.values.visibility}>{(visibility) => <form.Field name="publicationState">{(field) => <SelectField field={field} label="Publicatie"><option value="draft">Concept</option><option value="published" disabled={visibility === "private"}>Gepubliceerd</option></SelectField>}</form.Field>}</form.Subscribe>
        <p className="help">Zichtbaarheid maakt niets automatisch deelbaar: kies aparte publicaties wanneer je klaar bent.</p>
      </>}
    </RecordForm>
  </section>;
}
