import { mapMessages, useMapMessages } from "../map-messages";
import { textNotice, useFeedback } from "../query/feedback";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { themeColor, useTheme } from "../appearance";
import { Button } from "@base-ui/react/button";
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
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
  features:
    coordinates.length < 2 ? [] : [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }],
});
const sameCoordinates = (left: RouteCoordinate[], right: RouteCoordinate[]) =>
  left.length === right.length &&
  left.every(([longitude, latitude], index) => longitude === right[index]?.[0] && latitude === right[index]?.[1]);

function updateSources(map: MapLibreMap, coordinates: RouteCoordinate[]) {
  (map.getSource("route-editor-line") as GeoJSONSource | undefined)?.setData(lineData(coordinates));
}

/** A deliberately general, hand-drawn line. The map rounds a click to roughly 100 metres. */
export function RouteGeometryEditor({
  coordinates,
  onChange,
  suggestions = [],
  mode = "edit",
}: {
  coordinates: RouteCoordinate[];
  onChange: (coordinates: RouteCoordinate[]) => void;
  suggestions?: RouteSuggestion[];
  mode?: "edit" | "preview";
}) {
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
  const seeded = useRef(false);
  const seededOnce = useRef(false);
  const modeRef = useRef(mode);
  const [editorCoordinates, setEditorCoordinates] = useState(coordinates);
  const [ready, setReady] = useState(false);
  useMapMessages(canvas, ready);
  const [error, setError] = useFeedback<string>("");

  useEffect(() => {
    markers.current.forEach((marker, index) => {
      marker.getElement().title = preview
        ? m.owner_route_point({ p0: index + 1 })
        : m.owner_drag_route_point({ p0: index + 1 });
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
    if (mode !== "edit" || coordinates.length || suggestions.length < 2 || (seededOnce.current && !seeded.current))
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
    setReady(false);
    setError("");
    try {
      if (!window.WebGLRenderingContext) throw new Error();
      const probe = document.createElement("canvas");
      if (!probe.getContext("webgl2") && !probe.getContext("webgl")) throw new Error();
    } catch {
      setError(textNotice(() => m.owner_the_map_editor_is_unavailable_you_can_still_paste_coordinates_as_json_be()));
      return;
    }
    void Promise.all([import("maplibre-gl"), loadMapStyle(configuredMapStyleUrl, controller.signal, theme)])
      .then(([maplibregl, style]) => {
        if (disposed || !canvas.current) return;
        maplibregl.setWorkerUrl(mapWorkerUrl);
        mapLibrary.current = maplibregl;
        instance = new maplibregl.Map({
          locale: mapMessages(),
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
          instance.addLayer({
            id: "route-editor-line",
            type: "line",
            source: "route-editor-line",
            paint: { "line-color": themeColor("danger"), "line-width": 4 },
            layout: { "line-cap": "round", "line-join": "round" },
          });
          refreshMarkers(coordinatesRef.current);
          if (coordinatesRef.current.length) showWholeRoute(instance);
          else if (suggestionsRef.current[0])
            instance.flyTo({ center: suggestionsRef.current[0].coordinates, zoom: 7, essential: true });
          instance.on("click", (event) => {
            if (modeRef.current === "preview") return;
            if (
              event.originalEvent.target instanceof Element &&
              event.originalEvent.target.closest("[data-route-marker]")
            )
              return;
            const next: RouteCoordinate = [roundedCoordinate(event.lngLat.lng), roundedCoordinate(event.lngLat.lat)];
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
            setError(
              textNotice(() => m.owner_the_map_editor_could_not_be_loaded_you_can_still_paste_coordinates_as_js()),
            );
        });
      })
      .catch(() => {
        if (!disposed)
          setError(
            textNotice(() => m.owner_the_map_editor_is_unavailable_you_can_still_paste_coordinates_as_json_be()),
          );
      });
    return () => {
      disposed = true;
      controller.abort();
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
    onChange(next);
  }

  function refreshMarkers(points: RouteCoordinate[]) {
    const instance = map.current;
    const library = mapLibrary.current;
    if (!instance || !library) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = points.map((coordinate, index) => {
      const element = document.createElement("div");
      element.dataset.routeMarker = "";
      element.className =
        "grid size-7 place-items-center rounded-full border-2 border-travel-ink bg-travel-map-marker text-xs font-extrabold text-travel-ink shadow-sm select-none";
      element.textContent = String(index + 1);
      const editable = modeRef.current === "edit";
      element.title = editable ? m.owner_drag_route_point({ p0: index + 1 }) : m.owner_route_point({ p0: index + 1 });
      element.setAttribute("aria-label", element.title);
      const marker = new library.Marker({ element, draggable: editable }).setLngLat(coordinate).addTo(instance);
      if (editable)
        marker.on("dragend", () => {
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
      instance.flyTo({ center: coordinatesRef.current[0], zoom: 8, essential: true });
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
    map.current?.flyTo({ center: suggestion.coordinates, zoom: Math.max(map.current.getZoom(), 7), essential: true });
  }

  return (
    <section className="grid gap-2.5" aria-labelledby="route-geometry-title">
      <div>
        <h3 className="m-0 text-base" id="route-geometry-title">
          {preview ? m.owner_route_preview() : m.owner_draw_route_on_map()}
        </h3>
        <p className="mt-1 mb-0 text-sm leading-normal text-travel-muted">
          {preview
            ? m.owner_this_is_the_saved_route_on_the_map_the_map_is_for_checking_only_use_the()
            : m.owner_click_the_general_places_on_your_route_in_order_drag_a_numbered_point_to()}
        </p>
      </div>
      <div
        className={cn(
          "relative h-route-canvas overflow-hidden rounded-xl border border-travel-border bg-travel-map-bg",
          preview && "h-route-preview-canvas",
        )}
      >
        <div
          ref={canvas}
          className="size-full"
          aria-label={preview ? m.owner_map_preview_of_route() : m.owner_map_editor_for_route()}
        />
        {error && (
          <p className="absolute inset-0 m-0 grid place-content-center bg-travel-map-bg p-6 text-center">
            {preview
              ? m.owner_the_route_preview_could_not_be_loaded()
              : m.owner_the_map_editor_could_not_be_loaded_you_can_still_paste_coordinates_as_js()}
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
              {m.owner_show_route()}
            </Button>
            <Button
              className="secondary compact"
              type="button"
              disabled={!editorCoordinates.length}
              onClick={() => commit(editorCoordinates.slice(0, -1))}
            >
              {m.owner_remove_last_point()}
            </Button>
            <Button
              className="secondary compact"
              type="button"
              disabled={!editorCoordinates.length}
              onClick={() => commit([])}
            >
              {m.owner_clear_points()}
            </Button>
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.75 text-sm text-travel-muted">
              <span>{m.owner_use_an_area()}</span>
              {suggestions.map((suggestion) => (
                <Button
                  className="secondary compact"
                  type="button"
                  key={suggestion.label}
                  onClick={() => addSuggestion(suggestion)}
                >
                  {m.owner_add_area_point({ name: suggestion.label })}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
      <p className="help" aria-live="polite">
        {editorCoordinates.length === 0
          ? m.owner_no_points_yet_zoom_to_the_region_and_click_the_first_general_point()
          : preview || editorCoordinates.length >= 2
            ? m.owner_route_point_count({ count: editorCoordinates.length })
            : m.owner_point_at_least_two_points_are_needed({ p0: editorCoordinates.length })}
      </p>
      {!preview && editorCoordinates.length > 0 && (
        <ol
          className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.25 p-0 text-xs text-travel-muted"
          aria-label={m.owner_route_points()}
        >
          {editorCoordinates.map(([longitude, latitude], index) => (
            <li key={`${longitude}-${latitude}-${index}`}>
              {m.owner_point()} {index + 1}: {latitude.toFixed(3)}, {longitude.toFixed(3)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
