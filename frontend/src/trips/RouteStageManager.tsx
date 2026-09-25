import { useState } from "react";

import { RecordForm, SelectField, TextAreaField, TextField } from "../forms/fields";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import type { BroadPlace, RouteStage, Trip } from "../tracker-model";
import { VisibilityControl, visibilityLabel } from "./visibility";

type Values = { broadPlaceId: string; label: string; summary: string };
const blank = (): Values => ({ broadPlaceId: "", label: "", summary: "" });
const fromStage = (stage: RouteStage): Values => ({ broadPlaceId: stage.place.id, label: stage.label ?? "", summary: stage.summary ?? "" });
const serverFields = { broad_place_id: "broadPlaceId", label: "label", summary: "summary" };
const needsPlace = ({ value }: { value: string }) => value ? undefined : "Kies eerst een plaats.";

/** Route stages are embedded in the trip, so every write refreshes the trip list. */
export function RouteStageManager({ trip, broadPlaces }: { trip: Trip; broadPlaces: BroadPlace[] }) {
  const stages = trip.route_stages.slice().sort((a, b) => a.position - b.position);
  const dialog = useRecordDialog(stages);
  const [message, setMessage] = useState("Haltes gebruiken algemene plaatsen; exacte adressen horen hier niet thuis.");
  const path = tripPath(trip.id, "route-stages");
  const invalidate = (subject: string) => [ownerKeys.trips(subject)];

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, RouteStage>({
    fallback: "De halte kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${path}/${id}` : path, method: id ? "PATCH" : "POST", body: payload }),
    invalidate,
  });
  const move = useOwnerMutation<{ stage: RouteStage; position: number }, RouteStage>({
    fallback: "De halte kon niet worden verplaatst.",
    request: ({ stage, position }) => ({ path: `${path}/${stage.id}`, method: "PATCH", body: { position } }),
    invalidate,
  });
  const remove = useOwnerMutation<RouteStage>({
    fallback: "De halte kon niet worden verwijderd.",
    request: (stage) => ({ path: `${path}/${stage.id}`, method: "DELETE" }),
    invalidate,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "De halte kon niet worden opgeslagen.",
    serverFields,
    submit: async (values) => {
      const details = { broad_place_id: values.broadPlaceId, label: values.label.trim() || null, summary: values.summary.trim() || null };
      await save.mutateAsync({ id: dialog.editingId ?? null, payload: dialog.editingId ? details : { ...details, position: stages.length } });
    },
    onSuccess: () => { close(); setMessage("Halte opgeslagen. Hij blijft privé totdat je hem expliciet deelt."); },
  });

  function close() { dialog.close(); record.load(blank()); }
  function create() { record.load(blank()); dialog.create(); }
  function edit(stage: RouteStage) { record.load(fromStage(stage)); dialog.edit(stage.id); }
  const fail = (fallback: string) => (error: unknown) => setMessage(errorMessage(error, fallback));
  function shift(stage: RouteStage, direction: -1 | 1) {
    const position = stage.position + direction;
    if (position < 0 || position >= stages.length) return;
    move.mutateAsync({ stage, position }).catch(fail("De halte kon niet worden verplaatst."));
  }
  function erase(stage: RouteStage) {
    remove.mutateAsync(stage).then(() => { close(); setMessage("Halte verwijderd."); }, fail("De halte kon niet worden verwijderd."));
  }
  const { selected, editing, editingId } = dialog;
  const stageName = (stage: RouteStage) => stage.label ?? stage.place.label;

  return <section className="card manager" aria-labelledby="route-stages-title">
    <div className="capture-heading"><div><h3 id="route-stages-title">Haltes</h3><p>Een halte is een plaats in de volgorde van je reis. Je kiest zelf later of je die deelt.</p></div><button className="secondary compact" type="button" onClick={create}>Nieuwe halte</button></div>
    <p className="help" role="status">{message}</p>
    {stages.length > 0 && <div className="saved-moments manager-list">{stages.map((stage, index) => <article className="excerpt-row" key={stage.id}>
      <button className="document-select" type="button" onClick={() => dialog.inspect(stage.id)} aria-label={`Halte ${stageName(stage)} bekijken`}><strong>{stageName(stage)}</strong><span>{stage.place.label} · halte {index + 1} · {visibilityLabel(stage.visibility)}{stage.summary ? ` · ${stage.summary}` : ""}</span></button>
      <div className="button-row"><button className="secondary compact" type="button" disabled={index === 0} onClick={() => shift(stage, -1)}>Omhoog</button><button className="secondary compact" type="button" disabled={index === stages.length - 1} onClick={() => shift(stage, 1)}>Omlaag</button></div>
    </article>)}</div>}
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Halte bewerken" : "Halte toevoegen") : "Halte"} dirty={editing && record.dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form">
        <div><h3>{stageName(selected)}</h3><p>{selected.place.label}</p>{selected.summary && <p>{selected.summary}</p>}</div>
        <VisibilityControl tripId={trip.id} kind="route_stage" id={selected.id} value={selected.visibility} name={stageName(selected)} />
        <div className="button-row"><button type="button" onClick={() => edit(selected)}>Bewerken</button><button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>Verwijderen</button></div>
        {dialog.confirmDelete && <DeleteConfirmation title={`Halte “${stageName(selected)}” verwijderen?`} onCancel={() => dialog.setConfirmDelete(false)} onConfirm={() => erase(selected)} />}
      </div>}
      {editing && <RecordForm record={record} submitLabel={editingId ? "Halte opslaan" : "Halte toevoegen"} pendingLabel="Opslaan…">
        <record.form.Field name="broadPlaceId" validators={{ onChange: needsPlace, onSubmit: needsPlace }}>{(field) => <SelectField field={field} label="Plaats" required><option value="">Kies een plaats</option>{broadPlaces.map((place) => <option key={place.id} value={place.id}>{place.label}{place.region ? ` · ${place.region}` : ""}</option>)}</SelectField>}</record.form.Field>
        {!broadPlaces.length && <p className="help">Maak eerst een plaats; exacte adressen zijn hier bewust niet beschikbaar.</p>}
        <record.form.Field name="label">{(field) => <TextField field={field} label="Naam van halte" optional maxLength={120} placeholder="Bijvoorbeeld: noordkust" />}</record.form.Field>
        <record.form.Field name="summary">{(field) => <TextAreaField field={field} label="Korte beschrijving" optional="(optioneel, zichtbaar als je de halte deelt)" maxLength={2000} rows={2} placeholder="Bijvoorbeeld: stad, eten en een eerste weekend in het noorden" />}</record.form.Field>
      </RecordForm>}
    </RecordDialog>
  </section>;
}
