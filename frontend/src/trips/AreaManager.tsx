import { useState } from "react";

import { RecordForm, requiredText, TextField } from "../forms/fields";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { timeZoneOptions, type Area, type PlaceSearchResult, type Trip } from "../tracker-model";
import { VisibilityControl, visibilityLabel } from "./visibility";
import { PlaceSearchField } from "./PlaceSearchField";
import { AreaContents } from "./AreaContents";

type Values = { label: string; countryCode: string; region: string; latitude: string; longitude: string; timezone: string };
const blank = (): Values => ({ label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" });
const fromArea = (area: Area): Values => ({ label: area.label, countryCode: area.country_code ?? "", region: area.region ?? "", latitude: area.latitude?.toString() ?? "", longitude: area.longitude?.toString() ?? "", timezone: area.timezone ?? "" });
const serverFields = { label: "label", country_code: "countryCode", region: "region", latitude: "latitude", longitude: "longitude", timezone: "timezone" };

const bothCoordinates = ({ value, fieldApi }: { value: string; fieldApi: { form: { getFieldValue: (name: never) => unknown } } }) =>
  (value === "") !== (String(fieldApi.form.getFieldValue("longitude" as never) ?? "") === "") ? "Vul beide kaartcoördinaten in of laat beide leeg." : undefined;
const areaCoordinate = (value: number) => (Math.round(value * 100) / 100).toString();

export function AreaManager({ trip }: { trip: Trip }) {
  const areasQuery = useTripResource(trip.id, "areas");
  const areas = areasQuery.data ?? [];
  const dialog = useRecordDialog(areas);
  const [message, setMessage] = useState("Een gebied is een stad of regio, zonder adres. Het is niet automatisch openbaar.");

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, Area>({
    fallback: "Het gebied kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${tripPath(trip.id, "areas")}/${id}` : tripPath(trip.id, "areas"), method: id ? "PATCH" : "POST", body: payload }),
    // Visits, stays and reisupdates embed the area, so the trip is refreshed with it.
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "areas"), ownerKeys.trips(subject)],
  });
  const remove = useOwnerMutation<Area>({
    fallback: "Het gebied kon niet worden verwijderd.",
    request: (area) => ({ path: `${tripPath(trip.id, "areas")}/${area.id}`, method: "DELETE" }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "areas"), ownerKeys.trips(subject)],
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "Het gebied kon niet worden opgeslagen.",
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
    onSuccess: () => { close(); setMessage("Gebied opgeslagen. Je kunt het bewust aan een bezoek, reisupdate of verblijf koppelen."); },
  });

  function close() { dialog.close(); record.load(blank()); }
  function create() { record.load(blank()); dialog.create(); }
  function edit(area: Area) { record.load(fromArea(area)); dialog.edit(area.id); }
  function erase(area: Area) {
    remove.mutateAsync(area).then(
      () => { close(); setMessage("Gebied verwijderd."); },
      (error: unknown) => setMessage(errorMessage(error, "Het gebied kon niet worden verwijderd.")),
    );
  }
  function useSearchResult(result: PlaceSearchResult) {
    record.form.setFieldValue("label", result.locality ?? result.admin_area ?? result.display_name ?? "");
    record.form.setFieldValue("countryCode", result.country_code ?? "");
    record.form.setFieldValue("region", result.admin_area ?? "");
    // A Nominatim result can be a precise POI. Areas deliberately use a
    // roughly kilometre-sized map point; the owner can still edit every field.
    record.form.setFieldValue("latitude", typeof result.latitude === "number" ? areaCoordinate(result.latitude) : "");
    record.form.setFieldValue("longitude", typeof result.longitude === "number" ? areaCoordinate(result.longitude) : "");
  }

  const summary = (area: Area) => [area.region, area.country_code, area.timezone].filter(Boolean).join(" · ") || "Alleen voor deze reis";
  const { selected, editing, editingId } = dialog;

  return <section className="card manager" aria-labelledby="areas-title">
    <div className="capture-heading"><div><h3 id="areas-title">Gebieden</h3><p>Een stad of regio die je kunt hergebruiken. Locaties, verblijven, reisupdates en vervoer horen bij een gebied. Een gebied is privé tot je kiest wie het ziet en deelt nooit automatisch zijn locaties.</p></div><button className="secondary compact" type="button" onClick={create}>Gebied toevoegen</button></div>
    <p className="help" role="status">{areasQuery.error ? errorMessage(areasQuery.error, "Je gebieden konden niet worden geladen.") : message}</p>
    {areas.length ? <div className="saved-records manager-list">{areas.map((area) => <article className="excerpt-row" key={area.id}>
      <button className="document-select" type="button" onClick={() => dialog.inspect(area.id)} aria-label={`Gebied ${area.label} bekijken`}><strong>{area.label}</strong><span>{summary(area)} · {visibilityLabel(area.visibility)}</span></button>
    </article>)}</div> : !areasQuery.isPending && <p>Nog geen gebieden.</p>}
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Gebied bewerken" : "Gebied toevoegen") : "Gebied"} dirty={editing && record.dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form">
        <div><h3>{selected.label}</h3><p>{summary(selected)}</p>{selected.latitude !== null && selected.longitude !== null && <p>Kaartpunt: {selected.latitude}, {selected.longitude}</p>}</div>
        <AreaContents trip={trip} area={selected} />
        <VisibilityControl tripId={trip.id} kind="area" id={selected.id} value={selected.visibility} name={selected.label} />
        <div className="button-row"><button type="button" onClick={() => edit(selected)}>Bewerken</button><button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>Verwijderen</button></div>
        {dialog.confirmDelete && <DeleteConfirmation title={`Gebied “${selected.label}” verwijderen?`} description="Dit kan alleen wanneer het gebied niet meer in een bezoek, reisupdate, locatie, verblijf of route wordt gebruikt. Een eventuele losse selectie voor delen wordt ook verwijderd." onCancel={() => dialog.setConfirmDelete(false)} onConfirm={() => erase(selected)} />}
      </div>}
      {editing && <RecordForm record={record} submitLabel="Gebied opslaan" pendingLabel="Opslaan…">
        <PlaceSearchField tripId={trip.id} legend="Stad of regio zoeken" inputLabel="Zoek stad of regio" placeholder="Bijvoorbeeld: Taipei" help="Gebruik dit voor een stad of regio. Een resultaat wordt pas bij opslaan bewaard en het punt wordt op ongeveer één kilometer afgerond." onSelect={useSearchResult} />
        <div className="field-row">
          <record.form.Field name="label" validators={{ onChange: requiredText("Geef het gebied een naam."), onSubmit: requiredText("Geef het gebied een naam.") }}>{(field) => <TextField field={field} label="Naam" required maxLength={120} />}</record.form.Field>
          <record.form.Field name="countryCode">{(field) => <TextField field={field} label="Landcode" optional maxLength={2} />}</record.form.Field>
        </div>
        <div className="field-row">
          <record.form.Field name="region">{(field) => <TextField field={field} label="Regio" optional maxLength={120} />}</record.form.Field>
          <record.form.Field name="timezone">{(field) => <TextField field={field} label="Tijdzone" optional="(optioneel, privé)" list="area-time-zones" maxLength={64} />}</record.form.Field>
        </div>
        <datalist id="area-time-zones">{timeZoneOptions().map((zone) => <option key={zone} value={zone} />)}</datalist>
        <div className="field-row">
          <record.form.Field name="latitude" validators={{ onChangeListenTo: ["longitude"], onChange: bothCoordinates, onSubmit: bothCoordinates }}>{(field) => <TextField field={field} label="Breedtegraad" optional type="number" min={-90} max={90} step="any" />}</record.form.Field>
          <record.form.Field name="longitude">{(field) => <TextField field={field} label="Lengtegraad" optional type="number" min={-180} max={180} step="any" />}</record.form.Field>
        </div>
      </RecordForm>}
    </RecordDialog>
  </section>;
}
