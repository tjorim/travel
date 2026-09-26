import { useEffect, useRef, useState } from "react";
import type { FeatureCollection, LineString } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import { configuredMapStyleUrl, loadMapStyle } from "../map-style";

export type RouteCoordinate = [number, number];
export type RouteSuggestion = { label: string; coordinates: RouteCoordinate };

const roundedCoordinate = (value: number) => Math.round(value * 1_000) / 1_000;
const lineData = (coordinates: RouteCoordinate[]): FeatureCollection<LineString> => ({
  type: "FeatureCollection",
  features: coordinates.length < 2 ? [] : [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }],
});
const sameCoordinates = (left: RouteCoordinate[], right: RouteCoordinate[]) => left.length === right.length && left.every(([longitude, latitude], index) => longitude === right[index]?.[0] && latitude === right[index]?.[1]);

function updateSources(map: MapLibreMap, coordinates: RouteCoordinate[]) {
  (map.getSource("route-editor-line") as GeoJSONSource | undefined)?.setData(lineData(coordinates));
}

/** A deliberately general, hand-drawn line. The map rounds a click to roughly 100 metres. */
export function RouteGeometryEditor({ coordinates, onChange, suggestions = [], mode = "edit" }: { coordinates: RouteCoordinate[]; onChange: (coordinates: RouteCoordinate[]) => void; suggestions?: RouteSuggestion[]; mode?: "edit" | "preview" }) {
  const preview = mode === "preview";
  const canvas = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const mapLibrary = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const coordinatesRef = useRef(coordinates);
  const inputCoordinates = useRef(coordinates);
  const onChangeRef = useRef(onChange);
  const suggestionsRef = useRef(suggestions);
  const modeRef = useRef(mode);
  const [editorCoordinates, setEditorCoordinates] = useState(coordinates);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // TanStack's field keeps its value mutable between renders. Keep map clicks
    // responsive locally, but accept a genuinely new input value when a record
    // is loaded or the advanced JSON path is applied.
    if (!sameCoordinates(coordinates, inputCoordinates.current)) {
      inputCoordinates.current = coordinates;
      coordinatesRef.current = coordinates;
      setEditorCoordinates(coordinates);
    }
    onChangeRef.current = onChange;
    suggestionsRef.current = suggestions;
    modeRef.current = mode;
  }, [coordinates, onChange, suggestions, mode]);

  useEffect(() => {
    if (!canvas.current) return;
    let disposed = false;
    let instance: MapLibreMap | null = null;
    const controller = new AbortController();
    setReady(false);
    setError("");
    try {
      if (!window.WebGLRenderingContext) throw new Error();
      const probe = document.createElement("canvas");
      if (!probe.getContext("webgl2") && !probe.getContext("webgl")) throw new Error();
    } catch { setError("De kaarteditor is niet beschikbaar. Je kunt hieronder nog coördinaten als JSON plakken."); return; }
    void Promise.all([import("maplibre-gl"), loadMapStyle(configuredMapStyleUrl, controller.signal)]).then(([maplibregl, style]) => {
      if (disposed || !canvas.current) return;
      maplibregl.setWorkerUrl(mapWorkerUrl);
      mapLibrary.current = maplibregl;
      instance = new maplibregl.Map({
        container: canvas.current,
        style,
        center: [0, 20],
        zoom: 1.4,
        attributionControl: false,
        renderWorldCopies: false,
        transformRequest: (url: string) => ({ url, credentials: "same-origin" }),
      });
      map.current = instance;
      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      instance.on("load", () => {
        if (!instance || disposed) return;
        instance.addSource("route-editor-line", { type: "geojson", data: lineData(coordinatesRef.current) });
        instance.addLayer({ id: "route-editor-line", type: "line", source: "route-editor-line", paint: { "line-color": "#a63b32", "line-width": 4 }, layout: { "line-cap": "round", "line-join": "round" } });
        refreshMarkers(coordinatesRef.current);
        if (coordinatesRef.current.length) showWholeRoute(instance);
        else if (suggestionsRef.current[0]) instance.flyTo({ center: suggestionsRef.current[0].coordinates, zoom: 7, essential: true });
        instance.on("click", (event) => {
          if (modeRef.current === "preview") return;
          if (event.originalEvent.target instanceof Element && event.originalEvent.target.closest(".route-geometry-marker")) return;
          const next: RouteCoordinate = [roundedCoordinate(event.lngLat.lng), roundedCoordinate(event.lngLat.lat)];
          const updated = [...coordinatesRef.current, next];
          coordinatesRef.current = updated;
          setEditorCoordinates(updated);
          onChangeRef.current(updated);
        });
        instance.getCanvas().style.cursor = modeRef.current === "preview" ? "" : "crosshair";
        setReady(true);
      });
      instance.on("error", () => { if (!disposed && instance && !instance.isStyleLoaded()) setError("De kaarteditor kon niet worden geladen. Je kunt hieronder nog coördinaten als JSON plakken."); });
    }).catch(() => { if (!disposed) setError("De kaarteditor is niet beschikbaar. Je kunt hieronder nog coördinaten als JSON plakken."); });
    return () => { disposed = true; controller.abort(); markers.current.forEach((marker) => marker.remove()); markers.current = []; instance?.remove(); map.current = null; mapLibrary.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    updateSources(map.current, editorCoordinates);
    refreshMarkers(editorCoordinates);
  }, [editorCoordinates, ready]);

  function commit(next: RouteCoordinate[]) {
    coordinatesRef.current = next;
    setEditorCoordinates(next);
    onChange(next);
  }

  function refreshMarkers(points: RouteCoordinate[]) {
    const instance = map.current;
    const library = mapLibrary.current;
    if (!instance || !library) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = points.map((coordinate, index) => {
      const element = document.createElement("div");
      element.className = "route-geometry-marker";
      element.textContent = String(index + 1);
      const editable = modeRef.current === "edit";
      element.title = editable ? `Routepunt ${index + 1} verslepen` : `Routepunt ${index + 1}`;
      const marker = new library.Marker({ element, draggable: editable }).setLngLat(coordinate).addTo(instance);
      if (editable) marker.on("dragend", () => {
          const position = marker.getLngLat();
          const next = [...coordinatesRef.current];
          next[index] = [roundedCoordinate(position.lng), roundedCoordinate(position.lat)];
          commit(next);
        });
      return marker;
    });
  }

  function showWholeRoute(instance = map.current) {
    if (!instance || !coordinatesRef.current.length) return;
    let west = 180, east = -180, south = 90, north = -90;
    for (const [longitude, latitude] of coordinatesRef.current) {
      west = Math.min(west, longitude); east = Math.max(east, longitude);
      south = Math.min(south, latitude); north = Math.max(north, latitude);
    }
    if (coordinatesRef.current.length === 1) instance.flyTo({ center: coordinatesRef.current[0], zoom: 8, essential: true });
    else instance.fitBounds([[west, south], [east, north]], { padding: 42, maxZoom: 11, duration: 350 });
  }

  function addSuggestion(suggestion: RouteSuggestion) {
    commit([...editorCoordinates, suggestion.coordinates]);
    map.current?.flyTo({ center: suggestion.coordinates, zoom: Math.max(map.current.getZoom(), 7), essential: true });
  }

  return <section className={`route-geometry-editor${preview ? " preview" : ""}`} aria-labelledby="route-geometry-title">
    <div><h3 id="route-geometry-title">{preview ? "Routevoorbeeld" : "Route tekenen op kaart"}</h3><p>{preview ? "Dit is de opgeslagen route op kaart. De kaart is alleen ter controle; bewerken gebeurt via de knop hieronder." : "Klik de algemene plaatsen van je route in volgorde aan. Versleep een genummerd punt om het te verbeteren. Elke positie wordt afgerond tot ongeveer 100 meter; teken geen exacte track."}</p></div>
    <div className="route-geometry-canvas-wrap"><div ref={canvas} className="route-geometry-canvas" aria-label={preview ? "Kaartvoorbeeld van route" : "Kaarteditor voor route"} />{error && <p className="route-geometry-fallback">{preview ? "Het routevoorbeeld kon niet worden geladen." : "De kaarteditor kon niet worden geladen. Je kunt hieronder nog coördinaten als JSON plakken."}</p>}</div>
    {!preview && <><div className="button-row">
      <button className="secondary compact" type="button" disabled={!ready || !editorCoordinates.length} onClick={() => showWholeRoute()}>Route tonen</button>
      <button className="secondary compact" type="button" disabled={!editorCoordinates.length} onClick={() => commit(editorCoordinates.slice(0, -1))}>Laatste punt verwijderen</button>
      <button className="secondary compact" type="button" disabled={!editorCoordinates.length} onClick={() => commit([])}>Punten wissen</button>
    </div>
    {suggestions.length > 0 && <div className="route-geometry-suggestions"><span>Gebruik een gebied:</span>{suggestions.map((suggestion) => <button className="secondary compact" type="button" key={suggestion.label} onClick={() => addSuggestion(suggestion)}>Voeg {suggestion.label} toe</button>)}</div>}</>}
    <p className="help" aria-live="polite">{editorCoordinates.length === 0 ? "Nog geen punten. Zoom naar de regio en klik het eerste algemene punt." : preview ? `${editorCoordinates.length} algemene punten in deze route.` : `${editorCoordinates.length} ${editorCoordinates.length === 1 ? "punt" : "punten"} · minstens twee punten zijn nodig.`}</p>
    {!preview && editorCoordinates.length > 0 && <ol className="route-geometry-points" aria-label="Routepunten">{editorCoordinates.map(([longitude, latitude], index) => <li key={`${longitude}-${latitude}-${index}`}>Punt {index + 1}: {latitude.toFixed(3)}, {longitude.toFixed(3)}</li>)}</ol>}
  </section>;
}
