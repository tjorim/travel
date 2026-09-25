import { useState } from "react";

import { RecordForm, requiredText, TextField } from "../forms/fields";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { timeZoneOptions, type BroadPlace, type PlaceSearchResult, type Trip } from "../tracker-model";
import { VisibilityControl, visibilityLabel } from "./visibility";
import { PlaceSearchField } from "./PlaceSearchField";

type Values = { label: string; countryCode: string; region: string; latitude: string; longitude: string; timezone: string };
const blank = (): Values => ({ label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" });
const fromPlace = (place: BroadPlace): Values => ({ label: place.label, countryCode: place.country_code ?? "", region: place.region ?? "", latitude: place.latitude?.toString() ?? "", longitude: place.longitude?.toString() ?? "", timezone: place.timezone ?? "" });
const serverFields = { label: "label", country_code: "countryCode", region: "region", latitude: "latitude", longitude: "longitude", timezone: "timezone" };

const bothCoordinates = ({ value, fieldApi }: { value: string; fieldApi: { form: { getFieldValue: (name: never) => unknown } } }) =>
  (value === "") !== (String(fieldApi.form.getFieldValue("longitude" as never) ?? "") === "") ? "Vul beide kaartcoördinaten in of laat beide leeg." : undefined;
const broadCoordinate = (value: number) => (Math.round(value * 100) / 100).toString();

export function BroadPlaceManager({ trip }: { trip: Trip }) {
  const placesQuery = useTripResource(trip.id, "places/broad");
  const places = placesQuery.data ?? [];
  const dialog = useRecordDialog(places);
  const [message, setMessage] = useState("Plaatsen zijn algemene steden, regio’s of kaartpunten. Ze zijn niet automatisch openbaar.");

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, BroadPlace>({
    fallback: "De plaats kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${tripPath(trip.id, "places/broad")}/${id}` : tripPath(trip.id, "places/broad"), method: id ? "PATCH" : "POST", body: payload }),
    // Route stages, cards and excerpts embed the place, so the trip is refreshed with it.
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "places/broad"), ownerKeys.trips(subject)],
  });
  const remove = useOwnerMutation<BroadPlace>({
    fallback: "De plaats kon niet worden verwijderd.",
    request: (place) => ({ path: `${tripPath(trip.id, "places/broad")}/${place.id}`, method: "DELETE" }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "places/broad"), ownerKeys.trips(subject)],
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "De plaats kon niet worden opgeslagen.",
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
    onSuccess: () => { close(); setMessage("Plaats opgeslagen. Je kunt hem bewust aan een verhaal, halte of samenvatting koppelen."); },
  });

  function close() { dialog.close(); record.load(blank()); }
  function create() { record.load(blank()); dialog.create(); }
  function edit(place: BroadPlace) { record.load(fromPlace(place)); dialog.edit(place.id); }
  function erase(place: BroadPlace) {
    remove.mutateAsync(place).then(
      () => { close(); setMessage("Plaats verwijderd."); },
      (error: unknown) => setMessage(errorMessage(error, "De plaats kon niet worden verwijderd.")),
    );
  }
  function useSearchResult(result: PlaceSearchResult) {
    record.form.setFieldValue("label", result.locality ?? result.admin_area ?? result.display_name ?? "");
    record.form.setFieldValue("countryCode", result.country_code ?? "");
    record.form.setFieldValue("region", result.admin_area ?? "");
    // A Nominatim result can be a precise POI. Broad places deliberately use a
    // roughly kilometre-sized map point; the owner can still edit every field.
    record.form.setFieldValue("latitude", typeof result.latitude === "number" ? broadCoordinate(result.latitude) : "");
    record.form.setFieldValue("longitude", typeof result.longitude === "number" ? broadCoordinate(result.longitude) : "");
  }

  const summary = (place: BroadPlace) => [place.region, place.country_code, place.timezone].filter(Boolean).join(" · ") || "Alleen voor deze reis";
  const { selected, editing, editingId } = dialog;

  return <section className="card manager" aria-labelledby="broad-places-title">
    <div className="capture-heading"><div><h3 id="broad-places-title">Plaatsen</h3><p>Een algemene stad, regio of kaartpunt dat je kunt hergebruiken. Het is privé tot je kiest wie het ziet.</p></div><button className="secondary compact" type="button" onClick={create}>Plaats toevoegen</button></div>
    <p className="help" role="status">{placesQuery.error ? errorMessage(placesQuery.error, "De plaatsen konden niet worden geladen.") : message}</p>
    {places.length ? <div className="saved-moments manager-list">{places.map((place) => <article className="excerpt-row" key={place.id}>
      <button className="document-select" type="button" onClick={() => dialog.inspect(place.id)} aria-label={`Plaats ${place.label} bekijken`}><strong>{place.label}</strong><span>{summary(place)} · {visibilityLabel(place.visibility)}</span></button>
    </article>)}</div> : !placesQuery.isPending && <p>Nog geen plaatsen.</p>}
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Plaats bewerken" : "Plaats toevoegen") : "Plaats"} dirty={editing && record.dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form">
        <div><h3>{selected.label}</h3><p>{summary(selected)}</p>{selected.latitude !== null && selected.longitude !== null && <p>Algemeen kaartpunt: {selected.latitude}, {selected.longitude}</p>}</div>
        <VisibilityControl tripId={trip.id} kind="place" id={selected.id} value={selected.visibility} name={selected.label} />
        <div className="button-row"><button type="button" onClick={() => edit(selected)}>Bewerken</button><button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>Verwijderen</button></div>
        {dialog.confirmDelete && <DeleteConfirmation title={`Plaats “${selected.label}” verwijderen?`} description="Dit kan alleen wanneer de plaats niet meer in een halte, reisupdate of verblijf wordt gebruikt. Een eventuele losse selectie voor delen wordt ook verwijderd." onCancel={() => dialog.setConfirmDelete(false)} onConfirm={() => erase(selected)} />}
      </div>}
      {editing && <RecordForm record={record} submitLabel="Plaats opslaan" pendingLabel="Opslaan…">
        <PlaceSearchField tripId={trip.id} legend="Stad of gebied zoeken" inputLabel="Zoek stad of gebied" placeholder="Bijvoorbeeld: Taipei" help="Gebruik dit voor een algemeen kaartpunt. Een resultaat wordt pas bij opslaan bewaard en het punt wordt op ongeveer één kilometer afgerond." onSelect={useSearchResult} />
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
          <record.form.Field name="latitude" validators={{ onChangeListenTo: ["longitude"], onChange: bothCoordinates, onSubmit: bothCoordinates }}>{(field) => <TextField field={field} label="Breedtegraad" optional type="number" min={-90} max={90} step="any" />}</record.form.Field>
          <record.form.Field name="longitude">{(field) => <TextField field={field} label="Lengtegraad" optional type="number" min={-180} max={180} step="any" />}</record.form.Field>
        </div>
      </RecordForm>}
    </RecordDialog>
  </section>;
}
