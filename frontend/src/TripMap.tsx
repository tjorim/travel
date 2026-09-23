import { useEffect, useRef, useState } from "react";
import type { FeatureCollection, LineString, Point } from "geojson";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

export type MapPoint = { id: string; label: string; coordinates: [number, number]; kind?: "mountain" | "stay" | "airport" | "place"; detail?: string; dates?: string };
export type MapLine = { id: string; label: string; coordinates: [number, number][]; exact?: boolean; transport?: "flight" | "rail" | "road" | "mountain"; from?: string; to?: string };
export type MapPerspective = { center: [number, number]; zoom: number; pitch: number; bearing: number; label?: string; exaggeration?: number };

const defaultStyleUrl = "https://tiles.openfreemap.org/styles/liberty";
const configuredStyleUrl = import.meta.env.VITE_MAP_STYLE_URL || defaultStyleUrl;
const terrainUrl = "https://tiles.mapterhorn.com/tilejson.json";
const satelliteUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const attribution = <><a href="https://openfreemap.org" target="_blank" rel="noreferrer" referrerPolicy="no-referrer">© OpenFreeMap</a> · <a href="https://openmaptiles.org" target="_blank" rel="noreferrer" referrerPolicy="no-referrer">OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" referrerPolicy="no-referrer">© OpenStreetMap</a></>;
const numericFilters: Record<string, string> = {
  boundary_3: "admin_level",
  "highway-shield-non-us": "ref_length",
  "highway-shield-us-interstate": "ref_length",
  road_shield_us: "ref_length",
};

async function mapStyle(styleUrl: string, signal: AbortSignal): Promise<string | StyleSpecification> {
  if (styleUrl !== defaultStyleUrl) return styleUrl;
  const response = await fetch(styleUrl, { signal, referrerPolicy: "no-referrer", credentials: "omit" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const style = await response.json() as StyleSpecification;
  for (const layer of style.layers ?? []) {
    const property = numericFilters[layer.id];
    if (property && "filter" in layer && layer.filter) layer.filter = ["all", ["==", ["typeof", ["get", property]], "number"], layer.filter] as typeof layer.filter;
  }
  return style;
}

function fitToData(instance: MapLibreMap, Bounds: typeof import("maplibre-gl").LngLatBounds, points: MapPoint[], lines: MapLine[], duration = 0) {
  const bounds = new Bounds();
  points.forEach((point) => bounds.extend(point.coordinates));
  lines.forEach((line) => line.coordinates.forEach((coordinate) => bounds.extend(coordinate)));
  if (!bounds.isEmpty()) instance.fitBounds(bounds, { padding: 45, maxZoom: 10, duration, pitch: 0, bearing: 0 });
}

export function TripMap({ points, lines, owner = false, perspective, styleUrl = configuredStyleUrl, focus }: { points: MapPoint[]; lines: MapLine[]; owner?: boolean; perspective?: MapPerspective; styleUrl?: string; focus?: { id: string; request: number } | null }) {
  const canvas = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [terrain, setTerrain] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedPoint = points.find((point) => point.id === selected);
  const selectedLine = lines.find((line) => line.id === selected);
  const hasGeometry = points.length > 0 || lines.length > 0;

  useEffect(() => {
    if (!hasGeometry || !canvas.current) return;
    let disposed = false;
    let instance: MapLibreMap | null = null;
    const controller = new AbortController();
    setReady(false);
    setError("");
    setTerrain(false);
    setSatellite(false);
    setSelected(null);
    try {
      if (!window.WebGLRenderingContext) { setError("Deze browser ondersteunt geen WebGL. Gebruik de route in woorden."); return; }
      const probe = document.createElement("canvas");
      if (!probe.getContext("webgl2") && !probe.getContext("webgl")) { setError("Deze browser ondersteunt geen WebGL. Gebruik de route in woorden."); return; }
    } catch { setError("De interactieve kaart is niet beschikbaar. Gebruik de route in woorden."); return; }
    void Promise.all([import("maplibre-gl"), mapStyle(styleUrl, controller.signal)]).then(([maplibregl, style]) => {
      if (disposed || !canvas.current) return;
      maplibregl.setWorkerUrl(mapWorkerUrl);
      const created = new maplibregl.Map({ container: canvas.current, style, attributionControl: false, renderWorldCopies: false, maxPitch: 60, transformRequest: (url: string) => ({ url, credentials: "same-origin" }) });
      instance = created;
      map.current = instance;
      created.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      created.on("load", () => {
        if (!instance || disposed) return;
        const routeData: FeatureCollection<LineString> = { type: "FeatureCollection", features: lines.map((line) => ({ type: "Feature", properties: { id: line.id, exact: Boolean(line.exact), transport: line.transport ?? "road" }, geometry: { type: "LineString", coordinates: line.coordinates } })) };
        const pointData: FeatureCollection<Point> = { type: "FeatureCollection", features: points.map((point) => ({ type: "Feature", properties: { id: point.id, kind: point.kind ?? "place" }, geometry: { type: "Point", coordinates: point.coordinates } })) };
        instance.addSource("routes", { type: "geojson", data: routeData });
        instance.addSource("stops", { type: "geojson", data: pointData });
        const routeStyles = {
          flight: { color: "#ff7a59", width: 3, dash: [2, 2] },
          rail: { color: "#63b3ff", width: 4, dash: [2, 1.4] },
          road: { color: "#e37749", width: 4 },
          mountain: { color: "#0f7760", width: 4, dash: [1.5, 1.2] },
        };
        for (const [transport, routeStyle] of Object.entries(routeStyles)) {
          instance.addLayer({ id: `route-${transport}`, type: "line", source: "routes", filter: ["all", ["==", ["get", "transport"], transport], ["!=", ["get", "exact"], true]], paint: { "line-color": routeStyle.color, "line-width": routeStyle.width, ...("dash" in routeStyle ? { "line-dasharray": routeStyle.dash } : {}) }, layout: { "line-cap": "round", "line-join": "round" } });
        }
        instance.addLayer({ id: "route-exact", type: "line", source: "routes", filter: ["==", ["get", "exact"], true], paint: { "line-color": "#a63b32", "line-width": 4 }, layout: { "line-cap": "round", "line-join": "round" } });
        instance.addLayer({ id: "stop-halo", type: "circle", source: "stops", paint: { "circle-radius": 12, "circle-color": "#63b3ff", "circle-opacity": 0.22 } });
        instance.addLayer({ id: "stops", type: "circle", source: "stops", paint: { "circle-color": ["match", ["get", "kind"], "mountain", "#6ee7c7", "stay", "#63b3ff", "airport", "#ffd166", "#ff7a59"], "circle-radius": 7, "circle-stroke-color": "#19342d", "circle-stroke-width": 2 } });
        instance.addLayer({ id: "selected-stop", type: "circle", source: "stops", filter: ["==", ["get", "id"], ""], paint: { "circle-radius": 15, "circle-color": "#ffd166", "circle-opacity": 0.32, "circle-stroke-width": 2, "circle-stroke-color": "#ffd166" } });
        fitToData(instance, maplibregl.LngLatBounds, points, lines);
        instance.on("click", "stops", (event) => {
          const point = points.find((candidate) => candidate.id === event.features?.[0]?.properties?.id);
          if (point) selectPoint(point);
        });
        instance.on("mouseenter", "stops", () => { if (instance) instance.getCanvas().style.cursor = "pointer"; });
        instance.on("mouseleave", "stops", () => { if (instance) instance.getCanvas().style.cursor = ""; });
        setReady(true);
      });
      created.on("error", () => { if (!disposed) setError(created.isStyleLoaded() ? "Kaarttegels konden niet volledig worden geladen. De route in woorden blijft beschikbaar." : "De kaartstijl kon niet worden geladen. Gebruik de route in woorden."); });
    }).catch(() => { if (!disposed) setError("De interactieve kaart is niet beschikbaar. Gebruik de route in woorden."); });
    return () => { disposed = true; controller.abort(); instance?.remove(); map.current = null; };
  }, [points, lines, hasGeometry, styleUrl]);

  useEffect(() => {
    if (ready && map.current?.getLayer("selected-stop")) map.current.setFilter("selected-stop", ["==", ["get", "id"], selectedPoint?.id ?? ""]);
  }, [ready, selectedPoint]);

  // An outside request (such as a day-plan entry) selects a stop by id; the
  // request counter lets the same stop be chosen again.
  useEffect(() => {
    const point = focus ? points.find((candidate) => candidate.id === focus.id) : undefined;
    if (point) selectPoint(point);
  }, [focus?.request, ready]);

  function toggleTerrain() {
    const instance = map.current;
    if (!instance || !ready) return;
    try {
      if (terrain) {
        instance.setTerrain(null);
        void import("maplibre-gl").then(({ LngLatBounds }) => fitToData(instance, LngLatBounds, points, lines, 700));
      }
      else {
        if (!instance.getSource("terrain")) instance.addSource("terrain", { type: "raster-dem", url: terrainUrl, tileSize: 512, encoding: "terrarium" });
        instance.setTerrain({ source: "terrain", exaggeration: perspective?.exaggeration ?? 1.35 });
        instance.easeTo(perspective ? { center: perspective.center, zoom: perspective.zoom, pitch: Math.min(perspective.pitch, 60), bearing: perspective.bearing, duration: 700, essential: true } : { pitch: 55, duration: 700, essential: true });
      }
      setTerrain(!terrain); setError("");
    } catch { setError("3D-terrein kon niet worden geladen. De routekaart blijft beschikbaar."); }
  }

  function toggleSatellite() {
    const instance = map.current;
    if (!instance || !ready) return;
    try {
      if (!instance.getSource("satellite")) instance.addSource("satellite", { type: "raster", tiles: [satelliteUrl], tileSize: 256, maxzoom: 19 });
      if (!instance.getLayer("satellite")) {
        const layers = instance.getStyle().layers;
        const buildingLayer = layers.find((layer) => layer.type === "fill-extrusion" && layer["source-layer"] === "building");
        const beforeLayer = buildingLayer?.id ?? layers.find((layer) => layer.type === "symbol")?.id ?? "route-flight";
        instance.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" }, paint: { "raster-fade-duration": 150 } }, beforeLayer);
      }
      instance.setLayoutProperty("satellite", "visibility", satellite ? "none" : "visible");
      if (!satellite && instance.getPitch() < 50) instance.easeTo({ pitch: 50, duration: 700, essential: true });
      setSatellite(!satellite); setError("");
    } catch { setError("Satellietbeelden konden niet worden geladen. De routekaart blijft beschikbaar."); }
  }

  function selectPoint(point: MapPoint) {
    setSelected(point.id);
    map.current?.flyTo({ center: point.coordinates, zoom: Math.max(map.current.getZoom(), satellite ? 15 : 9), essential: true });
  }

  function selectLine(line: MapLine) {
    setSelected(line.id);
    const instance = map.current;
    if (!instance) return;
    let west = 180, east = -180, south = 90, north = -90;
    for (const [longitude, latitude] of line.coordinates) {
      west = Math.min(west, longitude); east = Math.max(east, longitude);
      south = Math.min(south, latitude); north = Math.max(north, latitude);
    }
    instance.fitBounds([[west, south], [east, north]], { padding: 45, maxZoom: 12, duration: 500 });
  }

  if (!hasGeometry) return <section className="card trip-map"><h3>Kaart</h3><p>Voor deze reis zijn nog geen kaartcoördinaten beschikbaar.</p></section>;
  return <section className="card trip-map" aria-label="Reiskaart">
    <h3>Kaart</h3>
    <div className="trip-map-canvas-wrap"><div ref={canvas} className="trip-map-canvas" role="img" aria-label="Kaart met haltes en routes" />{error && !ready && <p className="trip-map-fallback">Interactieve kaart niet beschikbaar. Gebruik de route in woorden en de halteknoppen.</p>}<div className="trip-map-attribution">{attribution}{terrain && <> · <a href="https://mapterhorn.com/attribution" target="_blank" rel="noreferrer" referrerPolicy="no-referrer">© Mapterhorn</a></>}{satellite && <> · <a href="https://www.esri.com/" target="_blank" rel="noreferrer" referrerPolicy="no-referrer">© Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community</>}</div></div>
    {error && <p role="status" className="help">{error}</p>}
    {owner && <div className="button-row"><button className="secondary compact" type="button" aria-pressed={terrain} disabled={!ready} onClick={toggleTerrain}>{perspective?.label ?? "3D-terrein"}</button><button className="secondary compact" type="button" aria-pressed={satellite} disabled={!ready} onClick={toggleSatellite}>Satelliet</button></div>}
    {owner && satellite && <p className="help">Zoom in op een stad om de 3D-gebouwen boven de satellietbeelden te zien.</p>}
    <p className="trip-map-privacy">Kaarttegels tonen de bekeken regio aan OpenFreeMap. {owner && "3D-terrein vraagt na inschakeling hoogtegegevens op bij Mapterhorn; satelliet vraagt na inschakeling beelden op bij Esri."}</p>
    {(selectedPoint || selectedLine) && <p aria-live="polite"><strong>Geselecteerd:</strong> {selectedPoint?.label ?? selectedLine?.label}{selectedPoint?.detail && <> · {selectedPoint.detail}</>}{selectedPoint?.dates && <> · {selectedPoint.dates}</>}</p>}
    {points.length > 0 && <div className="trip-map-stops"><h4>Haltes</h4><ol>{points.map((point) => <li key={point.id}><button className="secondary compact" type="button" aria-pressed={selected === point.id} onClick={() => selectPoint(point)}>{point.label}</button></li>)}</ol></div>}
    <div className="trip-map-words"><h4>Route in woorden</h4><ol>{lines.map((line) => <li key={line.id}><button className="secondary compact" type="button" aria-pressed={selected === line.id} onClick={() => selectLine(line)}>{line.from && line.to ? `${line.from} → ${line.to} · ` : ""}{line.label}</button></li>)}{points.map((point) => <li key={point.id}>{point.label}</li>)}</ol></div>
  </section>;
}
