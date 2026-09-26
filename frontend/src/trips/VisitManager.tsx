import { useMemo, useRef, useState } from "react";

import { CheckboxField, RecordForm, SelectField, TextAreaField, TextField } from "../forms/fields";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { addDays, formatDayRange, locationName, stayCoversNight, stayLabel, visitTitle, type Stay, type Trip, type Visit, type VisitKind } from "../tracker-model";
import { emptyPlace, hasPlace, PlacePicker, placeFields, placeOfVisit, samePlace, type PlaceValue } from "./PlacePicker";
import { VisibilityControl, visibilityLabel } from "./visibility";

const KIND_LABELS: Record<VisitKind, string> = { free: "Vrij", work: "Werk" };
const PRECISION_LABELS = { day: "Volledige datums", month: "Alleen maanden", year: "Alleen het jaar" } as const;

type TripDates = Pick<Trip, "starts_on" | "ends_on">;

/** Every trip night a visit spans: none before departure, none on the final day. */
function visitNights(visit: Pick<Visit, "starts_on" | "ends_on">, trip: TripDates): string[] {
  if (!visit.starts_on) return [];
  const nights: string[] = [];
  for (let night = visit.starts_on; night <= (visit.ends_on ?? visit.starts_on) && nights.length < 60; night = addDays(night, 1)) {
    if ((!trip.starts_on || night >= trip.starts_on) && (!trip.ends_on || night < trip.ends_on)) nights.push(night);
  }
  return nights;
}

/** Which stays the owner sleeps at during a visit, and how many nights lack one. */
export function overnights(visit: Pick<Visit, "starts_on" | "ends_on">, stays: Stay[], trip: TripDates): { stays: Stay[]; uncovered: number } {
  const nights = visitNights(visit, trip);
  const covering = stays.filter((stay) => nights.some((night) => stayCoversNight(stay, night)));
  return { stays: covering, uncovered: nights.filter((night) => !stays.some((stay) => stayCoversNight(stay, night))).length };
}

const clock = (time: string | null): string => time ? time.slice(0, 5) : "";

/** "21 nov – 22 nov · 18:30–21:00", or "Nog geen dag". */
export function visitWhen(visit: Pick<Visit, "starts_on" | "ends_on" | "start_time" | "end_time">): string {
  if (!visit.starts_on) return "Nog geen dag";
  const times = visit.start_time ? ` · ${clock(visit.start_time)}${visit.end_time ? `–${clock(visit.end_time)}` : ""}` : "";
  return `${formatDayRange(visit.starts_on, visit.ends_on)}${times}`;
}

/** Where a visit is: its location when it has one, else its area. */
const visitPlace = (visit: Pick<Visit, "area" | "location">): string => visit.location ? `${locationName(visit.location)} · ${visit.area.label}` : visit.area.label;

type Values = {
  place: PlaceValue; title: string; kind: VisitKind | "";
  startsOn: string; endsOn: string; startTime: string; endTime: string;
  notes: string; summary: string; shareTime: boolean; shareDatePrecision: Visit["share_date_precision"];
};

const blank = (): Values => ({ place: emptyPlace(), title: "", kind: "", startsOn: "", endsOn: "", startTime: "", endTime: "", notes: "", summary: "", shareTime: false, shareDatePrecision: "month" });
const fromVisit = (visit: Visit): Values => ({
  place: placeOfVisit(visit), title: visit.title ?? "", kind: visit.kind ?? "",
  startsOn: visit.starts_on ?? "", endsOn: visit.ends_on ?? "", startTime: clock(visit.start_time), endTime: clock(visit.end_time),
  notes: visit.notes ?? "", summary: visit.summary ?? "", shareTime: visit.share_time, shareDatePrecision: visit.share_date_precision,
});
const serverFields = { title: "title", kind: "kind", starts_on: "startsOn", ends_on: "endsOn", start_time: "startTime", end_time: "endTime", notes: "notes", summary: "summary", share_time: "shareTime", share_date_precision: "shareDatePrecision" };

type FormContext = { fieldApi: { form: { getFieldValue: (name: never) => unknown } } };
const lastDay = ({ value, fieldApi }: { value: string } & FormContext) => {
  if (!value) return undefined;
  const first = String(fieldApi.form.getFieldValue("startsOn" as never) ?? "");
  return !first || value < first ? "De laatste dag volgt op de eerste dag." : undefined;
};

export function VisitManager({ trip, onShowOnMap }: { trip: Trip; onShowOnMap?: (pointId: string) => void }) {
  const offline = useOfflineCopies();
  const visitsQuery = useTripResource(trip.id, "visits");
  const staysQuery = useTripResource(trip.id, "stays");
  const visits = useMemo(() => (visitsQuery.data ?? []).slice().sort((left, right) => left.position - right.position), [visitsQuery.data]);
  const stays = staysQuery.data ?? [];
  const dialog = useRecordDialog(visits);
  const { selected, editing, editingId } = dialog;
  const [message, setMessage] = useState("Een bezoek is een stop van je reis: een gebied of een locatie, en wanneer. Ze blijft privé tot je kiest wie ze ziet; tijden deel je alleen als je dat zelf aanvinkt.");
  // A place is only rewritten when the editor changed it.
  const baseline = useRef<Values>(blank());
  const path = tripPath(trip.id, "visits");
  // A new location can create a reusable location and its derived area.
  const invalidate = (subject: string) => [ownerKeys.tripResource(subject, trip.id, "visits"), ownerKeys.tripResource(subject, trip.id, "locations"), ownerKeys.tripResource(subject, trip.id, "areas")];

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, Visit>({
    fallback: "Het bezoek kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${path}/${id}` : path, method: id ? "PATCH" : "POST", body: payload }),
    invalidate,
  });
  const move = useOwnerMutation<{ visit: Visit; position: number }, Visit>({
    fallback: "Het bezoek kon niet worden verplaatst.",
    request: ({ visit, position }) => ({ path: `${path}/${visit.id}`, method: "PATCH", body: { position } }),
    invalidate,
  });
  const remove = useOwnerMutation<Visit>({
    fallback: "Het bezoek kon niet worden verwijderd.",
    request: (visit) => ({ path: `${path}/${visit.id}`, method: "DELETE" }),
    invalidate,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "Het bezoek kon niet worden opgeslagen.",
    serverFields,
    submit: async (values) => {
      const id = dialog.editingId ?? null;
      if (!hasPlace(values.place)) throw new Error("Kies waar het bezoek is: een gebied of een locatie.");
      if (values.startTime && !values.startsOn) throw new Error("Een tijd hoort bij een dag: kies eerst de eerste dag.");
      if (values.endTime && !values.startTime) throw new Error("Geef ook een begintijd op.");
      await save.mutateAsync({
        id,
        payload: {
          title: values.title.trim() || null,
          kind: values.kind || null,
          starts_on: values.startsOn || null,
          ends_on: values.endsOn && values.endsOn !== values.startsOn ? values.endsOn : null,
          start_time: values.startTime || null,
          end_time: values.endTime || null,
          notes: values.notes.trim() || null,
          summary: values.summary.trim() || null,
          share_time: values.shareTime,
          share_date_precision: values.shareDatePrecision,
          ...(!id || !samePlace(values.place, baseline.current.place) ? placeFields(values.place) : {}),
          ...(id ? {} : { position: visits.length }),
        },
      });
      // A pinned copy holds the previous version of the visit.
      if (id) await offline.removeByResource("visit", id);
    },
    onSuccess: () => { close(); setMessage("Bezoek opgeslagen."); },
  });

  function load(values: Values) { baseline.current = values; record.load(values); }
  function close() { dialog.close(); load(blank()); }
  function create() { load(blank()); dialog.create(); }
  function edit(visit: Visit) { load(fromVisit(visit)); dialog.edit(visit.id); }
  const fail = (fallback: string) => (error: unknown) => setMessage(errorMessage(error, fallback));

  /** The map point for a visit: its location when that has a point, else its area. */
  const mapPointFor = (visit: Visit): string => visit.location?.latitude != null ? visit.location.id : visit.area.id;

  function shift(visit: Visit, direction: -1 | 1) {
    const position = visit.position + direction;
    if (position < 0 || position >= visits.length) return;
    move.mutateAsync({ visit, position }).then(() => setMessage("Volgorde van de bezoeken opgeslagen."), fail("Het bezoek kon niet worden verplaatst."));
  }

  function erase(visit: Visit) {
    remove.mutateAsync(visit)
      .then(async () => {
        await offline.removeByResource("visit", visit.id);
        close();
        setMessage("Bezoek verwijderd.");
      }, fail("Het bezoek kon niet worden verwijderd."));
  }

  async function toggleOffline(visit: Visit) {
    if (offline.isPinned("visit", visit.id)) {
      await offline.removeByResource("visit", visit.id);
      setMessage(`“${visitTitle(visit)}” is niet langer offline beschikbaar.`);
      return;
    }
    await offline.pin({
      resourceKind: "visit",
      resourceId: visit.id,
      metadataUrl: `/api/trips/${trip.id}/visits/${visit.id}`,
      title: visitTitle(visit),
      contentType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(visit)).buffer as ArrayBuffer,
    });
    setMessage(`“${visitTitle(visit)}” is offline bewaard op dit toestel.`);
  }

  const readError = visitsQuery.error ?? staysQuery.error;

  const dayLine = (visit: Visit) => {
    const tags = visit.kind ? KIND_LABELS[visit.kind] : "";
    return `${visitWhen(visit)}${tags ? ` · ${tags}` : ""}`;
  };

  /** Where the nights of a visit are spent. */
  function sleeping(visit: Visit) {
    const sleep = overnights(visit, stays, trip);
    if (!sleep.stays.length && !sleep.uncovered) return null;
    return <div className="entry-details"><span className="entry-detail">Overnachting: {sleep.stays.map(stayLabel).join(", ") || "—"}{sleep.uncovered > 0 ? ` · nog ${sleep.uncovered} ${sleep.uncovered === 1 ? "nacht" : "nachten"} zonder verblijf` : ""}</span></div>;
  }

  return <section className="card manager" aria-labelledby="visits-title">
    <div className="capture-heading"><div><h3 id="visits-title">Bezoeken</h3><p>De stops van je reis: een gebied of een locatie, en wanneer je er bent. Deel ze om bezoekers te laten volgen waar je heen gaat.</p></div><button className="secondary compact" type="button" onClick={create}>Nieuw bezoek</button></div>
    <p className="help" role="status">{readError ? errorMessage(readError, "Je bezoeken konden niet worden geladen.") : visitsQuery.isPending ? "Laad je bezoeken…" : message}</p>
    {visits.length > 0 && <div className="saved-records manager-list">{visits.map((visit, index) => <article className="excerpt-row stacked" key={visit.id}>
      <button className="document-select" type="button" onClick={() => dialog.inspect(visit.id)} aria-label={`Bezoek ${visitTitle(visit)} bekijken`}>
        <strong>{visitTitle(visit)}</strong><span>{[dayLine(visit), visitPlace(visit), visibilityLabel(visit.visibility)].join(" · ")}</span>
      </button>
      {sleeping(visit)}
      <div className="button-row">
        {onShowOnMap && <button className="secondary compact" type="button" onClick={() => onShowOnMap(mapPointFor(visit))}>Toon op kaart</button>}
        <button className="secondary compact" type="button" onClick={() => void toggleOffline(visit).catch(fail("Het bezoek kon niet offline worden bewaard."))}>{offline.isPinned("visit", visit.id) ? "Offline verwijderen" : "Offline bewaren"}</button>
        <button className="secondary compact" type="button" disabled={index === 0} onClick={() => shift(visit, -1)}>Omhoog</button>
        <button className="secondary compact" type="button" disabled={index === visits.length - 1} onClick={() => shift(visit, 1)}>Omlaag</button>
      </div>
    </article>)}</div>}
    {!visitsQuery.isPending && !visitsQuery.error && visits.length === 0 && <p>Nog geen bezoeken. Voeg er één toe om je reis te ordenen.</p>}
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Bezoek bewerken" : "Bezoek toevoegen") : "Bezoek"} dirty={editing && record.dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form">
        <div><h3>{visitTitle(selected)}</h3><p>{dayLine(selected)}</p><p>{visitPlace(selected)}</p>{selected.summary && <p>Voor bezoekers: {selected.summary}</p>}{selected.notes && <p>{selected.notes}</p>}{sleeping(selected)}</div>
        <VisibilityControl tripId={trip.id} kind="visit" id={selected.id} value={selected.visibility} name={visitTitle(selected)} />
        <p className="help">{selected.start_time ? (selected.share_time ? "Bezoekers zien ook de tijd, omdat je dat hebt aangevinkt en de datum volledig deelt." : "De tijd blijft privé.") : "Dit bezoek heeft geen tijd."} Notities blijven altijd privé.</p>
        <div className="button-row"><button type="button" onClick={() => edit(selected)}>Bewerken</button><button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>Verwijderen</button></div>
        {dialog.confirmDelete && <DeleteConfirmation title={`Bezoek “${visitTitle(selected)}” verwijderen?`} onCancel={() => dialog.setConfirmDelete(false)} onConfirm={() => erase(selected)} />}
      </div>}
      {editing && <RecordForm record={record} submitLabel={editingId ? "Bezoek opslaan" : "Bezoek toevoegen"} pendingLabel="Opslaan…">
        <record.form.Field name="place">{(field) => <PlacePicker tripId={trip.id} label="Waar" value={field.state.value} onChange={(value) => field.handleChange(value)} />}</record.form.Field>
        <record.form.Field name="title">{(field) => <TextField field={field} label="Titel" optional maxLength={160} placeholder="Zonder titel heet het bezoek naar de plek" />}</record.form.Field>
        <div className="field-row">
          <record.form.Field name="startsOn">{(field) => <TextField field={field} label="Eerste dag" optional type="date" />}</record.form.Field>
          <record.form.Subscribe selector={(state) => state.values.startsOn}>{(startsOn) => <record.form.Field name="endsOn" validators={{ onChangeListenTo: ["startsOn"], onChange: lastDay, onSubmit: lastDay }}>{(field) => <TextField field={field} label="Laatste dag" optional type="date" min={startsOn || undefined} disabled={!startsOn} />}</record.form.Field>}</record.form.Subscribe>
        </div>
        <record.form.Subscribe selector={(state) => state.values.startsOn}>{(startsOn) => <div className="field-row">
          <record.form.Field name="startTime">{(field) => <TextField field={field} label="Begintijd" optional type="time" disabled={!startsOn} />}</record.form.Field>
          <record.form.Field name="endTime">{(field) => <TextField field={field} label="Eindtijd" optional type="time" disabled={!startsOn} />}</record.form.Field>
        </div>}</record.form.Subscribe>
        <p className="help">Tijden zijn lokaal bij het bezoek, in de tijdzone van het gebied. Bezoekers thuis zien ze erbij omgerekend, als je ze deelt.</p>
        <div className="field-row">
          <record.form.Field name="kind">{(field) => <SelectField field={field} label="Soort dag" optional><option value="">Geen soort</option>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>}</record.form.Field>
        </div>
        <record.form.Field name="notes">{(field) => <TextAreaField field={field} label="Notities" optional="(optioneel, altijd privé)" maxLength={4000} rows={3} />}</record.form.Field>
        <record.form.Field name="summary">{(field) => <TextAreaField field={field} label="Tekst voor bezoekers" optional maxLength={2000} rows={3} placeholder="Wat mogen bezoekers over dit bezoek lezen?" />}</record.form.Field>
        <div className="field-row">
          <record.form.Field name="shareDatePrecision">{(field) => <SelectField field={field} label="Datums voor bezoekers">{Object.entries(PRECISION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>}</record.form.Field>
          <record.form.Field name="shareTime">{(field) => <CheckboxField field={field} label={<>Toon de tijd aan bezoekers <small>Alleen bij volledige datums.</small></>} />}</record.form.Field>
        </div>
      </RecordForm>}
    </RecordDialog>
  </section>;
}
