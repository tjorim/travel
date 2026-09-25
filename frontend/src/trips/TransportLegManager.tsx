import { useRef, useState } from "react";

import { RecordForm, requiredText, SelectField, TextAreaField, TextField } from "../forms/fields";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { browserTimeZone, daysBetween, localDate, localDateTime, timeZoneOptions, wallClock, type ExactPlaceInput, type PlaceSearchResult, type TransportLeg, type Trip } from "../tracker-model";
import { VisibilityControl, visibilityLabel } from "./visibility";
import { PlaceSearchField } from "./PlaceSearchField";

const KIND_LABELS: Record<TransportLeg["kind"], string> = {
  flight: "Vlucht", train: "Trein", bus: "Bus", ferry: "Veerboot", car: "Auto", other: "Anders",
};

const STATUS_LABELS: Record<TransportLeg["status"], string> = {
  planned: "Gepland", booked: "Geboekt", confirmed: "Bevestigd", cancelled: "Geannuleerd",
};

/** "16 nov 10:40" in the endpoint's own zone (browser zone for older legs). */
function endpointTime(instant: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat("nl-BE", { timeZone: timeZone ?? undefined, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(instant));
}

/** The archive's "+1 dag": calendar days between local departure and arrival. */
export function dayShift(leg: Pick<TransportLeg, "departs_at" | "arrives_at" | "departure_timezone" | "arrival_timezone">): number {
  return daysBetween(localDate(leg.departs_at, leg.departure_timezone), localDate(leg.arrives_at, leg.arrival_timezone));
}

type Values = {
  kind: TransportLeg["kind"]; status: TransportLeg["status"];
  departsAt: string; arrivesAt: string; departureTimezone: string; arrivalTimezone: string; travelClass: string;
  departureName: string; departureLocality: string; departureCountryCode: string;
  arrivalName: string; arrivalLocality: string; arrivalCountryCode: string;
  departurePlace: ExactPlaceInput | null; arrivalPlace: ExactPlaceInput | null;
  carrier: string; serviceReference: string; bookingReference: string; notes: string;
  documentAssetIds: string[];
};

function blank(): Values {
  const zone = browserTimeZone();
  return {
    kind: "flight", status: "planned",
    departsAt: localDateTime(), arrivesAt: localDateTime(new Date(Date.now() + 3_600_000)),
    departureTimezone: zone, arrivalTimezone: zone, travelClass: "",
    departureName: "", departureLocality: "", departureCountryCode: "",
    arrivalName: "", arrivalLocality: "", arrivalCountryCode: "",
    departurePlace: null, arrivalPlace: null,
    carrier: "", serviceReference: "", bookingReference: "", notes: "",
    documentAssetIds: [],
  };
}

const exactPlace = (place: TransportLeg["departure_place"]): ExactPlaceInput => {
  return { existing_place_id: place.id };
};

const fromLeg = (leg: TransportLeg): Values => ({
  kind: leg.kind, status: leg.status,
  departsAt: wallClock(leg.departs_at, leg.departure_timezone), arrivesAt: wallClock(leg.arrives_at, leg.arrival_timezone),
  departureTimezone: leg.departure_timezone ?? browserTimeZone(), arrivalTimezone: leg.arrival_timezone ?? browserTimeZone(), travelClass: leg.travel_class ?? "",
  departureName: leg.departure_place.display_name ?? "", departureLocality: leg.departure_place.locality ?? "", departureCountryCode: leg.departure_place.country_code ?? "",
  arrivalName: leg.arrival_place.display_name ?? "", arrivalLocality: leg.arrival_place.locality ?? "", arrivalCountryCode: leg.arrival_place.country_code ?? "",
  departurePlace: exactPlace(leg.departure_place), arrivalPlace: exactPlace(leg.arrival_place),
  carrier: leg.carrier ?? "", serviceReference: leg.service_reference ?? "", bookingReference: leg.booking_reference ?? "", notes: leg.notes ?? "",
  documentAssetIds: [...leg.document_asset_ids],
});

const serverFields = {
  kind: "kind", status: "status", departs_at: "departsAt", arrives_at: "arrivesAt", departure_timezone: "departureTimezone", arrival_timezone: "arrivalTimezone",
  carrier: "carrier", service_reference: "serviceReference", travel_class: "travelClass", booking_reference: "bookingReference", notes: "notes",
};
const DEPARTURE_FIELDS = ["departureName", "departureLocality", "departureCountryCode", "departurePlace"] as const;
const ARRIVAL_FIELDS = ["arrivalName", "arrivalLocality", "arrivalCountryCode", "arrivalPlace"] as const;

function endpointPlace(selected: ExactPlaceInput | null, name: string, locality: string, countryCode: string): ExactPlaceInput {
  if (selected?.existing_place_id) return { existing_place_id: selected.existing_place_id };
  return {
    ...selected,
    display_name: name.trim() || null,
    locality: locality.trim() || null,
    country_code: countryCode.trim().toUpperCase() || null,
  };
}

export function TransportLegManager({ trip }: { trip: Trip }) {
  const legsQuery = useTripResource(trip.id, "transport-legs");
  const documentsQuery = useTripResource(trip.id, "documents");
  const legs = legsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const dialog = useRecordDialog(legs);
  const [message, setMessage] = useState("Vluchten en ander vervoer blijven private details tot je bewust een vervoeronderdeel of route deelt.");
  const [deleteTarget, setDeleteTarget] = useState<TransportLeg | null>(null);
  // An endpoint's place is only rewritten when one of its fields differs from what the editor opened with.
  const baseline = useRef<Values>(blank());
  // A new endpoint can create a reusable spot and its derived area.
  const refreshLegs = (subject: string) => [ownerKeys.tripResource(subject, trip.id, "transport-legs"), ownerKeys.tripResource(subject, trip.id, "places"), ownerKeys.tripResource(subject, trip.id, "places/broad")];

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, TransportLeg>({
    fallback: "Het transportonderdeel kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${tripPath(trip.id, "transport-legs")}/${id}` : tripPath(trip.id, "transport-legs"), method: id ? "PATCH" : "POST", body: payload }),
    invalidate: refreshLegs,
  });
  const remove = useOwnerMutation<TransportLeg>({
    fallback: "Het transportonderdeel kon niet worden verwijderd.",
    request: (leg) => ({ path: `${tripPath(trip.id, "transport-legs")}/${leg.id}`, method: "DELETE" }),
    invalidate: refreshLegs,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "Het transportonderdeel kon niet worden opgeslagen.",
    serverFields,
    submit: async (values) => {
      const id = dialog.editingId ?? null;
      const changed = (names: readonly (keyof Values)[]) => names.some((name) => values[name] !== baseline.current[name]);
      await save.mutateAsync({
        id,
        payload: {
          kind: values.kind,
          status: values.status,
          // Local wall-clock times; the server resolves them in each endpoint's zone.
          departs_at: `${values.departsAt}:00`,
          arrives_at: `${values.arrivesAt}:00`,
          departure_timezone: values.departureTimezone,
          arrival_timezone: values.arrivalTimezone,
          carrier: values.carrier.trim() || null,
          service_reference: values.serviceReference.trim() || null,
          travel_class: values.travelClass.trim() || null,
          booking_reference: values.bookingReference.trim() || null,
          notes: values.notes.trim() || null,
          document_asset_ids: values.documentAssetIds,
          ...(!id || changed(DEPARTURE_FIELDS) ? { departure_place: endpointPlace(values.departurePlace, values.departureName, values.departureLocality, values.departureCountryCode) } : {}),
          ...(!id || changed(ARRIVAL_FIELDS) ? { arrival_place: endpointPlace(values.arrivalPlace, values.arrivalName, values.arrivalLocality, values.arrivalCountryCode) } : {}),
        },
      });
    },
    onSuccess: () => { close(); setMessage("Privétransport opgeslagen."); },
  });

  function load(values: Values) { baseline.current = values; record.load(values); }
  function close() { dialog.close(); load(blank()); }
  function create() { load(blank()); dialog.create(); }
  function edit(leg: TransportLeg) { load(fromLeg(leg)); dialog.edit(leg.id); }
  function usePlaceResult(endpoint: "departure" | "arrival", result: PlaceSearchResult, existingPlace?: TransportLeg["departure_place"]) {
    const place = existingPlace ?? result;
    if (endpoint === "departure") {
      record.form.setFieldValue("departureName", place.display_name ?? "");
      record.form.setFieldValue("departureLocality", place.locality ?? "");
      record.form.setFieldValue("departureCountryCode", place.country_code ?? "");
      record.form.setFieldValue("departurePlace", result);
    } else {
      record.form.setFieldValue("arrivalName", place.display_name ?? "");
      record.form.setFieldValue("arrivalLocality", place.locality ?? "");
      record.form.setFieldValue("arrivalCountryCode", place.country_code ?? "");
      record.form.setFieldValue("arrivalPlace", result);
    }
  }
  function confirmDelete(leg: TransportLeg) {
    remove.mutateAsync(leg).then(() => { close(); setDeleteTarget(null); setMessage("Privétransport verwijderd."); }, (error: unknown) => { setDeleteTarget(null); setMessage(errorMessage(error, "Het transportonderdeel kon niet worden verwijderd.")); });
  }

  const title = (leg: TransportLeg) => `${KIND_LABELS[leg.kind]}: ${leg.departure_area?.label ?? leg.departure_place.locality ?? leg.departure_place.display_name ?? "?"} → ${leg.arrival_area?.label ?? leg.arrival_place.locality ?? leg.arrival_place.display_name ?? "?"}`;
  const { selected, editing, editingId } = dialog;
  const readError = legsQuery.error ?? documentsQuery.error;

  return <section className="card manager" aria-labelledby="transport-title">
    <div className="capture-heading"><div><h3 id="transport-title">Vluchten &amp; ander vervoer</h3><p>Vluchtnummers, exacte tijden en boekingsreferenties zijn uitsluitend privé. Een gedeeld vervoeronderdeel is een bewuste, afzonderlijke keuze.</p></div><button className="secondary compact" type="button" onClick={create}>Nieuw onderdeel</button></div>
    <p className="help" role="status">{readError ? errorMessage(readError, "Je transportonderdelen konden niet worden geladen.") : legsQuery.isPending ? "Laad je private transportonderdelen…" : message}</p>
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Transportonderdeel bewerken" : "Transportonderdeel toevoegen") : "Transportonderdeel"} dirty={editing && record.dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form">
        <div><h3>{title(selected)}</h3><p>{endpointTime(selected.departs_at, selected.departure_timezone)} → {endpointTime(selected.arrives_at, selected.arrival_timezone)}</p><p>{selected.booking_reference ? `Boekingsreferentie: ${selected.booking_reference}` : "Geen boekingsreferentie"}</p></div>
        <VisibilityControl tripId={trip.id} kind="transport_leg" id={selected.id} value={selected.visibility} name={title(selected)} />
        <p className="help">Bezoekers zien nooit je boekingscode, klasse, notities of documenten. Het vertrek- en aankomstpunt staat alleen op de kaart als je die plaats zelf deelt.</p>
        <div className="button-row"><button type="button" onClick={() => edit(selected)}>Bewerken</button><button className="danger" type="button" onClick={() => setDeleteTarget(selected)}>Verwijderen</button></div>
      </div>}
      {editing && <RecordForm record={record} submitLabel={editingId ? "Onderdeel opslaan" : "Onderdeel toevoegen"} pendingLabel="Opslaan…">
        <div className="field-row">
          <record.form.Field name="kind">{(field) => <SelectField field={field} label="Type">{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>}</record.form.Field>
          <record.form.Field name="status">{(field) => <SelectField field={field} label="Status">{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>}</record.form.Field>
        </div>
        <datalist id="transport-time-zones">{timeZoneOptions().map((zone) => <option key={zone} value={zone} />)}</datalist>
        <div className="field-row">
          <record.form.Field name="departsAt" validators={{ onChange: requiredText("Geef de vertrektijd op."), onSubmit: requiredText("Geef de vertrektijd op.") }}>{(field) => <TextField field={field} label="Vertrektijd (lokaal)" required type="datetime-local" />}</record.form.Field>
          <record.form.Field name="departureTimezone" validators={{ onChange: requiredText("Geef de tijdzone van het vertrek op."), onSubmit: requiredText("Geef de tijdzone van het vertrek op.") }}>{(field) => <TextField field={field} label="Tijdzone vertrek" required list="transport-time-zones" maxLength={64} placeholder="Europe/Amsterdam" />}</record.form.Field>
        </div>
        <div className="field-row">
          <record.form.Field name="arrivesAt" validators={{ onChange: requiredText("Geef de aankomsttijd op."), onSubmit: requiredText("Geef de aankomsttijd op.") }}>{(field) => <TextField field={field} label="Aankomsttijd (lokaal)" required type="datetime-local" />}</record.form.Field>
          <record.form.Field name="arrivalTimezone" validators={{ onChange: requiredText("Geef de tijdzone van de aankomst op."), onSubmit: requiredText("Geef de tijdzone van de aankomst op.") }}>{(field) => <TextField field={field} label="Tijdzone aankomst" required list="transport-time-zones" maxLength={64} placeholder="Asia/Taipei" />}</record.form.Field>
        </div>
        <fieldset><legend>Vertrekplaats</legend>
          <PlaceSearchField tripId={trip.id} legend="Vertrekplaats zoeken" inputLabel="Zoek vertrekplaats" placeholder="Bijvoorbeeld: Brussels Airport" help="Een gekozen exacte plaats blijft privé. Delen van transport blijft een afzonderlijke, bewuste keuze." onSelect={(result, existingPlace) => usePlaceResult("departure", result, existingPlace)} allowExisting />
          <div className="field-row">
            <record.form.Field name="departureName">{(field) => <TextField field={field} label="Naam" optional maxLength={500} placeholder="Bijvoorbeeld: Brussels Airport" />}</record.form.Field>
            <record.form.Field name="departureLocality">{(field) => <TextField field={field} label="Plaats" optional maxLength={120} />}</record.form.Field>
          </div>
          <record.form.Field name="departureCountryCode">{(field) => <TextField field={field} label="Landcode" optional maxLength={2} placeholder="BE" />}</record.form.Field>
        </fieldset>
        <fieldset><legend>Aankomstplaats</legend>
          <PlaceSearchField tripId={trip.id} legend="Aankomstplaats zoeken" inputLabel="Zoek aankomstplaats" placeholder="Bijvoorbeeld: Taoyuan Airport" help="Een gekozen exacte plaats blijft privé. Delen van transport blijft een afzonderlijke, bewuste keuze." onSelect={(result, existingPlace) => usePlaceResult("arrival", result, existingPlace)} allowExisting />
          <div className="field-row">
            <record.form.Field name="arrivalName">{(field) => <TextField field={field} label="Naam" optional maxLength={500} placeholder="Bijvoorbeeld: Taoyuan Airport" />}</record.form.Field>
            <record.form.Field name="arrivalLocality">{(field) => <TextField field={field} label="Plaats" optional maxLength={120} />}</record.form.Field>
          </div>
          <record.form.Field name="arrivalCountryCode">{(field) => <TextField field={field} label="Landcode" optional maxLength={2} placeholder="TW" />}</record.form.Field>
        </fieldset>
        <div className="field-row">
          <record.form.Field name="carrier">{(field) => <TextField field={field} label="Vervoerder" optional maxLength={160} placeholder="Bijvoorbeeld: EVA Air" />}</record.form.Field>
          <record.form.Field name="serviceReference">{(field) => <TextField field={field} label="Vlucht-/dienstnummer" optional maxLength={40} placeholder="BR-087" />}</record.form.Field>
        </div>
        <record.form.Field name="travelClass">{(field) => <TextField field={field} label="Reisklasse" optional maxLength={80} placeholder="Bijvoorbeeld: Premium Economy" />}</record.form.Field>
        <record.form.Field name="bookingReference">{(field) => <TextField field={field} label="Boekingsreferentie" optional maxLength={255} />}</record.form.Field>
        <record.form.Field name="notes">{(field) => <TextAreaField field={field} label="Notities" optional maxLength={4000} rows={3} />}</record.form.Field>
        {documents.length > 0 && <record.form.Field name="documentAssetIds">{(field) => <fieldset><legend>Gekoppelde documenten <span className="optional">(optioneel)</span></legend>{documents.map((document) => <label className="media-choice" key={document.id}>
          <input type="checkbox" checked={field.state.value.includes(document.id)} onChange={() => field.handleChange(field.state.value.includes(document.id) ? field.state.value.filter((id) => id !== document.id) : [...field.state.value, document.id])} />{document.title}
        </label>)}</fieldset>}</record.form.Field>}
      </RecordForm>}
    </RecordDialog>
    {legs.length > 0 && <div className="saved-moments manager-list">{legs.map((leg) => <article className="excerpt-row" key={leg.id}>
      <button className="document-select" type="button" onClick={() => dialog.inspect(leg.id)}><strong>{title(leg)}</strong><span>{endpointTime(leg.departs_at, leg.departure_timezone)} → {endpointTime(leg.arrives_at, leg.arrival_timezone)}{dayShift(leg) !== 0 ? ` (${dayShift(leg) > 0 ? "+" : ""}${dayShift(leg)} ${Math.abs(dayShift(leg)) === 1 ? "dag" : "dagen"})` : ""} · {STATUS_LABELS[leg.status]}{leg.carrier ? ` · ${leg.carrier}` : ""}{leg.service_reference ? ` ${leg.service_reference}` : ""}{leg.travel_class ? ` · ${leg.travel_class}` : ""} · {visibilityLabel(leg.visibility)}</span></button>
      <button className="danger compact" type="button" onClick={() => setDeleteTarget(leg)}>Verwijderen</button>
    </article>)}</div>}
    {deleteTarget && <RecordDialog open title="Verwijderen bevestigen" onDismiss={() => setDeleteTarget(null)}><DeleteConfirmation title={`${KIND_LABELS[deleteTarget.kind]} verwijderen?`} onCancel={() => setDeleteTarget(null)} onConfirm={() => confirmDelete(deleteTarget)} /></RecordDialog>}
  </section>;
}
