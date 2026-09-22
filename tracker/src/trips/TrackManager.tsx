import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { apiError, apiHeaders, bytesLabel, localDateTime, openProtectedFile, type BroadRoute, type RecordedTrack, type Trip } from "../tracker-model";

export function TrackManager({ trip }: { trip: Trip }) {
  const { session } = useAuth();
  const [tracks, setTracks] = useState<RecordedTrack[]>([]);
  const [routes, setRoutes] = useState<BroadRoute[]>([]);
  const [message, setMessage] = useState("Een afgewerkte track blijft uitsluitend van jou. Brede routes schrijf je afzonderlijk.");
  const [upload, setUpload] = useState({ file: null as File | null, kind: "gpx" as RecordedTrack["kind"], startedAt: localDateTime(new Date(Date.now() - 3_600_000)), endedAt: localDateTime() });
  const [routeDraft, setRouteDraft] = useState({ id: null as string | null, label: "", datePrecision: "day" as BroadRoute["date_precision"], coordinates: "" });

  async function load() {
    if (!session) return;
    const [tracksResponse, routesResponse] = await Promise.all([
      fetch(`/api/v1/trips/${trip.id}/recorded-tracks`, { headers: apiHeaders(session) }),
      fetch(`/api/v1/trips/${trip.id}/broad-routes`, { headers: apiHeaders(session) }),
    ]);
    if (!tracksResponse.ok) return apiError(tracksResponse, "Je afgewerkte tracks konden niet worden geladen.");
    if (!routesResponse.ok) return apiError(routesResponse, "Je brede routes konden niet worden geladen.");
    setTracks(await tracksResponse.json() as RecordedTrack[]);
    setRoutes(await routesResponse.json() as BroadRoute[]);
  }

  useEffect(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je tracks konden niet worden geladen.")); }, [session, trip.id]);

  async function uploadTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !upload.file) throw new Error("Kies een afgewerkt GPX- of JSON-bestand.");
    const contentType = upload.kind === "gpx" ? "application/gpx+xml" : "application/json";
    const file = new File([upload.file], upload.file.name, { type: contentType });
    const body = new FormData();
    body.set("file", file); body.set("kind", upload.kind); body.set("started_at", new Date(upload.startedAt).toISOString()); body.set("ended_at", new Date(upload.endedAt).toISOString());
    setMessage("Afgewerkte track uploaden…");
    const response = await fetch(`/api/v1/trips/${trip.id}/recorded-tracks/uploads`, { method: "POST", headers: { Authorization: `Bearer ${session.accessToken}` }, body });
    if (!response.ok) return apiError(response, "De afgewerkte track kon niet worden geüpload.");
    await load();
    setUpload({ file: null, kind: "gpx", startedAt: localDateTime(new Date(Date.now() - 3_600_000)), endedAt: localDateTime() });
    setMessage("Afgewerkte track opgeslagen. Er is geen opname- of achtergrondlocatiefunctie.");
  }

  function newRoute() { setRouteDraft({ id: null, label: "", datePrecision: "day", coordinates: "" }); }
  function editRoute(route: BroadRoute) { setRouteDraft({ id: route.id, label: route.label, datePrecision: route.date_precision, coordinates: JSON.stringify(route.geometry.coordinates) }); }

  async function saveRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    let coordinates: [number, number][];
    try { coordinates = JSON.parse(routeDraft.coordinates) as [number, number][]; } catch { throw new Error("Gebruik geldige JSON met minstens twee [lengtegraad, breedtegraad]-paren."); }
    if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((value) => typeof value !== "number"))) throw new Error("Een brede route heeft minstens twee [lengtegraad, breedtegraad]-paren nodig.");
    const response = await fetch(routeDraft.id ? `/api/v1/trips/${trip.id}/broad-routes/${routeDraft.id}` : `/api/v1/trips/${trip.id}/broad-routes`, {
      method: routeDraft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify({ label: routeDraft.label.trim(), date_precision: routeDraft.datePrecision, geometry: { type: "LineString", coordinates } }),
    });
    if (!response.ok) return apiError(response, "De brede route kon niet worden opgeslagen.");
    await load(); newRoute(); setMessage("Brede route opgeslagen als een afzonderlijk, bewust geschreven lijn.");
  }

  async function deleteRoute(route: BroadRoute) {
    if (!session || !window.confirm(`Verwijder brede route “${route.label}”?`)) return;
    const response = await fetch(`/api/v1/trips/${trip.id}/broad-routes/${route.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De brede route kon niet worden verwijderd.");
    await load(); newRoute(); setMessage("Brede route verwijderd.");
  }

  return <section className="card manager" aria-labelledby="tracks-title">
    <div className="capture-heading"><div><h3 id="tracks-title">Tracks en brede routes</h3><p>Upload alleen een volledig afgewerkt bestand. Deze tracker start nooit een opname en verzamelt geen achtergrondlocatie.</p></div></div>
    <p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={(event) => void uploadTrack(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De afgewerkte track kon niet worden geüpload."))}>
      <div className="field-row"><label>Afgewerkt bestand<input required type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml,.json,application/json,application/geo+json" onChange={(event) => setUpload((current) => ({ ...current, file: event.target.files?.[0] ?? null }))} /></label><label>Bestandstype<select value={upload.kind} onChange={(event) => setUpload((current) => ({ ...current, kind: event.target.value as RecordedTrack["kind"] }))}><option value="gpx">GPX</option><option value="point_array">JSON-puntenlijst</option></select></label></div>
      <div className="field-row"><label>Begintijd<input required type="datetime-local" value={upload.startedAt} onChange={(event) => setUpload((current) => ({ ...current, startedAt: event.target.value }))} /></label><label>Eindtijd<input required type="datetime-local" value={upload.endedAt} onChange={(event) => setUpload((current) => ({ ...current, endedAt: event.target.value }))} /></label></div>
      <button type="submit">Afgewerkte track uploaden</button>
    </form>
    {tracks.length > 0 && <div className="saved-moments manager-list">{tracks.map((track) => <article className="excerpt-row" key={track.id}><div><strong>{track.kind === "gpx" ? "GPX-track" : "JSON-puntenlijst"}</strong><span>{new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(track.started_at))} · {bytesLabel(track.byte_size)}</span></div><button className="secondary compact" type="button" onClick={() => void openProtectedFile(session!, track.source_file_url, "De private track kon niet worden geopend.").catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De private track kon niet worden geopend."))}>Privébestand bekijken</button></article>)}</div>}
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Brede route schrijven</h3><p>Dit is een eigen, gecontroleerde lijn. De app leidt hem nooit af uit je ruwe track.</p></div>{routeDraft.id && <button className="secondary compact" type="button" onClick={newRoute}>Nieuwe brede route</button>}</div>
      <form className="stack-form" onSubmit={(event) => void saveRoute(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De brede route kon niet worden opgeslagen."))}><div className="field-row"><label>Label<input required maxLength={160} value={routeDraft.label} onChange={(event) => setRouteDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Bijvoorbeeld: oostkust" /></label><label>Datumprecisie<select value={routeDraft.datePrecision} onChange={(event) => setRouteDraft((current) => ({ ...current, datePrecision: event.target.value as BroadRoute["date_precision"] }))}><option value="day">Dag</option><option value="month">Maand</option><option value="year">Jaar</option></select></label></div><label>Lijncoördinaten (JSON)<textarea required value={routeDraft.coordinates} onChange={(event) => setRouteDraft((current) => ({ ...current, coordinates: event.target.value }))} placeholder="[[121.5,25.0],[121.6,25.1]]" /></label><p className="help">Gebruik algemene [lengtegraad, breedtegraad]-punten, van minstens twee punten. Geen track wordt hiervoor uitgelezen.</p><button type="submit">{routeDraft.id ? "Brede route opslaan" : "Brede route maken"}</button></form>
      {routes.length > 0 && <div className="saved-moments manager-list">{routes.map((route) => <article className="excerpt-row" key={route.id}><div><strong>{route.label}</strong><span>{route.date_precision} · {route.geometry.coordinates.length} algemene punten</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => editRoute(route)}>Bewerken</button><button className="danger compact" type="button" onClick={() => void deleteRoute(route).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De brede route kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
    </div>
  </section>;
}
