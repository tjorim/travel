import { useState } from "react";

import { RecordForm, requiredText, SelectField, TextField, TextAreaField } from "../forms/fields";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage, openOwnerFile } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwner, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { bytesLabel, localDateTime, type BroadRoute, type RecordedTrack, type Trip } from "../tracker-model";
import { VisibilityControl, visibilityLabel } from "./visibility";
import { RouteGeometryEditor, type RouteCoordinate } from "./RouteGeometryEditor";

type UploadValues = { kind: RecordedTrack["kind"]; startedAt: string; endedAt: string };
type RouteValues = { label: string; datePrecision: BroadRoute["date_precision"]; coordinates: string };

const blankUpload = (): UploadValues => ({ kind: "gpx", startedAt: localDateTime(new Date(Date.now() - 3_600_000)), endedAt: localDateTime() });
const blankRoute = (): RouteValues => ({ label: "", datePrecision: "day", coordinates: "" });
const routeFields = { label: "label", date_precision: "datePrecision", geometry: "coordinates" };
const NOT_ENOUGH_POINTS = "Een route op kaart heeft minstens twee algemene punten nodig.";

/** The route's points, or the message explaining why the text is not a usable line. */
function parseCoordinates(text: string): [number, number][] | string {
  let coordinates: unknown;
  try { coordinates = JSON.parse(text); } catch { return "Gebruik geldige JSON met minstens twee [lengtegraad, breedtegraad]-paren."; }
  if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((value) => typeof value !== "number"))) return NOT_ENOUGH_POINTS;
  return coordinates as [number, number][];
}
const validCoordinates = ({ value }: { value: string }) => {
  if (!value.trim()) return "Plaats minstens twee punten op de kaart.";
  const parsed = parseCoordinates(value);
  return typeof parsed === "string" ? parsed : undefined;
};
const editableCoordinates = (value: string): RouteCoordinate[] => {
  const parsed = parseCoordinates(value);
  return typeof parsed === "string" ? [] : parsed;
};
const PRECISION_LABELS: Record<BroadRoute["date_precision"], string> = { day: "Dag", month: "Maand", year: "Jaar" };
const trackDate = (label: string) => ({ value }: { value: string }) => value ? undefined : `Geef de ${label} op.`;

export function TrackManager({ trip }: { trip: Trip }) {
  const owner = useOwner();
  const tracksQuery = useTripResource(trip.id, "recorded-tracks");
  const routesQuery = useTripResource(trip.id, "broad-routes");
  const tracks = tracksQuery.data ?? [];
  const routes = routesQuery.data ?? [];
  const routeDialog = useRecordDialog(routes);
  const { selected, editing, editingId } = routeDialog;
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("Een afgewerkte track blijft uitsluitend van jou. Routes op kaart schrijf je afzonderlijk.");
  const [file, setFile] = useState<File | null>(null);
  // Remounts the file input so a finished upload clears the chosen file.
  const [fileKey, setFileKey] = useState(0);
  const routeSuggestions = trip.route_stages.flatMap((stage) => stage.place.latitude === null || stage.place.longitude === null ? [] : [{ label: stage.label ?? stage.place.label, coordinates: [stage.place.longitude, stage.place.latitude] as RouteCoordinate }]);

  const upload = useOwnerMutation<FormData, RecordedTrack>({
    fallback: "De afgewerkte track kon niet worden geüpload.",
    request: (body) => ({ path: `${tripPath(trip.id, "recorded-tracks")}/uploads`, method: "POST", body }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "recorded-tracks")],
  });
  const saveRoute = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, BroadRoute>({
    fallback: "De route op kaart kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${tripPath(trip.id, "broad-routes")}/${id}` : tripPath(trip.id, "broad-routes"), method: id ? "PATCH" : "POST", body: payload }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "broad-routes")],
  });
  const removeRoute = useOwnerMutation<BroadRoute>({
    fallback: "De route op kaart kon niet worden verwijderd.",
    request: (route) => ({ path: `${tripPath(trip.id, "broad-routes")}/${route.id}`, method: "DELETE" }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "broad-routes")],
  });

  const uploadRecord = useRecordForm<UploadValues>({
    defaultValues: blankUpload(),
    fallback: "De afgewerkte track kon niet worden geüpload.",
    serverFields: { kind: "kind", started_at: "startedAt", ended_at: "endedAt" },
    submit: async (values) => {
      if (!file) throw new Error("Kies een afgewerkt GPX- of JSON-bestand.");
      const contentType = values.kind === "gpx" ? "application/gpx+xml" : "application/json";
      const body = new FormData();
      body.set("file", new File([file], file.name, { type: contentType }));
      body.set("kind", values.kind);
      body.set("started_at", new Date(values.startedAt).toISOString());
      body.set("ended_at", new Date(values.endedAt).toISOString());
      setMessage("Afgewerkte track uploaden…");
      await upload.mutateAsync(body);
    },
    onSuccess: () => {
      closeUpload();
      setMessage("Afgewerkte track opgeslagen. Er is geen opname- of achtergrondlocatiefunctie.");
    },
  });
  const routeRecord = useRecordForm<RouteValues>({
    defaultValues: blankRoute(),
    fallback: "De route op kaart kon niet worden opgeslagen.",
    serverFields: routeFields,
    submit: async (values) => {
      const coordinates = parseCoordinates(values.coordinates);
      if (typeof coordinates === "string") throw new Error(coordinates);
      await saveRoute.mutateAsync({ id: routeDialog.editingId ?? null, payload: { label: values.label.trim(), date_precision: values.datePrecision, geometry: { type: "LineString", coordinates } } });
    },
    onSuccess: () => { closeRoute(); setMessage("Route op kaart opgeslagen als een afzonderlijk, bewust geschreven lijn."); },
  });

  function openUpload() { uploadRecord.load(blankUpload()); setFile(null); setFileKey((current) => current + 1); setUploading(true); }
  function closeUpload() { setUploading(false); setFile(null); setFileKey((current) => current + 1); uploadRecord.load(blankUpload()); }
  function closeRoute() { routeDialog.close(); routeRecord.load(blankRoute()); }
  function newRoute() { routeRecord.load(blankRoute()); routeDialog.create(); }
  function editRoute(route: BroadRoute) { routeRecord.load({ label: route.label, datePrecision: route.date_precision, coordinates: JSON.stringify(route.geometry.coordinates) }); routeDialog.edit(route.id); }
  function eraseRoute(route: BroadRoute) {
    removeRoute.mutateAsync(route).then(() => { closeRoute(); setMessage("Route op kaart verwijderd."); }, (error: unknown) => setMessage(errorMessage(error, "De route op kaart kon niet worden verwijderd.")));
  }
  function openTrack(track: RecordedTrack) {
    if (!owner) return;
    openOwnerFile(owner.session, track.source_file_url, "De private track kon niet worden geopend.").catch((error: unknown) => setMessage(errorMessage(error, "De private track kon niet worden geopend.")));
  }

  const readError = tracksQuery.error ?? routesQuery.error;

  return <section className="card manager" aria-labelledby="tracks-title">
    <div className="capture-heading"><div><h3 id="tracks-title">Tracks en routes op kaart</h3><p>Upload alleen een volledig afgewerkt bestand. Deze tracker start nooit een opname en verzamelt geen achtergrondlocatie.</p></div><button className="secondary compact" type="button" onClick={openUpload}>Track uploaden</button></div>
    <p className="help" role="status">{readError ? errorMessage(readError, "Je tracks konden niet worden geladen.") : message}</p>
    {tracks.length > 0 && <div className="saved-moments manager-list">{tracks.map((track) => <article className="excerpt-row" key={track.id}><div><strong>{track.kind === "gpx" ? "GPX-track" : "JSON-puntenlijst"}</strong><span>{new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(track.started_at))} · {bytesLabel(track.byte_size)}</span></div><button className="secondary compact" type="button" onClick={() => openTrack(track)}>Privébestand bekijken</button></article>)}</div>}
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Route op kaart</h3><p>Dit is een eigen, gecontroleerde lijn. De app leidt hem nooit af uit je ruwe track.</p></div><button className="secondary compact" type="button" onClick={newRoute}>Nieuwe route</button></div>
      {routes.length > 0 && <div className="saved-moments manager-list">{routes.map((route) => <article className="excerpt-row" key={route.id}>
        <button className="document-select" type="button" onClick={() => routeDialog.inspect(route.id)} aria-label={`Route ${route.label} bekijken`}><strong>{route.label}</strong><span>{PRECISION_LABELS[route.date_precision]} · {route.geometry.coordinates.length} algemene punten · {visibilityLabel(route.visibility)}</span></button>
      </article>)}</div>}
    </div>
    <RecordDialog open={uploading} title="Afgewerkte track uploaden" dirty={uploading && uploadRecord.dirty} onDismiss={closeUpload}>
      {uploading && <RecordForm record={uploadRecord} submitLabel="Afgewerkte track uploaden" pendingLabel="Uploaden…">
        <div className="field-row">
          <div className="field"><label>Afgewerkt bestand<input key={fileKey} required type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml,.json,application/json,application/geo+json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label></div>
          <uploadRecord.form.Field name="kind">{(field) => <SelectField field={field} label="Bestandstype"><option value="gpx">GPX</option><option value="point_array">JSON-puntenlijst</option></SelectField>}</uploadRecord.form.Field>
        </div>
        <div className="field-row">
          <uploadRecord.form.Field name="startedAt" validators={{ onChange: trackDate("begintijd"), onSubmit: trackDate("begintijd") }}>{(field) => <TextField field={field} label="Begintijd" required type="datetime-local" />}</uploadRecord.form.Field>
          <uploadRecord.form.Field name="endedAt" validators={{ onChange: trackDate("eindtijd"), onSubmit: trackDate("eindtijd") }}>{(field) => <TextField field={field} label="Eindtijd" required type="datetime-local" />}</uploadRecord.form.Field>
        </div>
      </RecordForm>}
    </RecordDialog>
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Route op kaart bewerken" : "Route op kaart toevoegen") : "Route op kaart"} dirty={editing && routeRecord.dirty} onDismiss={closeRoute}>
      {!editing && selected && <div className="stack-form">
        <div><h3>{selected.label}</h3><p>{PRECISION_LABELS[selected.date_precision]} · {selected.geometry.coordinates.length} algemene punten</p></div>
        <RouteGeometryEditor coordinates={selected.geometry.coordinates} onChange={() => undefined} mode="preview" />
        <VisibilityControl tripId={trip.id} kind="broad_route" id={selected.id} value={selected.visibility} name={selected.label} />
        <div className="button-row"><button type="button" onClick={() => editRoute(selected)}>Bewerken</button><button className="danger" type="button" onClick={() => routeDialog.setConfirmDelete(true)}>Verwijderen</button></div>
        {routeDialog.confirmDelete && <DeleteConfirmation title={`Route “${selected.label}” verwijderen?`} onCancel={() => routeDialog.setConfirmDelete(false)} onConfirm={() => eraseRoute(selected)} />}
      </div>}
      {editing && <RecordForm record={routeRecord} submitLabel={editingId ? "Route opslaan" : "Route maken"} pendingLabel="Opslaan…">
        <div className="field-row">
          <routeRecord.form.Field name="label" validators={{ onChange: requiredText("Geef de route een label."), onSubmit: requiredText("Geef de route een label.") }}>{(field) => <TextField field={field} label="Label" required maxLength={160} placeholder="Bijvoorbeeld: oostkust" />}</routeRecord.form.Field>
          <routeRecord.form.Field name="datePrecision">{(field) => <SelectField field={field} label="Datumprecisie"><option value="day">Dag</option><option value="month">Maand</option><option value="year">Jaar</option></SelectField>}</routeRecord.form.Field>
        </div>
        <routeRecord.form.Field name="coordinates" validators={{ onBlur: validCoordinates, onSubmit: validCoordinates }}>{(field) => <>
          <RouteGeometryEditor coordinates={editableCoordinates(field.state.value)} onChange={(coordinates) => field.handleChange(JSON.stringify(coordinates))} suggestions={routeSuggestions} />
          <details className="route-geometry-advanced"><summary>Geavanceerd: coördinaten als JSON plakken</summary><TextAreaField field={field} label="Lijncoördinaten (JSON)" required placeholder="[[121.5,25.0],[121.6,25.1]]" /></details>
        </>}</routeRecord.form.Field>
        <p className="help">De route op kaart blijft een afzonderlijk, bewust gekozen lijn. Er wordt nooit een afgewerkte track uitgelezen.</p>
      </RecordForm>}
    </RecordDialog>
  </section>;
}
