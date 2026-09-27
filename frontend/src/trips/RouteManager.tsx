import { useRef, useState } from "react";

import { RecordForm, SelectField, TextAreaField, TextField } from "../forms/fields";
import { MarkdownField } from "../forms/MarkdownField";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { Markdown } from "../Markdown";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { ROUTE_MODE_LABELS, browserTimeZone, daysBetween, formatDay, localDate, locationName, routeTitle, timeZoneOptions, wallClock, type Route, type RouteMode, type TimedRoute, type Trip } from "../tracker-model";
import { VisibilityControl, visibilityLabel } from "./visibility";
import { emptyPlace, hasPlace, PlacePicker, placeFields, placeOf, samePlace, type PlaceValue } from "./PlacePicker";
import { RouteGeometryEditor, type RouteCoordinate } from "./RouteGeometryEditor";

const STATUS_LABELS: Record<Route["status"], string> = {
  planned: "Gepland", booked: "Geboekt", confirmed: "Bevestigd", cancelled: "Geannuleerd",
};

/** "16 nov 10:40" in the end's own zone (browser zone when none is known). */
function endpointTime(instant: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat("nl-BE", { timeZone: timeZone ?? undefined, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(instant));
}

/** The archive's "+1 dag": calendar days between local departure and arrival. */
export function dayShift(route: Pick<TimedRoute, "departs_at" | "arrives_at" | "departure_timezone" | "arrival_timezone">): number {
  return daysBetween(localDate(route.departs_at, route.departure_timezone), localDate(route.arrives_at, route.arrival_timezone));
}

type Values = {
  mode: RouteMode; status: Route["status"]; label: string;
  departure: PlaceValue; arrival: PlaceValue;
  departsOn: string; departsAt: string; arrivesAt: string; departureTimezone: string; arrivalTimezone: string;
  carrier: string; serviceReference: string; travelClass: string; bookingReference: string; notes: string;
  documentAssetIds: string[];
  /** The drawn line as JSON text; empty when the route has none. */
  coordinates: string;
};

const NOT_ENOUGH_POINTS = "Een lijn heeft minstens twee punten nodig.";

/** The line's points, or the message explaining why the text is not a usable line. */
function parseCoordinates(text: string): [number, number][] | string {
  let coordinates: unknown;
  try { coordinates = JSON.parse(text); } catch { return "Gebruik geldige JSON met minstens twee [lengtegraad, breedtegraad]-paren."; }
  if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((value) => typeof value !== "number"))) return NOT_ENOUGH_POINTS;
  return coordinates as [number, number][];
}
const validCoordinates = ({ value }: { value: string }) => {
  if (!value.trim()) return undefined;
  const parsed = parseCoordinates(value);
  return typeof parsed === "string" ? parsed : undefined;
};
const editableCoordinates = (value: string): RouteCoordinate[] => {
  if (!value.trim()) return [];
  const parsed = parseCoordinates(value);
  return typeof parsed === "string" ? [] : parsed;
};

function blank(): Values {
  return {
    mode: "train", status: "planned", label: "",
    departure: emptyPlace(), arrival: emptyPlace(),
    departsOn: "", departsAt: "", arrivesAt: "", departureTimezone: browserTimeZone(), arrivalTimezone: browserTimeZone(),
    carrier: "", serviceReference: "", travelClass: "", bookingReference: "", notes: "",
    documentAssetIds: [], coordinates: "",
  };
}

const fromRoute = (route: Route): Values => ({
  mode: route.mode, status: route.status, label: route.label ?? "",
  departure: placeOf(route.departure_area, route.departure_location), arrival: placeOf(route.arrival_area, route.arrival_location),
  departsOn: route.departs_on ?? "",
  departsAt: route.departs_at ? wallClock(route.departs_at, route.departure_timezone) : "", arrivesAt: route.arrives_at ? wallClock(route.arrives_at, route.arrival_timezone) : "",
  departureTimezone: route.departure_timezone ?? browserTimeZone(), arrivalTimezone: route.arrival_timezone ?? browserTimeZone(),
  carrier: route.carrier ?? "", serviceReference: route.service_reference ?? "", travelClass: route.travel_class ?? "", bookingReference: route.booking_reference ?? "", notes: route.notes ?? "",
  documentAssetIds: [...route.document_asset_ids],
  coordinates: route.geometry ? JSON.stringify(route.geometry.coordinates) : "",
});

const serverFields = {
  mode: "mode", status: "status", label: "label", departs_on: "departsOn", departs_at: "departsAt", arrives_at: "arrivesAt", departure_timezone: "departureTimezone", arrival_timezone: "arrivalTimezone",
  carrier: "carrier", service_reference: "serviceReference", travel_class: "travelClass", booking_reference: "bookingReference", notes: "notes", geometry: "coordinates",
};

export function RouteManager({ trip }: { trip: Trip }) {
  const routesQuery = useTripResource(trip.id, "routes");
  const areasQuery = useTripResource(trip.id, "areas");
  const locationsQuery = useTripResource(trip.id, "locations");
  const documentsQuery = useTripResource(trip.id, "documents");
  const routes = routesQuery.data ?? [];
  const areas = areasQuery.data ?? [];
  const locations = locationsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const dialog = useRecordDialog(routes);
  const [message, setMessage] = useState("Een route loopt tussen twee gebieden. Een dag, stations, tijden, boekingen en een getekende lijn zijn optioneel: kies eerst de dag, de tijden kunnen later. Bezoekers zien alleen wat je deelt, en dan met de gebieden, nooit met de locaties.");
  const [deleteTarget, setDeleteTarget] = useState<Route | null>(null);
  // An end's location is only rewritten when one of its fields differs from what the editor opened with.
  const baseline = useRef<Values>(blank());
  // A new location can create a reusable location and its derived area.
  const refreshRoutes = (subject: string) => [ownerKeys.tripResource(subject, trip.id, "routes"), ownerKeys.tripResource(subject, trip.id, "locations"), ownerKeys.tripResource(subject, trip.id, "areas")];

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, Route>({
    fallback: "De route kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${tripPath(trip.id, "routes")}/${id}` : tripPath(trip.id, "routes"), method: id ? "PATCH" : "POST", body: payload }),
    invalidate: refreshRoutes,
  });
  const remove = useOwnerMutation<Route>({
    fallback: "De route kon niet worden verwijderd.",
    request: (route) => ({ path: `${tripPath(trip.id, "routes")}/${route.id}`, method: "DELETE" }),
    invalidate: refreshRoutes,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "De route kon niet worden opgeslagen.",
    serverFields,
    submit: async (values) => {
      const id = dialog.editingId ?? null;
      if (!hasPlace(values.departure)) throw new Error("Kies waar de route begint: een gebied of een locatie.");
      if (!hasPlace(values.arrival)) throw new Error("Kies waar de route eindigt: een gebied of een locatie.");
      if (Boolean(values.departsAt) !== Boolean(values.arrivesAt)) throw new Error("Geef zowel de vertrek- als de aankomsttijd op, of geen van beide.");
      if (values.departsAt && (!values.departureTimezone || !values.arrivalTimezone)) throw new Error("Geef de tijdzone van het vertrek en van de aankomst op.");
      // A departure time fixes the day: its local date there.
      if (values.departsAt && values.departsOn && values.departsAt.slice(0, 10) !== values.departsOn) throw new Error(`De vertrektijd valt op ${formatDay(values.departsAt.slice(0, 10))}, niet op de gekozen dag. Pas de dag of de tijd aan.`);
      const line = values.coordinates.trim() ? parseCoordinates(values.coordinates) : null;
      if (typeof line === "string") throw new Error(line);
      await save.mutateAsync({
        id,
        payload: {
          mode: values.mode,
          status: values.status,
          label: values.label.trim() || null,
          departs_on: values.departsAt ? values.departsAt.slice(0, 10) : values.departsOn || null,
          // Local wall-clock times; the server resolves them in each end's zone.
          departs_at: values.departsAt ? `${values.departsAt}:00` : null,
          arrives_at: values.arrivesAt ? `${values.arrivesAt}:00` : null,
          departure_timezone: values.departsAt ? values.departureTimezone : null,
          arrival_timezone: values.departsAt ? values.arrivalTimezone : null,
          carrier: values.carrier.trim() || null,
          service_reference: values.serviceReference.trim() || null,
          travel_class: values.travelClass.trim() || null,
          booking_reference: values.bookingReference.trim() || null,
          notes: values.notes.trim() || null,
          document_asset_ids: values.documentAssetIds,
          geometry: line ? { type: "LineString", coordinates: line } : null,
          ...(!id || !samePlace(values.departure, baseline.current.departure) ? placeFields(values.departure, "departure_") : {}),
          ...(!id || !samePlace(values.arrival, baseline.current.arrival) ? placeFields(values.arrival, "arrival_") : {}),
        },
      });
    },
    onSuccess: () => { close(); setMessage("Route opgeslagen."); },
  });

  function load(values: Values) { baseline.current = values; record.load(values); }
  function close() { dialog.close(); load(blank()); }
  function create() { load(blank()); dialog.create(); }
  function edit(route: Route) { load(fromRoute(route)); dialog.edit(route.id); }
  function confirmDelete(route: Route) {
    remove.mutateAsync(route).then(() => { close(); setDeleteTarget(null); setMessage("Route verwijderd."); }, (error: unknown) => { setDeleteTarget(null); setMessage(errorMessage(error, "De route kon niet worden verwijderd.")); });
  }

  /** The area a place value is in: what it names, or the area of the location it names. */
  const areaIdOf = (value: PlaceValue): string => {
    const [kind, id] = value.choice.split(":");
    return kind === "area" ? id : kind === "location" ? locations.find((location) => location.id === id)?.area_id ?? "" : value.newAreaId;
  };
  const areaPoint = (value: PlaceValue): { label: string; coordinates: RouteCoordinate }[] => {
    if (value.choice.startsWith("location:")) {
      const location = locations.find((candidate) => candidate.id === value.choice.slice("location:".length));
      if (location?.visibility === "everyone" && location.latitude !== null && location.longitude !== null) {
        return [{ label: locationName(location), coordinates: [location.longitude, location.latitude] }];
      }
    }
    if (value.newAreaId === "__new__" && value.newAreaCandidate?.latitude != null && value.newAreaCandidate.longitude != null) {
      return [{ label: value.newAreaCandidate.label, coordinates: [value.newAreaCandidate.longitude, value.newAreaCandidate.latitude] }];
    }
    const area = areas.find((candidate) => candidate.id === areaIdOf(value));
    return area && area.latitude !== null && area.longitude !== null ? [{ label: area.label, coordinates: [area.longitude, area.latitude] }] : [];
  };
  const { selected, editing, editingId } = dialog;
  const readError = routesQuery.error ?? areasQuery.error ?? locationsQuery.error ?? documentsQuery.error;
  // The times once booked, else the day alone.
  const times = (route: Route) => route.departs_at && route.arrives_at ? `${endpointTime(route.departs_at, route.departure_timezone)} → ${endpointTime(route.arrives_at, route.arrival_timezone)}` : route.departs_on ? formatDay(route.departs_on) : null;
  const shift = (route: Route) => {
    if (!route.departs_at || !route.arrives_at) return "";
    const days = dayShift(route as TimedRoute);
    return days !== 0 ? ` (${days > 0 ? "+" : ""}${days} ${Math.abs(days) === 1 ? "dag" : "dagen"})` : "";
  };

  return <section className="card manager" aria-labelledby="routes-title">
    <div className="capture-heading"><div><h3 id="routes-title">Routes</h3><p>Hoe je van het ene gebied naar het andere reist: vlucht, trein, bus, fiets… Stations, tijden en boekingen zijn optioneel en blijven privé. Je kunt er een lijn bij tekenen.</p></div><button className="secondary compact" type="button" onClick={create}>Nieuwe route</button></div>
    <p className="help" role="status">{readError ? errorMessage(readError, "Je routes konden niet worden geladen.") : routesQuery.isPending ? "Laad je routes…" : message}</p>
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Route bewerken" : "Route toevoegen") : "Route"} dirty={editing && record.dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form">
        <div><h3>{routeTitle(selected)}</h3><p>{[ROUTE_MODE_LABELS[selected.mode], STATUS_LABELS[selected.status], times(selected)].filter(Boolean).join(" · ")}</p><p>{selected.booking_reference ? `Boekingsreferentie: ${selected.booking_reference}` : "Geen boekingsreferentie"}</p><Markdown html={selected.notes_html} text={selected.notes} /></div>
        {selected.geometry && <RouteGeometryEditor coordinates={selected.geometry.coordinates} onChange={() => undefined} mode="preview" />}
        <VisibilityControl tripId={trip.id} kind="route" id={selected.id} value={selected.visibility} name={routeTitle(selected)} />
        <p className="help">Bezoekers zien de gebieden, het vervoermiddel en de lijn. Nooit je boekingscode, klasse, notities of documenten, en een station alleen als je die locatie zelf deelt.</p>
        <div className="button-row"><button type="button" onClick={() => edit(selected)}>Bewerken</button><button className="danger" type="button" onClick={() => setDeleteTarget(selected)}>Verwijderen</button></div>
      </div>}
      {editing && <RecordForm record={record} submitLabel={editingId ? "Route opslaan" : "Route toevoegen"} pendingLabel="Opslaan…">
        <div className="field-row">
          <record.form.Field name="mode">{(input) => <SelectField field={input} label="Vervoer">{Object.entries(ROUTE_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>}</record.form.Field>
          <record.form.Field name="status">{(input) => <SelectField field={input} label="Status">{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>}</record.form.Field>
        </div>
        <record.form.Field name="label">{(input) => <TextField field={input} label="Naam" optional maxLength={160} placeholder="Zonder naam heet de route “vertrek → aankomst”" />}</record.form.Field>
        <record.form.Field name="departure">{(input) => <PlacePicker tripId={trip.id} label="Vertrek" value={input.state.value} onChange={(value) => input.handleChange(value)} />}</record.form.Field>
        <record.form.Field name="arrival">{(input) => <PlacePicker tripId={trip.id} label="Aankomst" value={input.state.value} onChange={(value) => input.handleChange(value)} />}</record.form.Field>
        <record.form.Field name="departsOn">{(input) => <TextField field={input} label="Dag van vertrek" optional type="date" />}</record.form.Field>
        <fieldset><legend>Tijden <span className="optional">(optioneel, zodra je een verbinding kiest)</span></legend>
          <datalist id="route-time-zones">{timeZoneOptions().map((zone) => <option key={zone} value={zone} />)}</datalist>
          <div className="field-row">
            <record.form.Field name="departsAt">{(input) => <TextField field={input} label="Vertrektijd (lokaal)" optional type="datetime-local" />}</record.form.Field>
            <record.form.Field name="departureTimezone">{(input) => <TextField field={input} label="Tijdzone vertrek" optional list="route-time-zones" maxLength={64} placeholder="Europe/Amsterdam" />}</record.form.Field>
          </div>
          <div className="field-row">
            <record.form.Field name="arrivesAt">{(input) => <TextField field={input} label="Aankomsttijd (lokaal)" optional type="datetime-local" />}</record.form.Field>
            <record.form.Field name="arrivalTimezone">{(input) => <TextField field={input} label="Tijdzone aankomst" optional list="route-time-zones" maxLength={64} placeholder="Asia/Taipei" />}</record.form.Field>
          </div>
        </fieldset>
        <details className="route-booking" open={Boolean(record.form.state.values.carrier || record.form.state.values.bookingReference || record.form.state.values.notes)}>
          <summary>Boekingsdetails (optioneel, privé)</summary>
          <div className="field-row">
            <record.form.Field name="carrier">{(input) => <TextField field={input} label="Vervoerder" optional maxLength={160} placeholder="Bijvoorbeeld: EVA Air" />}</record.form.Field>
            <record.form.Field name="serviceReference">{(input) => <TextField field={input} label="Vlucht-/dienstnummer" optional maxLength={40} placeholder="BR-087" />}</record.form.Field>
          </div>
          <record.form.Field name="travelClass">{(input) => <TextField field={input} label="Reisklasse" optional maxLength={80} placeholder="Bijvoorbeeld: Premium Economy" />}</record.form.Field>
          <record.form.Field name="bookingReference">{(input) => <TextField field={input} label="Boekingsreferentie" optional maxLength={255} />}</record.form.Field>
          <record.form.Field name="notes">{(input) => <MarkdownField field={input} label="Notities" optional maxLength={4000} rows={3} />}</record.form.Field>
          {documents.length > 0 && <record.form.Field name="documentAssetIds">{(input) => <fieldset><legend>Gekoppelde documenten <span className="optional">(optioneel)</span></legend>{documents.map((document) => <label className="media-choice" key={document.id}>
            <input type="checkbox" checked={input.state.value.includes(document.id)} onChange={() => input.handleChange(input.state.value.includes(document.id) ? input.state.value.filter((id) => id !== document.id) : [...input.state.value, document.id])} />{document.title}
          </label>)}</fieldset>}</record.form.Field>}
        </details>
        <record.form.Field name="coordinates" validators={{ onBlur: validCoordinates, onSubmit: validCoordinates }}>{(input) => <fieldset><legend>Lijn op de kaart <span className="optional">(optioneel)</span></legend>
          <RouteGeometryEditor coordinates={editableCoordinates(input.state.value)} onChange={(coordinates) => input.handleChange(coordinates.length ? JSON.stringify(coordinates) : "")} suggestions={[...areaPoint(record.form.state.values.departure), ...areaPoint(record.form.state.values.arrival)]} />
          <details className="route-geometry-advanced"><summary>Geavanceerd: coördinaten als JSON plakken</summary><TextAreaField field={input} label="Lijncoördinaten (JSON)" optional placeholder="[[121.5,25.0],[121.6,25.1]]" /></details>
        </fieldset>}</record.form.Field>
      </RecordForm>}
    </RecordDialog>
    {routes.length > 0 && <div className="saved-records manager-list">{routes.map((route) => <article className="excerpt-row" key={route.id}>
      <button className="document-select" type="button" onClick={() => dialog.inspect(route.id)} aria-label={`Route ${routeTitle(route)} bekijken`}><strong>{routeTitle(route)}</strong><span>{[ROUTE_MODE_LABELS[route.mode], [times(route), shift(route)].filter(Boolean).join(""), STATUS_LABELS[route.status], route.carrier, route.geometry ? "met lijn" : null, visibilityLabel(route.visibility)].filter(Boolean).join(" · ")}</span></button>
      <button className="danger compact" type="button" onClick={() => setDeleteTarget(route)}>Verwijderen</button>
    </article>)}</div>}
    {deleteTarget && <RecordDialog open title="Verwijderen bevestigen" onDismiss={() => setDeleteTarget(null)}><DeleteConfirmation title={`Route “${routeTitle(deleteTarget)}” verwijderen?`} onCancel={() => setDeleteTarget(null)} onConfirm={() => confirmDelete(deleteTarget)} /></RecordDialog>}
  </section>;
}
