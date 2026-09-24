import { useState } from "react";

import { RecordForm, requiredText, TextField } from "../forms/fields";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import { timeZoneOptions, type BroadPlace, type Trip } from "../tracker-model";

type Values = { label: string; countryCode: string; region: string; latitude: string; longitude: string; timezone: string };
const blank = (): Values => ({ label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" });
const fromPlace = (place: BroadPlace): Values => ({ label: place.label, countryCode: place.country_code ?? "", region: place.region ?? "", latitude: place.latitude?.toString() ?? "", longitude: place.longitude?.toString() ?? "", timezone: place.timezone ?? "" });
const serverFields = { label: "label", country_code: "countryCode", region: "region", latitude: "latitude", longitude: "longitude", timezone: "timezone" };

const bothCoordinates = ({ value, fieldApi }: { value: string; fieldApi: { form: { getFieldValue: (name: never) => unknown } } }) =>
  (value === "") !== (String(fieldApi.form.getFieldValue("longitude" as never) ?? "") === "") ? "Vul beide brede coördinaten in of laat beide leeg." : undefined;

export function BroadPlaceManager({ trip }: { trip: Trip }) {
  const placesQuery = useTripResource(trip.id, "places/broad");
  const places = placesQuery.data ?? [];
  const dialog = useRecordDialog(places);
  const [message, setMessage] = useState("Brede plaatsen zijn bewust algemene steden, regio’s of kaartpunten.");

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, BroadPlace>({
    fallback: "De brede plaats kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${tripPath(trip.id, "places/broad")}/${id}` : tripPath(trip.id, "places/broad"), method: id ? "PATCH" : "POST", body: payload }),
    // Route stages, cards and excerpts embed the place, so the trip is refreshed with it.
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "places/broad"), ownerKeys.trips(subject)],
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "De brede plaats kon niet worden opgeslagen.",
    serverFields,
    submit: async (values) => {
      await save.mutateAsync({
        id: dialog.editingId ?? null,
        payload: {
          label: values.label.trim(),
          country_code: values.countryCode.trim().toUpperCase() || null,
          region: values.region.trim() || null,
          latitude: values.latitude === "" ? null : Number(values.latitude),
          longitude: values.longitude === "" ? null : Number(values.longitude),
          timezone: values.timezone.trim() || null,
        },
      });
    },
    onSuccess: () => { close(); setMessage("Brede plaats opgeslagen. Je kunt hem bewust aan een uittreksel koppelen."); },
  });

  function close() { dialog.close(); record.load(blank()); }
  function create() { record.load(blank()); dialog.create(); }
  function edit(place: BroadPlace) { record.load(fromPlace(place)); dialog.edit(place.id); }

  const summary = (place: BroadPlace) => [place.region, place.country_code, place.timezone].filter(Boolean).join(" · ") || "Alleen voor deze reis";
  const { selected, editing, editingId } = dialog;

  return <section className="card manager" aria-labelledby="broad-places-title">
    <div className="capture-heading"><div><h3 id="broad-places-title">Brede plaatsen</h3><p>Gebruik een bewust algemene plaats, zoals een stad of regio.</p></div><button className="secondary compact" type="button" onClick={create}>Brede plaats toevoegen</button></div>
    <p className="help" role="status">{placesQuery.error ? errorMessage(placesQuery.error, "De brede plaatsen konden niet worden geladen.") : message}</p>
    {places.length ? <div className="saved-moments manager-list">{places.map((place) => <article className="excerpt-row" key={place.id}>
      <button className="document-select" type="button" onClick={() => dialog.inspect(place.id)} aria-label={`Brede plaats ${place.label} bekijken`}><strong>{place.label}</strong><span>{summary(place)}</span></button>
    </article>)}</div> : !placesQuery.isPending && <p>Nog geen brede plaatsen.</p>}
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Brede plaats bewerken" : "Brede plaats toevoegen") : "Brede plaats"} dirty={editing && record.dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form">
        <div><h3>{selected.label}</h3><p>{summary(selected)}</p>{selected.latitude !== null && selected.longitude !== null && <p>Algemeen kaartpunt: {selected.latitude}, {selected.longitude}</p>}</div>
        <button type="button" onClick={() => edit(selected)}>Bewerken</button>
      </div>}
      {editing && <RecordForm record={record} submitLabel="Brede plaats opslaan" pendingLabel="Opslaan…">
        <div className="field-row">
          <record.form.Field name="label" validators={{ onChange: requiredText("Geef de plaats een naam."), onSubmit: requiredText("Geef de plaats een naam.") }}>{(field) => <TextField field={field} label="Naam" required maxLength={120} />}</record.form.Field>
          <record.form.Field name="countryCode">{(field) => <TextField field={field} label="Landcode" optional maxLength={2} />}</record.form.Field>
        </div>
        <div className="field-row">
          <record.form.Field name="region">{(field) => <TextField field={field} label="Regio" optional maxLength={120} />}</record.form.Field>
          <record.form.Field name="timezone">{(field) => <TextField field={field} label="Tijdzone" optional="(optioneel, privé)" list="broad-place-time-zones" maxLength={64} />}</record.form.Field>
        </div>
        <datalist id="broad-place-time-zones">{timeZoneOptions().map((zone) => <option key={zone} value={zone} />)}</datalist>
        <div className="field-row">
          <record.form.Field name="latitude" validators={{ onChangeListenTo: ["longitude"], onChange: bothCoordinates, onSubmit: bothCoordinates }}>{(field) => <TextField field={field} label="Brede breedtegraad" optional type="number" min={-90} max={90} step="any" />}</record.form.Field>
          <record.form.Field name="longitude">{(field) => <TextField field={field} label="Brede lengtegraad" optional type="number" min={-180} max={180} step="any" />}</record.form.Field>
        </div>
      </RecordForm>}
    </RecordDialog>
  </section>;
}
