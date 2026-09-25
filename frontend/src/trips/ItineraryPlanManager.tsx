import { useMemo, useState } from "react";

import { CheckboxField, RecordForm, requiredText, SelectField, TextAreaField, TextField } from "../forms/fields";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { addDays, formatDayRange, stayCoversNight, stayLabel, type ItineraryEntry, type ItineraryEntryKind, type ItineraryLinkKind, type Stay, type Trip } from "../tracker-model";

const KIND_LABELS: Record<ItineraryEntryKind, string> = { travel: "Reis", free: "Vrij", work: "Werk" };

type TripDates = Pick<Trip, "starts_on" | "ends_on">;

/** Every trip night an entry spans: none before departure, none on the final day. */
function entryNights(entry: ItineraryEntry, trip: TripDates): string[] {
  if (!entry.day_date) return [];
  const nights: string[] = [];
  for (let night = entry.day_date; night <= (entry.end_date ?? entry.day_date) && nights.length < 60; night = addDays(night, 1)) {
    if ((!trip.starts_on || night >= trip.starts_on) && (!trip.ends_on || night < trip.ends_on)) nights.push(night);
  }
  return nights;
}

/** Which stays the owner sleeps at during an entry, and how many nights lack one. */
export function overnights(entry: ItineraryEntry, stays: Stay[], trip: TripDates): { stays: Stay[]; uncovered: number } {
  const nights = entryNights(entry, trip);
  const covering = stays.filter((stay) => nights.some((night) => stayCoversNight(stay, night)));
  return { stays: covering, uncovered: nights.filter((night) => !stays.some((stay) => stayCoversNight(stay, night))).length };
}

const LINK_LABELS: Record<ItineraryLinkKind, string> = {
  stay: "Verblijf", transport_leg: "Vervoer", route_stage: "Halte", place: "Exacte plaats", document: "Document", travel_update: "Reisupdate",
};

const LINK_ANCHORS: Record<ItineraryLinkKind, string | null> = {
  stay: "#stays-title", transport_leg: "#transport-title", route_stage: "#route-stages-title", place: null, document: "#documents-title", travel_update: "#updates-title",
};

type Values = { dayDate: string; endDate: string; kind: ItineraryEntryKind | ""; tentative: boolean; title: string; notes: string; linkedKind: ItineraryLinkKind | ""; linkedId: string };
const blank = (): Values => ({ dayDate: "", endDate: "", kind: "", tentative: false, title: "", notes: "", linkedKind: "", linkedId: "" });
const fromEntry = (entry: ItineraryEntry): Values => ({ dayDate: entry.day_date ?? "", endDate: entry.end_date ?? "", kind: entry.kind ?? "", tentative: entry.tentative, title: entry.title, notes: entry.notes ?? "", linkedKind: entry.linked_kind ?? "", linkedId: entry.linked_id ?? "" });
const serverFields = { day_date: "dayDate", end_date: "endDate", kind: "kind", tentative: "tentative", title: "title", notes: "notes", linked_kind: "linkedKind", linked_id: "linkedId" };

type FormContext = { fieldApi: { form: { getFieldValue: (name: never) => unknown } } };
const linkedPart = ({ value, fieldApi }: { value: string } & FormContext) =>
  String(fieldApi.form.getFieldValue("linkedKind" as never) ?? "") && !value ? "Kies een gekoppeld onderdeel of laat het gekoppelde type leeg." : undefined;
const lastDay = ({ value, fieldApi }: { value: string } & FormContext) => {
  if (!value) return undefined;
  const first = String(fieldApi.form.getFieldValue("dayDate" as never) ?? "");
  return !first || value < first ? "De laatste dag volgt op de eerste dag." : undefined;
};

export function ItineraryPlanManager({ trip, onShowOnMap }: { trip: Trip; onShowOnMap?: (pointId: string) => void }) {
  const offline = useOfflineCopies();
  const entriesQuery = useTripResource(trip.id, "itinerary-entries");
  const staysQuery = useTripResource(trip.id, "stays");
  const legsQuery = useTripResource(trip.id, "transport-legs");
  const placesQuery = useTripResource(trip.id, "places");
  const documentsQuery = useTripResource(trip.id, "documents");
  const entries = useMemo(() => (entriesQuery.data ?? []).slice().sort((left, right) => left.position - right.position), [entriesQuery.data]);
  const stays = staysQuery.data ?? [];
  const legs = legsQuery.data ?? [];
  const places = placesQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const dialog = useRecordDialog(entries);
  const { selected, editing, editingId } = dialog;
  const [message, setMessage] = useState("De dagplanning is een private navigatiehulp; ze verwijst alleen naar reeds bestaande onderdelen.");
  const path = tripPath(trip.id, "itinerary-entries");
  const invalidate = (subject: string) => [ownerKeys.tripResource(subject, trip.id, "itinerary-entries")];

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, ItineraryEntry>({
    fallback: "De planningsstap kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${path}/${id}` : path, method: id ? "PATCH" : "POST", body: payload }),
    invalidate,
  });
  const move = useOwnerMutation<{ entry: ItineraryEntry; position: number }, ItineraryEntry>({
    fallback: "De planningsstap kon niet worden verplaatst.",
    request: ({ entry, position }) => ({ path: `${path}/${entry.id}`, method: "PATCH", body: { position } }),
    invalidate,
  });
  const remove = useOwnerMutation<ItineraryEntry>({
    fallback: "De planningsstap kon niet worden verwijderd.",
    request: (entry) => ({ path: `${path}/${entry.id}`, method: "DELETE" }),
    invalidate,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "De planningsstap kon niet worden opgeslagen.",
    serverFields,
    submit: async (values) => {
      const id = dialog.editingId ?? null;
      const payload = {
        day_date: values.dayDate || null,
        end_date: values.endDate && values.endDate !== values.dayDate ? values.endDate : null,
        kind: values.kind || null,
        tentative: values.tentative,
        title: values.title.trim(),
        notes: values.notes.trim() || null,
        linked_kind: values.linkedKind || null,
        linked_id: values.linkedKind ? values.linkedId : null,
        ...(id ? {} : { position: entries.length }),
      };
      await save.mutateAsync({ id, payload });
      // A pinned copy holds the previous version of the step.
      if (id) await offline.removeByResource("itinerary_entry", id);
    },
    onSuccess: () => { close(); setMessage("Planningsstap opgeslagen."); },
  });

  function close() { dialog.close(); record.load(blank()); }
  function create() { record.load(blank()); dialog.create(); }
  function edit(entry: ItineraryEntry) { record.load(fromEntry(entry)); dialog.edit(entry.id); }
  const fail = (fallback: string) => (error: unknown) => setMessage(errorMessage(error, fallback));

  function linkOptions(kind: ItineraryLinkKind): { id: string; label: string }[] {
    if (kind === "stay") return stays.map((stay) => ({ id: stay.id, label: `${stayLabel(stay)} · ${formatDayRange(stay.check_in_date, addDays(stay.check_out_date, -1))}` }));
    if (kind === "transport_leg") return legs.map((leg) => ({ id: leg.id, label: `${leg.departure_area?.label ?? leg.departure_place.locality ?? leg.departure_place.display_name ?? "?"} → ${leg.arrival_area?.label ?? leg.arrival_place.locality ?? leg.arrival_place.display_name ?? "?"}` }));
    if (kind === "route_stage") return trip.route_stages.map((stage) => ({ id: stage.id, label: stage.label ?? stage.place.label }));
    if (kind === "place") return places.map((place) => ({ id: place.id, label: place.display_name ?? place.locality ?? place.id }));
    if (kind === "document") return documents.map((document) => ({ id: document.id, label: document.title }));
    return trip.travel_updates.map((update) => ({ id: update.id, label: update.title }));
  }

  function resolveLink(entry: ItineraryEntry): { label: string; anchor: string | null } | null {
    if (!entry.linked_kind || !entry.linked_id) return null;
    const option = linkOptions(entry.linked_kind).find((candidate) => candidate.id === entry.linked_id);
    return { label: option ? `${LINK_LABELS[entry.linked_kind]}: ${option.label}` : `${LINK_LABELS[entry.linked_kind]} (verwijderd)`, anchor: option ? LINK_ANCHORS[entry.linked_kind] : null };
  }

  /** The map point for an entry's link: a stage's broad place or an exact place. */
  function mapPointFor(entry: ItineraryEntry): string | null {
    if (entry.linked_kind === "route_stage") return trip.route_stages.find((stage) => stage.id === entry.linked_id)?.place.id ?? null;
    if (entry.linked_kind === "place") return entry.linked_id;
    if (entry.linked_kind === "stay") {
      const stay = stays.find((candidate) => candidate.id === entry.linked_id);
      return stay?.place?.latitude != null ? stay.place.id : stay?.broad_place?.id ?? null;
    }
    if (entry.linked_kind === "transport_leg") return legs.find((leg) => leg.id === entry.linked_id)?.arrival_place.id ?? null;
    return null;
  }

  function shift(entry: ItineraryEntry, direction: -1 | 1) {
    const position = entry.position + direction;
    if (position < 0 || position >= entries.length) return;
    move.mutateAsync({ entry, position }).then(() => setMessage("Volgorde van de dagplanning opgeslagen."), fail("De planningsstap kon niet worden verplaatst."));
  }

  function erase(entry: ItineraryEntry) {
    remove.mutateAsync(entry)
      .then(async () => {
        await offline.removeByResource("itinerary_entry", entry.id);
        close();
        setMessage("Planningsstap verwijderd.");
      }, fail("De planningsstap kon niet worden verwijderd."));
  }

  async function toggleOffline(entry: ItineraryEntry) {
    if (offline.isPinned("itinerary_entry", entry.id)) {
      await offline.removeByResource("itinerary_entry", entry.id);
      setMessage(`“${entry.title}” is niet langer offline beschikbaar.`);
      return;
    }
    await offline.pin({
      resourceKind: "itinerary_entry",
      resourceId: entry.id,
      metadataUrl: `/api/trips/${trip.id}/itinerary-entries/${entry.id}`,
      title: entry.title,
      contentType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(entry)).buffer as ArrayBuffer,
    });
    setMessage(`“${entry.title}” is offline bewaard op dit toestel.`);
  }

  const readError = entriesQuery.error ?? staysQuery.error ?? legsQuery.error ?? placesQuery.error ?? documentsQuery.error;

  const dayLine = (entry: ItineraryEntry) => {
    const tags = [entry.kind ? KIND_LABELS[entry.kind] : null, entry.tentative ? "Concept" : null].filter(Boolean).join(" · ");
    return `${entry.day_date ? formatDayRange(entry.day_date, entry.end_date) : "Nog geen dag"}${tags ? ` · ${tags}` : ""}`;
  };

  /** What the step points at and where its nights are spent; the list links to the section, the dialog cannot. */
  function details(entry: ItineraryEntry, anchored: boolean) {
    const link = resolveLink(entry);
    const sleep = overnights(entry, stays, trip);
    const sleeping = sleep.stays.length > 0 || sleep.uncovered > 0;
    if (!link && !sleeping) return null;
    return <div className="entry-details">
      {link && <span className="entry-detail">{anchored && link.anchor ? <a href={link.anchor}>{link.label}</a> : link.label}</span>}
      {sleeping && <span className="entry-detail">Overnachting: {sleep.stays.map(stayLabel).join(", ") || "—"}{sleep.uncovered > 0 ? ` · nog ${sleep.uncovered} ${sleep.uncovered === 1 ? "nacht" : "nachten"} zonder verblijf` : ""}</span>}
    </div>;
  }

  return <section className="card manager" aria-labelledby="itinerary-title">
    <div className="capture-heading"><div><h3 id="itinerary-title">Dagplanning</h3><p>Een concept-planning die verwijst naar bestaande onderdelen. Ze blijft privé en kopieert nooit hun details.</p></div><button className="secondary compact" type="button" onClick={create}>Nieuwe stap</button></div>
    <p className="help" role="status">{readError ? errorMessage(readError, "Je dagplanning kon niet worden geladen.") : entriesQuery.isPending ? "Laad je private dagplanning…" : message}</p>
    {entries.length > 0 && <div className="saved-moments manager-list">{entries.map((entry, index) => {
      const mapPoint = onShowOnMap ? mapPointFor(entry) : null;
      return <article className={`excerpt-row stacked ${entry.tentative ? "tentative" : ""}`} key={entry.id}>
        <button className="document-select" type="button" onClick={() => dialog.inspect(entry.id)} aria-label={`Planningsstap ${entry.title} bekijken`}>
          <strong>{entry.title}</strong><span>{dayLine(entry)}{entry.notes ? ` · ${entry.notes}` : ""}</span>
        </button>
        {details(entry, true)}
        <div className="button-row">
          {mapPoint && <button className="secondary compact" type="button" onClick={() => onShowOnMap?.(mapPoint)}>Toon op kaart</button>}
          <button className="secondary compact" type="button" onClick={() => void toggleOffline(entry).catch(fail("De planningsstap kon niet offline worden bewaard."))}>{offline.isPinned("itinerary_entry", entry.id) ? "Offline verwijderen" : "Offline bewaren"}</button>
          <button className="secondary compact" type="button" disabled={index === 0} onClick={() => shift(entry, -1)}>Omhoog</button>
          <button className="secondary compact" type="button" disabled={index === entries.length - 1} onClick={() => shift(entry, 1)}>Omlaag</button>
        </div>
      </article>;
    })}</div>}
    {!entriesQuery.isPending && !entriesQuery.error && entries.length === 0 && <p>Nog geen planningsstappen. Voeg er één toe om je dagen te ordenen.</p>}
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Planningsstap bewerken" : "Planningsstap toevoegen") : "Planningsstap"} dirty={editing && record.dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form">
        <div><h3>{selected.title}</h3><p>{dayLine(selected)}</p>{selected.notes && <p>{selected.notes}</p>}{details(selected, false)}</div>
        <div className="button-row"><button type="button" onClick={() => edit(selected)}>Bewerken</button><button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>Verwijderen</button></div>
        {dialog.confirmDelete && <DeleteConfirmation title={`Planningsstap “${selected.title}” verwijderen?`} onCancel={() => dialog.setConfirmDelete(false)} onConfirm={() => erase(selected)} />}
      </div>}
      {editing && <RecordForm record={record} submitLabel={editingId ? "Stap opslaan" : "Stap toevoegen"} pendingLabel="Opslaan…">
        <div className="field-row">
          <record.form.Field name="dayDate">{(field) => <TextField field={field} label="Eerste dag" optional type="date" />}</record.form.Field>
          <record.form.Subscribe selector={(state) => state.values.dayDate}>{(dayDate) => <record.form.Field name="endDate" validators={{ onChangeListenTo: ["dayDate"], onChange: lastDay, onSubmit: lastDay }}>{(field) => <TextField field={field} label="Laatste dag" optional type="date" min={dayDate || undefined} disabled={!dayDate} />}</record.form.Field>}</record.form.Subscribe>
        </div>
        <record.form.Field name="title" validators={{ onChange: requiredText("Geef de stap een titel."), onSubmit: requiredText("Geef de stap een titel.") }}>{(field) => <TextField field={field} label="Titel" required maxLength={160} placeholder="Bijvoorbeeld: Aankomst Taipei" />}</record.form.Field>
        <div className="field-row">
          <record.form.Field name="kind">{(field) => <SelectField field={field} label="Soort dag" optional><option value="">Geen soort</option>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>}</record.form.Field>
          <record.form.Field name="tentative">{(field) => <CheckboxField field={field} label="Concept — kan nog verschuiven" />}</record.form.Field>
        </div>
        <record.form.Field name="notes">{(field) => <TextAreaField field={field} label="Notities" optional maxLength={4000} rows={3} />}</record.form.Field>
        <div className="field-row">
          <record.form.Field name="linkedKind" listeners={{ onChange: () => record.form.setFieldValue("linkedId", "") }}>{(field) => <SelectField field={field} label="Gekoppeld type" optional><option value="">Geen koppeling</option>{Object.entries(LINK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>}</record.form.Field>
          <record.form.Subscribe selector={(state) => state.values.linkedKind}>{(linkedKind) => linkedKind && <record.form.Field name="linkedId" validators={{ onChangeListenTo: ["linkedKind"], onSubmit: linkedPart }}>{(field) => <SelectField field={field} label="Gekoppeld onderdeel" required><option value="">Kies een onderdeel</option>{linkOptions(linkedKind).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</SelectField>}</record.form.Field>}</record.form.Subscribe>
        </div>
      </RecordForm>}
    </RecordDialog>
  </section>;
}
