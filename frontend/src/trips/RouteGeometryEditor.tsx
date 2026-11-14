import { routeLineGeometry } from "../route-line-geometry";
import { mapMessages, useMapMessages } from "../map-messages";
import { textNotice, useFeedback } from "../query/feedback";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { themeColor, useTheme } from "../appearance";
import { Button } from "@/ui/button";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "cn";
import type { FeatureCollection, LineString, MultiLineString } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import { configuredMapStyleUrl, loadMapStyle, readCamera, type MapCamera } from "../map-style";

export type RouteCoordinate = [number, number];
export type RouteSuggestion = { label: string; coordinates: RouteCoordinate };

const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP_PX = 8;
const GESTURE_GUARD_MS = 700;
const MARKER_RADIUS_PX = 18;
const roundedCoordinate = (value: number) => Math.round(value * 1_000) / 1_000;
const lineData = (
  coordinates: RouteCoordinate[],
): FeatureCollection<LineString | MultiLineString> => ({
  type: "FeatureCollection",
  features:
    coordinates.length < 2
      ? []
      : [{ type: "Feature", properties: {}, geometry: routeLineGeometry(coordinates) }],
});
const sameCoordinates = (left: RouteCoordinate[], right: RouteCoordinate[]) =>
  left.length === right.length &&
  left.every(
    ([longitude, latitude], index) =>
      longitude === right[index]?.[0] && latitude === right[index]?.[1],
  );

type ScreenPoint = { x: number; y: number };

/**
 * Where a point added away from the ends belongs: after the vertex that starts the segment nearest to `target`
 * (screen pixels). A line with fewer than two points just grows at the end, as a plain click does.
 */
export function insertionIndex(points: ScreenPoint[], target: ScreenPoint): number {
  if (points.length < 2) return points.length;
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = dx * dx + dy * dy;
    const along =
      length === 0
        ? 0
        : Math.max(0, Math.min(1, ((target.x - from.x) * dx + (target.y - from.y) * dy) / length));
    const distance = Math.hypot(target.x - (from.x + along * dx), target.y - (from.y + along * dy));
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best + 1;
}

function updateSources(map: MapLibreMap, coordinates: RouteCoordinate[]) {
  (map.getSource("route-editor-line") as GeoJSONSource | undefined)?.setData(lineData(coordinates));
}

/** A deliberately general, hand-drawn line. The map rounds a click to roughly 100 metres. */
export function RouteGeometryEditor({
  coordinates,
  onChange,
  suggestions = [],
  mode = "edit",
  heading,
  mapLabel,
}: {
  coordinates: RouteCoordinate[];
  onChange: (coordinates: RouteCoordinate[]) => void;
  suggestions?: RouteSuggestion[];
  mode?: "edit" | "preview";
  heading?: string;
  mapLabel?: string;
}) {
  const titleId = useId();
  const locale = useLocale();
  const preview = mode === "preview";
  const theme = useTheme();
  const canvas = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const mapLibrary = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const coordinatesRef = useRef(coordinates);
  const inputCoordinates = useRef(coordinates);
  const onChangeRef = useRef(onChange);
  const suggestionsRef = useRef(suggestions);
  // A long press ends in a click, and may report both a pointer and a map event; one gesture acts once.
  const gestureUntil = useRef(0);
  const seeded = useRef(false);
  const seededOnce = useRef(false);
  const modeRef = useRef(mode);
  // A theme change rebuilds the map; the next build opens on the region the previous one was showing.
  const camera = useRef<MapCamera | null>(null);
  const [editorCoordinates, setEditorCoordinates] = useState(coordinates);
  const [ready, setReady] = useState(false);
  useMapMessages(canvas, ready);
  const [error, setError] = useFeedback<string>("");

  useEffect(() => {
    markers.current.forEach((marker, index) => {
      marker.getElement().title = preview
        ? m.routes_route_point({ number: index + 1 })
        : m.routes_drag_route_point({ number: index + 1 });
      marker.getElement().setAttribute("aria-label", marker.getElement().title);
    });
  }, [locale, ready, preview]);

  useEffect(() => {
    // TanStack's field keeps its value mutable between renders. Keep map clicks
    // responsive locally, but accept a genuinely new input value when a record
    // is loaded or the advanced JSON path is applied.
    if (!sameCoordinates(coordinates, inputCoordinates.current)) {
      inputCoordinates.current = coordinates;
      coordinatesRef.current = coordinates;
      setEditorCoordinates(coordinates);
      seeded.current = false;
    }
    onChangeRef.current = onChange;
    suggestionsRef.current = suggestions;
    modeRef.current = mode;
  }, [coordinates, onChange, suggestions, mode]);

  useEffect(() => {
    if (
      mode !== "edit" ||
      coordinates.length ||
      suggestions.length < 2 ||
      (seededOnce.current && !seeded.current)
    )
      return;
    const endpoints = [suggestions[0].coordinates, suggestions[1].coordinates];
    if (sameCoordinates(endpoints, coordinatesRef.current)) return;
    seeded.current = true;
    seededOnce.current = true;
    coordinatesRef.current = endpoints;
    setEditorCoordinates(endpoints);
  }, [mode, coordinates, suggestions, editorCoordinates.length, onChange]);

  useEffect(() => {
    if (!canvas.current) return;
    let disposed = false;
    let instance: MapLibreMap | null = null;
    const controller = new AbortController();
    const restore = camera.current;
    camera.current = null;
    let loaded = false;
    setReady(false);
    setError("");
    try {
      if (!window.WebGLRenderingContext) throw new Error();
      const probe = document.createElement("canvas");
      if (!probe.getContext("webgl2") && !probe.getContext("webgl")) throw new Error();
    } catch {
      setError(textNotice(() => m.routes_editor_unavailable_hint()));
      return;
    }
    void Promise.all([
      import("maplibre-gl"),
      loadMapStyle(configuredMapStyleUrl, controller.signal, theme),
    ])
      .then(([maplibregl, style]) => {
        if (disposed || !canvas.current) return;
        maplibregl.setWorkerUrl(mapWorkerUrl);
        mapLibrary.current = maplibregl;
        instance = new maplibregl.Map({
          locale: mapMessages(),
          container: canvas.current,
          style,
          ...(restore ?? { center: [0, 20], zoom: 1.4 }),
          attributionControl: false,
          renderWorldCopies: false,
          transformRequest: (url: string) => ({ url, credentials: "same-origin" }),
        });
        map.current = instance;
        instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        instance.on("load", () => {
          if (!instance || disposed) return;
          instance.addSource("route-editor-line", {
            type: "geojson",
            data: lineData(coordinatesRef.current),
          });
          instance.addLayer({
            id: "route-editor-line",
            type: "line",
            source: "route-editor-line",
            paint: { "line-color": themeColor("danger"), "line-width": 4 },
            layout: { "line-cap": "round", "line-join": "round" },
          });
          refreshMarkers(coordinatesRef.current);
          loaded = true;
          if (!restore) {
            if (coordinatesRef.current.length) showWholeRoute(instance);
            else if (suggestionsRef.current[0])
              instance.flyTo({
                center: suggestionsRef.current[0].coordinates,
                zoom: 7,
              });
          }
          // A long press on touch screens ends in a click as well; do not let it add a point.
          const created = instance;
          instance.on("contextmenu", (event) => {
            if (modeRef.current === "preview") return;
            event.preventDefault();
            const target = event.originalEvent.target;
            // Markers handle their own gesture (see refreshMarkers).
            if (target instanceof Element && target.closest("[data-route-marker]")) return;
            const current = coordinatesRef.current;
            const projected = current.map((coordinate) => created.project(coordinate));
            // A press on a numbered point is that point's gesture, even where the event names no element.
            if (
              projected.some(
                (point) =>
                  Math.hypot(point.x - event.point.x, point.y - event.point.y) < MARKER_RADIUS_PX,
              )
            )
              return;
            if (Date.now() < gestureUntil.current) return;
            gestureUntil.current = Date.now() + GESTURE_GUARD_MS;
            const next: RouteCoordinate = [
              roundedCoordinate(event.lngLat.lng),
              roundedCoordinate(event.lngLat.lat),
            ];
            const at = insertionIndex(projected, event.point);
            commit([...current.slice(0, at), next, ...current.slice(at)]);
          });
          instance.on("click", (event) => {
            if (modeRef.current === "preview" || Date.now() < gestureUntil.current) return;
            if (
              event.originalEvent.target instanceof Element &&
              event.originalEvent.target.closest("[data-route-marker]")
            )
              return;
            const next: RouteCoordinate = [
              roundedCoordinate(event.lngLat.lng),
              roundedCoordinate(event.lngLat.lat),
            ];
            const updated = [...coordinatesRef.current, next];
            seeded.current = false;
            coordinatesRef.current = updated;
            setEditorCoordinates(updated);
            onChangeRef.current(updated);
          });
          instance.getCanvas().style.cursor = modeRef.current === "preview" ? "" : "crosshair";
          setReady(true);
        });
        instance.on("error", () => {
          if (!disposed && instance && !instance.isStyleLoaded())
            setError(textNotice(() => m.routes_editor_load_error_hint()));
        });
      })
      .catch(() => {
        if (!disposed) setError(textNotice(() => m.routes_editor_unavailable_hint()));
      });
    return () => {
      disposed = true;
      controller.abort();
      if (instance && loaded) camera.current = readCamera(instance);
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      instance?.remove();
      map.current = null;
      mapLibrary.current = null;
    };
  }, [theme]);

  useEffect(() => {
    if (!ready || !map.current) return;
    updateSources(map.current, editorCoordinates);
    refreshMarkers(editorCoordinates);
  }, [editorCoordinates, ready]);

  function commit(next: RouteCoordinate[]) {
    seeded.current = false;
    coordinatesRef.current = next;
    setEditorCoordinates(next);
    onChangeRef.current(next);
  }

  /** Right-click, or a long press on a touch screen, removes the numbered point. */
  function removePoint(index: number) {
    if (Date.now() < gestureUntil.current) return;
    gestureUntil.current = Date.now() + GESTURE_GUARD_MS;
    commit(coordinatesRef.current.filter((_, position) => position !== index));
  }

  function refreshMarkers(points: RouteCoordinate[]) {
    const instance = map.current;
    const library = mapLibrary.current;
    if (!instance || !library) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = points.map((coordinate, index) => {
      const element = document.createElement("div");
      element.dataset.routeMarker = String(index);
      element.className =
        "grid size-7 place-items-center rounded-full border-2 border-travel-ink bg-travel-map-marker text-xs font-extrabold text-travel-ink shadow-sm select-none";
      element.textContent = String(index + 1);
      const editable = modeRef.current === "edit";
      element.title = editable
        ? m.routes_drag_route_point({ number: index + 1 })
        : m.routes_route_point({ number: index + 1 });
      element.setAttribute("aria-label", element.title);
      const marker = new library.Marker({ element, draggable: editable })
        .setLngLat(coordinate)
        .addTo(instance);
      if (editable) {
        element.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          removePoint(index);
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        let origin = { x: 0, y: 0 };
        const cancel = () => clearTimeout(timer);
        element.addEventListener("pointerdown", (event) => {
          if (event.pointerType === "mouse") return;
          origin = { x: event.clientX, y: event.clientY };
          cancel();
          timer = setTimeout(() => removePoint(index), LONG_PRESS_MS);
        });
        element.addEventListener("pointermove", (event) => {
          if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > LONG_PRESS_SLOP_PX)
            cancel();
        });
        for (const type of ["pointerup", "pointercancel", "pointerleave"])
          element.addEventListener(type, cancel);
        marker.on("dragstart", cancel);
        marker.on("dragend", () => {
          const position = marker.getLngLat();
          const next = [...coordinatesRef.current];
          next[index] = [roundedCoordinate(position.lng), roundedCoordinate(position.lat)];
          commit(next);
        });
      }
      return marker;
    });
  }

  function showWholeRoute(instance = map.current) {
    if (!instance || !coordinatesRef.current.length) return;
    let west = 180,
      east = -180,
      south = 90,
      north = -90;
    for (const [longitude, latitude] of coordinatesRef.current) {
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }
    if (coordinatesRef.current.length === 1)
      instance.flyTo({ center: coordinatesRef.current[0], zoom: 8 });
    else
      instance.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 42, maxZoom: 11, duration: 350 },
      );
  }

  function addSuggestion(suggestion: RouteSuggestion) {
    commit([...editorCoordinates, suggestion.coordinates]);
    map.current?.flyTo({
      center: suggestion.coordinates,
      zoom: Math.max(map.current.getZoom(), 7),
    });
  }

  return (
    <section className="grid gap-2.5" aria-labelledby={titleId}>
      <div>
        <h3 className="m-0 text-base" id={titleId}>
          {heading ?? (preview ? m.routes_route_preview() : m.routes_draw_route_on_map())}
        </h3>
        <p className="mt-1 mb-0 text-sm leading-normal text-travel-muted">
          {preview
            ? m.routes_saved_line_hint()
            : `${m.routes_draw_hint()} ${m.routes_edit_points_hint()}`}
        </p>
      </div>
      <div
        role="region"
        aria-label={
          mapLabel ?? (preview ? m.routes_map_preview_of_route() : m.routes_map_editor_for_route())
        }
        className={cn(
          "relative h-route-canvas overflow-hidden rounded-xl border border-travel-border bg-travel-map-bg",
          preview && "h-route-preview-canvas",
        )}
      >
        <div ref={canvas} className="size-full" />
        {error && (
          <p className="absolute inset-0 m-0 grid place-content-center bg-travel-map-bg p-6 text-center">
            {preview
              ? m.routes_the_route_preview_could_not_be_loaded()
              : m.routes_editor_load_error_hint()}
          </p>
        )}
      </div>
      {!preview && (
        <>
          <div className="button-row">
            <Button
              className="secondary compact"
              type="button"
              disabled={!ready || !editorCoordinates.length}
              onClick={() => showWholeRoute()}
            >
              {m.routes_show_route()}
            </Button>
            <Button
              className="secondary compact"
              type="button"
              disabled={!editorCoordinates.length}
              onClick={() => commit(editorCoordinates.slice(0, -1))}
            >
              {m.routes_remove_last_point()}
            </Button>
            <Button
              className="secondary compact"
              type="button"
              disabled={!editorCoordinates.length}
              onClick={() => commit([])}
            >
              {m.routes_clear_points()}
            </Button>
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.75 text-sm text-travel-muted">
              <span>{m.routes_use_an_area()}</span>
              {suggestions.map((suggestion) => (
                <Button
                  className="secondary compact"
                  type="button"
                  key={suggestion.label}
                  onClick={() => addSuggestion(suggestion)}
                >
                  {m.routes_add_area_point({ name: suggestion.label })}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
      <p className="help" aria-live="polite">
        {editorCoordinates.length === 0
          ? m.routes_no_points_hint()
          : preview || editorCoordinates.length >= 2
            ? m.routes_route_point_count({ count: editorCoordinates.length })
            : m.routes_point_at_least_two_points_are_needed({ count: editorCoordinates.length })}
      </p>
      {!preview && editorCoordinates.length > 0 && (
        <ol
          className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.25 p-0 text-xs text-travel-muted"
          aria-label={m.routes_route_points()}
        >
          {editorCoordinates.map(([longitude, latitude], index) => (
            <li key={`${longitude}-${latitude}-${index}`}>
              {m.routes_point()} {index + 1}: {latitude.toFixed(3)}, {longitude.toFixed(3)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
