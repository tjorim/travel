import { mapMessages, useMapMessages } from "./map-messages";
import { textNotice, useFeedback } from "./query/feedback";
import { useLocale } from "./locale";
import { m } from "./paraglide/messages.js";
import { themeColor, useTheme } from "./appearance";
import { Button } from "@base-ui/react/button";
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import type { FeatureCollection, LineString, Point } from "geojson";
import type { FilterSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {
  configuredMapStyleUrl,
  loadMapStyle,
  readCamera,
  styleLabelFont,
  type MapCamera,
} from "./map-style";
import { ROUTE_MODE_LABELS, type RouteMode } from "./tracker-model";

export type MapLink = { label: string; href?: string; onOpen?: () => void };
export type MapPoint = {
  id: string;
  label: string;
  coordinates: [number, number];
  kind?: "mountain" | "stay" | "airport" | "place" | "area" | "derived" | "location";
  areaId?: string;
  detail?: string;
  dates?: string;
  links?: MapLink[];
};
export type MapLine = {
  id: string;
  label: string;
  coordinates: [number, number][];
  transport?: RouteMode;
  from?: string;
  to?: string;
  dates?: string;
  links?: MapLink[];
};
export type MapPerspective = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  label?: string;
  exaggeration?: number;
};

const terrainUrl = "https://tiles.mapterhorn.com/tilejson.json";
const satelliteUrl =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const attribution = (
  <>
    <a href="https://openfreemap.org" target="_blank" rel="noreferrer" referrerPolicy="no-referrer">
      © OpenFreeMap
    </a>{" "}
    ·{" "}
    <a
      href="https://openmaptiles.org"
      target="_blank"
      rel="noreferrer"
      referrerPolicy="no-referrer"
    >
      OpenMapTiles
    </a>{" "}
    ·{" "}
    <a
      href="https://www.openstreetmap.org/copyright"
      target="_blank"
      rel="noreferrer"
      referrerPolicy="no-referrer"
    >
      © OpenStreetMap
    </a>
  </>
);
/** What a theme change must carry over to the rebuilt map; any other rebuild starts from the whole trip. */
type ViewSnapshot = {
  geometryKey: string;
  styleUrl: string;
  camera: MapCamera;
  terrain: boolean;
  satellite: boolean;
  globe: boolean;
  selected: string | null;
  selectedKind: "point" | "line" | null;
};

const focusFilter = (areaId: string): FilterSpecification => [
  "all",
  ["==", ["get", "kind"], "location"],
  ["==", ["get", "areaId"], areaId],
];

function applyTerrain(
  instance: MapLibreMap,
  on: boolean,
  perspective: MapPerspective | undefined,
  animate: boolean,
) {
  if (on) {
    if (!instance.getSource("terrain"))
      instance.addSource("terrain", {
        type: "raster-dem",
        url: terrainUrl,
        tileSize: 512,
        encoding: "terrarium",
      });
    instance.setTerrain({ source: "terrain", exaggeration: perspective?.exaggeration ?? 1.35 });
    if (animate)
      instance.easeTo({
        pitch: Math.min(perspective?.pitch ?? 55, 60),
        duration: 700,
        essential: true,
      });
  } else {
    instance.setTerrain(null);
    if (animate) instance.easeTo({ pitch: 0, duration: 700, essential: true });
  }
}

function applySatellite(instance: MapLibreMap, on: boolean) {
  if (!instance.getSource("satellite"))
    instance.addSource("satellite", {
      type: "raster",
      tiles: [satelliteUrl],
      tileSize: 256,
      maxzoom: 19,
    });
  if (!instance.getLayer("satellite")) {
    const layers = instance.getStyle().layers;
    const buildingLayer = layers.find(
      (layer) => layer.type === "fill-extrusion" && layer["source-layer"] === "building",
    );
    const beforeLayer =
      buildingLayer?.id ?? layers.find((layer) => layer.type === "symbol")?.id ?? "route-flight";
    instance.addLayer(
      {
        id: "satellite",
        type: "raster",
        source: "satellite",
        layout: { visibility: "none" },
        paint: { "raster-fade-duration": 150 },
      },
      beforeLayer,
    );
  }
  instance.setLayoutProperty("satellite", "visibility", on ? "visible" : "none");
}

function fitToData(
  instance: MapLibreMap,
  Bounds: typeof import("maplibre-gl").LngLatBounds,
  points: MapPoint[],
  lines: MapLine[],
  duration = 0,
) {
  const bounds = new Bounds();
  points.forEach((point) => bounds.extend(point.coordinates));
  lines.forEach((line) => line.coordinates.forEach((coordinate) => bounds.extend(coordinate)));
  if (!bounds.isEmpty())
    instance.fitBounds(bounds, { padding: 45, maxZoom: 10, duration, pitch: 0, bearing: 0 });
}

/** The owner-only points to frame when an area is focused. */
export function areaFocusPoints(area: MapPoint, points: MapPoint[]): MapPoint[] {
  return [area, ...points.filter((point) => point.kind === "location" && point.areaId === area.id)];
}

export function TripMap({
  points,
  lines,
  owner = false,
  wide = false,
  perspective,
  styleUrl = configuredMapStyleUrl,
  focus,
  onUseDerived,
}: {
  points: MapPoint[];
  lines: MapLine[];
  owner?: boolean;
  /** A visitor map beside the trip context: taller on wide screens, as the owner map is. */
  wide?: boolean;
  perspective?: MapPerspective;
  styleUrl?: string;
  focus?: { id: string; request: number } | null;
  onUseDerived?: (point: MapPoint) => void;
}) {
  useLocale();
  const theme = useTheme();
  const data = useRef({ points, lines });
  data.current = { points, lines };
  // Translated chrome and action labels change without rebuilding the map or resetting its camera.
  const geometryKey = JSON.stringify([
    points.map(({ id, coordinates, kind, areaId }) => ({ id, coordinates, kind, areaId })),
    lines.map(({ id, coordinates, transport }) => ({ id, coordinates, transport })),
  ]);
  const canvas = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  useMapMessages(canvas, ready);
  const [error, setError] = useFeedback<string>("");
  const [terrain, setTerrain] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [globe, setGlobe] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<"point" | "line" | null>(null);
  const [hovered, setHovered] = useState("");
  const selectedPoint =
    selectedKind === "point" ? points.find((point) => point.id === selected) : undefined;
  const selectedLine =
    selectedKind === "line" ? lines.find((line) => line.id === selected) : undefined;
  const hasGeometry = points.length > 0 || lines.length > 0;
  // The cleanup of a rebuild reads the latest view here and leaves a snapshot for the next build to restore.
  const view = useRef({ terrain, satellite, globe, selected, selectedKind });
  view.current = { terrain, satellite, globe, selected, selectedKind };
  const snapshot = useRef<ViewSnapshot | null>(null);
  const appliedFocus = useRef<number | undefined>(undefined);
  const perspectiveRef = useRef(perspective);
  perspectiveRef.current = perspective;

  useEffect(() => {
    if (!hasGeometry || !canvas.current) return;
    let disposed = false;
    let instance: MapLibreMap | null = null;
    const controller = new AbortController();
    // A theme change keeps the viewed region, selection and layer toggles; anything else starts over.
    const restore =
      snapshot.current?.geometryKey === geometryKey && snapshot.current.styleUrl === styleUrl
        ? snapshot.current
        : null;
    snapshot.current = null;
    let loaded = false;
    setReady(false);
    setError("");
    if (!restore) {
      appliedFocus.current = undefined;
      setTerrain(false);
      setSatellite(false);
      setGlobe(false);
      setSelected(null);
      setSelectedKind(null);
    }
    try {
      if (!window.WebGLRenderingContext) {
        setError(
          textNotice(() => m.owner_this_browser_does_not_support_webgl_use_the_route_in_words()),
        );
        return;
      }
      const probe = document.createElement("canvas");
      if (!probe.getContext("webgl2") && !probe.getContext("webgl")) {
        setError(
          textNotice(() => m.owner_this_browser_does_not_support_webgl_use_the_route_in_words()),
        );
        return;
      }
    } catch {
      setError(
        textNotice(() => m.owner_the_interactive_map_is_unavailable_use_the_route_in_words()),
      );
      return;
    }
    void Promise.all([import("maplibre-gl"), loadMapStyle(styleUrl, controller.signal, theme)])
      .then(([maplibregl, style]) => {
        if (disposed || !canvas.current) return;
        maplibregl.setWorkerUrl(mapWorkerUrl);
        const created = new maplibregl.Map({
          locale: mapMessages(),
          container: canvas.current,
          style,
          ...restore?.camera,
          attributionControl: false,
          renderWorldCopies: false,
          maxPitch: 60,
          transformRequest: (url: string) => ({ url, credentials: "same-origin" }),
        });
        instance = created;
        map.current = instance;
        created.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        created.on("load", () => {
          if (!instance || disposed) return;
          const routeData: FeatureCollection<LineString> = {
            type: "FeatureCollection",
            features: lines.map((line) => ({
              type: "Feature",
              properties: { id: line.id, transport: line.transport ?? "other" },
              geometry: { type: "LineString", coordinates: line.coordinates },
            })),
          };
          const pointData: FeatureCollection<Point> = {
            type: "FeatureCollection",
            features: points.map((point) => ({
              type: "Feature",
              properties: {
                id: point.id,
                label: point.label,
                kind: point.kind ?? "place",
                areaId: point.areaId ?? "",
              },
              geometry: { type: "Point", coordinates: point.coordinates },
            })),
          };
          instance.addSource("routes", { type: "geojson", data: routeData });
          instance.addSource("stops", { type: "geojson", data: pointData });
          const routeStyles: Record<RouteMode, { color: string; width: number; dash?: number[] }> =
            {
              flight: { color: themeColor("map-marker"), width: 3, dash: [2, 2] },
              train: { color: themeColor("map-blue"), width: 4, dash: [2, 1.4] },
              bus: { color: themeColor("map-gold"), width: 4 },
              car: { color: themeColor("map-orange"), width: 4 },
              ferry: { color: themeColor("map-cyan"), width: 4, dash: [3, 1.5] },
              bike: { color: themeColor("link"), width: 4, dash: [1.5, 1.2] },
              walk: { color: themeColor("map-olive"), width: 3, dash: [0.6, 1.6] },
              other: { color: themeColor("map-grey"), width: 3 },
            };
          for (const [transport, routeStyle] of Object.entries(routeStyles)) {
            instance.addLayer({
              id: `route-${transport}`,
              type: "line",
              source: "routes",
              filter: ["==", ["get", "transport"], transport],
              paint: {
                "line-color": routeStyle.color,
                "line-width": routeStyle.width,
                ...(routeStyle.dash ? { "line-dasharray": routeStyle.dash } : {}),
              },
              layout: { "line-cap": "round", "line-join": "round" },
            });
          }
          instance.addLayer({
            id: "route-hit",
            type: "line",
            source: "routes",
            paint: { "line-color": themeColor("ink"), "line-width": 22, "line-opacity": 0 },
          });
          instance.addLayer({
            id: "stop-halo",
            type: "circle",
            source: "stops",
            filter: ["!=", ["get", "kind"], "location"],
            paint: {
              "circle-radius": 12,
              "circle-color": themeColor("map-blue"),
              "circle-opacity": 0.22,
            },
          });
          instance.addLayer({
            id: "stops",
            type: "circle",
            source: "stops",
            filter: ["!=", ["get", "kind"], "location"],
            paint: {
              "circle-color": [
                "match",
                ["get", "kind"],
                "mountain",
                themeColor("map-mint"),
                "stay",
                themeColor("map-blue"),
                "airport",
                themeColor("map-yellow"),
                "area",
                themeColor("map-marker"),
                "derived",
                themeColor("surface"),
                themeColor("map-marker"),
              ],
              "circle-radius": 8,
              "circle-stroke-color": themeColor("ink"),
              "circle-stroke-width": ["match", ["get", "kind"], "derived", 3, 2],
            },
          });
          instance.addLayer({
            id: "locations",
            type: "circle",
            source: "stops",
            filter: ["==", ["get", "kind"], "location"],
            minzoom: 9,
            paint: {
              "circle-radius": 5,
              "circle-color": themeColor("map-blue"),
              "circle-stroke-color": themeColor("ink"),
              "circle-stroke-width": 1,
            },
          });
          instance.addLayer({
            id: "focused-locations",
            type: "circle",
            source: "stops",
            filter: ["all", ["==", ["get", "kind"], "location"], ["==", ["get", "areaId"], ""]],
            maxzoom: 9,
            paint: {
              "circle-radius": 5,
              "circle-color": themeColor("map-blue"),
              "circle-stroke-color": themeColor("ink"),
              "circle-stroke-width": 1,
            },
          });
          instance.addLayer({
            id: "area-labels",
            type: "symbol",
            source: "stops",
            filter: ["in", ["get", "kind"], ["literal", ["area", "derived"]]],
            layout: {
              "text-field": ["get", "label"],
              "text-font": styleLabelFont(instance.getStyle()),
              "text-size": 13,
              "text-offset": [0, 1.3],
              "text-anchor": "top",
            },
            paint: {
              "text-color": themeColor("ink"),
              "text-halo-color": themeColor("surface"),
              "text-halo-width": 2,
            },
          });
          instance.addLayer(
            {
              id: "selected-route",
              type: "line",
              source: "routes",
              filter: ["==", ["get", "id"], ""],
              paint: { "line-color": themeColor("ink"), "line-width": 10, "line-opacity": 0.65 },
              layout: { "line-cap": "round", "line-join": "round" },
            },
            "stop-halo",
          );
          instance.addLayer({
            id: "selected-stop",
            type: "circle",
            source: "stops",
            filter: ["==", ["get", "id"], ""],
            paint: {
              "circle-radius": 15,
              "circle-color": themeColor("map-yellow"),
              "circle-opacity": 0.32,
              "circle-stroke-width": 2,
              "circle-stroke-color": themeColor("map-yellow"),
            },
          });
          if (restore) {
            try {
              if (restore.satellite) applySatellite(instance, true);
              if (restore.terrain) applyTerrain(instance, true, perspectiveRef.current, false);
              if (restore.globe) instance.setProjection({ type: "globe" });
              const area = data.current.points.find((point) => point.id === restore.selected);
              if (
                restore.selectedKind === "point" &&
                owner &&
                (area?.kind === "area" || area?.kind === "derived")
              )
                instance.setFilter("focused-locations", focusFilter(area.id));
            } catch {
              setTerrain(false);
              setSatellite(false);
              setGlobe(false);
              setError(
                textNotice(() =>
                  m.owner_the_interactive_map_is_unavailable_use_the_route_in_words(),
                ),
              );
            }
          } else fitToData(instance, maplibregl.LngLatBounds, points, lines);
          loaded = true;
          instance.on("click", "stops", (event) => {
            const point = data.current.points.find(
              (candidate) => candidate.id === event.features?.[0]?.properties?.id,
            );
            if (point) selectPoint(point);
          });
          instance.on("click", "locations", (event) => {
            const point = data.current.points.find(
              (candidate) => candidate.id === event.features?.[0]?.properties?.id,
            );
            if (point) selectPoint(point);
          });
          instance.on("click", "focused-locations", (event) => {
            const point = data.current.points.find(
              (candidate) => candidate.id === event.features?.[0]?.properties?.id,
            );
            if (point) selectPoint(point);
          });
          instance.on("mouseenter", "stops", () => {
            if (instance) instance.getCanvas().style.cursor = "pointer";
          });
          instance.on("mouseleave", "stops", () => {
            if (instance) instance.getCanvas().style.cursor = "";
          });
          const routeLayers = ["route-hit"];
          instance.on("click", routeLayers, (event) => {
            // Markers sit above routes. Keep a tap on an overlapping marker a point selection.
            if (
              instance?.queryRenderedFeatures(event.point, {
                layers: ["stops", "locations", "focused-locations"],
              }).length
            )
              return;
            const line = data.current.lines.find(
              (candidate) => candidate.id === event.features?.[0]?.properties?.id,
            );
            if (line) selectLine(line);
          });
          instance.on("mousemove", routeLayers, (event) => {
            const line = data.current.lines.find(
              (candidate) => candidate.id === event.features?.[0]?.properties?.id,
            );
            setHovered(line?.label ?? "");
            if (instance) instance.getCanvas().style.cursor = "pointer";
          });
          instance.on("mouseleave", routeLayers, () => {
            setHovered("");
            if (instance) instance.getCanvas().style.cursor = "";
          });
          instance.on("mousemove", ["stops", "locations", "focused-locations"], (event) => {
            setHovered(
              points.find((candidate) => candidate.id === event.features?.[0]?.properties?.id)
                ?.label ?? "",
            );
          });
          instance.on("mouseleave", ["stops", "locations", "focused-locations"], () =>
            setHovered(""),
          );
          setReady(true);
        });
        created.on("error", () => {
          if (!disposed)
            setError(
              textNotice(() =>
                created.isStyleLoaded()
                  ? m.owner_map_tiles_could_not_be_fully_loaded_the_route_in_words_remains_available()
                  : m.owner_the_map_style_could_not_be_loaded_use_the_route_in_words(),
              ),
            );
        });
      })
      .catch(() => {
        if (!disposed)
          setError(
            textNotice(() => m.owner_the_interactive_map_is_unavailable_use_the_route_in_words()),
          );
      });
    return () => {
      disposed = true;
      controller.abort();
      if (instance && loaded)
        snapshot.current = { geometryKey, styleUrl, camera: readCamera(instance), ...view.current };
      instance?.remove();
      map.current = null;
    };
  }, [geometryKey, hasGeometry, styleUrl, theme]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("stops") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: points.map((point) => ({
        type: "Feature",
        properties: {
          id: point.id,
          label: point.label,
          kind: point.kind ?? "place",
          areaId: point.areaId ?? "",
        },
        geometry: { type: "Point", coordinates: point.coordinates },
      })),
    });
  }, [points, ready]);

  useEffect(() => {
    if (ready && map.current?.getLayer("selected-stop"))
      map.current.setFilter("selected-stop", ["==", ["get", "id"], selectedPoint?.id ?? ""]);
    if (ready && map.current?.getLayer("selected-route"))
      map.current.setFilter("selected-route", ["==", ["get", "id"], selectedLine?.id ?? ""]);
  }, [ready, selectedPoint, selectedLine]);

  // An outside request (such as an agenda entry) selects a stop by id; the
  // request counter lets the same stop be chosen again.
  useEffect(() => {
    const point = focus ? points.find((candidate) => candidate.id === focus.id) : undefined;
    // A rebuilt map keeps its restored view rather than flying back to a stop it already showed.
    if (!point || (ready && appliedFocus.current === focus?.request)) return;
    if (ready) appliedFocus.current = focus?.request;
    selectPoint(point);
  }, [focus?.request, ready]);

  function toggleTerrain() {
    const instance = map.current;
    if (!instance || !ready) return;
    try {
      applyTerrain(instance, !terrain, perspective, true);
      setTerrain(!terrain);
      setError("");
    } catch {
      setError(
        textNotice(() => m.owner_3d_terrain_could_not_be_loaded_the_route_map_remains_available()),
      );
    }
  }

  function toggleGlobe() {
    const instance = map.current;
    if (!instance || !ready) return;
    try {
      instance.setProjection({ type: globe ? "mercator" : "globe" });
      setGlobe(!globe);
      setError("");
    } catch {
      setError(
        textNotice(() =>
          m.owner_the_globe_view_could_not_be_shown_the_route_map_remains_available(),
        ),
      );
    }
  }

  function toggleSatellite() {
    const instance = map.current;
    if (!instance || !ready) return;
    try {
      applySatellite(instance, !satellite);
      setSatellite(!satellite);
      setError("");
    } catch {
      setError(
        textNotice(() =>
          m.owner_satellite_imagery_could_not_be_loaded_the_route_map_remains_available(),
        ),
      );
    }
  }

  function selectPoint(point: MapPoint) {
    setSelected(point.id);
    setSelectedKind("point");
    const instance = map.current;
    if (!instance) return;
    const focusedArea = owner && (point.kind === "area" || point.kind === "derived");
    instance.setFilter("focused-locations", focusFilter(focusedArea ? point.id : ""));
    const group = focusedArea ? areaFocusPoints(point, points) : [point];
    if (group.length > 1) {
      const longitudes = group.map((member) => member.coordinates[0]);
      const latitudes = group.map((member) => member.coordinates[1]);
      instance.fitBounds(
        [
          [Math.min(...longitudes), Math.min(...latitudes)],
          [Math.max(...longitudes), Math.max(...latitudes)],
        ],
        { padding: 60, maxZoom: 11, duration: 500, pitch: 0, bearing: 0 },
      );
    } else {
      instance.flyTo({
        center: point.coordinates,
        zoom: Math.max(instance.getZoom(), satellite ? 15 : 9),
        essential: true,
      });
    }
  }

  function selectLine(line: MapLine) {
    setSelected(line.id);
    setSelectedKind("line");
    const instance = map.current;
    if (!instance) return;
    instance.setFilter("focused-locations", focusFilter(""));
    let west = 180,
      east = -180,
      south = 90,
      north = -90;
    for (const [longitude, latitude] of line.coordinates) {
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }
    instance.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 45, maxZoom: 12, duration: 500 },
    );
  }

  function resetFocus() {
    setSelected(null);
    setSelectedKind(null);
    const instance = map.current;
    if (!instance) return;
    instance.setFilter("focused-locations", focusFilter(""));
    void import("maplibre-gl").then(({ LngLatBounds }) => {
      if (map.current === instance) fitToData(instance, LngLatBounds, points, lines, 500);
    });
  }

  const links = selectedPoint?.links ?? selectedLine?.links ?? [];

  if (!hasGeometry)
    return (
      <section className="travel-card grid min-w-0 gap-3.5">
        <h3 className="m-0">{m.owner_map()}</h3>
        <p>{m.owner_no_map_coordinates_are_available_for_this_trip_yet()}</p>
      </section>
    );
  return (
    <section className="travel-card grid min-w-0 gap-3.5" aria-label={m.owner_trip_map()}>
      <h3 className="m-0">{m.owner_map()}</h3>
      <div
        className={cn(
          "relative h-map-canvas overflow-hidden rounded-xl border border-travel-border bg-travel-map-bg",
          owner && "min-[960px]:h-map-owner-canvas",
          wide && "min-[1100px]:h-map-wide-canvas",
        )}
      >
        <div
          ref={canvas}
          className="size-full"
          role="img"
          aria-label={m.owner_map_with_points_and_routes()}
        />
        {hovered && (
          <span
            className="pointer-events-none absolute top-3 left-3 max-w-full rounded-md bg-travel-surface px-2.25 py-1.25 text-sm text-travel-ink shadow-md"
            aria-hidden="true"
          >
            {hovered}
          </span>
        )}
        {error && !ready && (
          <p className="absolute inset-0 m-0 grid place-content-center bg-travel-map-bg p-6 text-center text-travel-muted">
            {m.owner_interactive_map_unavailable_use_the_route_in_words_and_the_point_buttons()}
          </p>
        )}
        <div className="absolute right-0 bottom-0 z-2 max-w-full bg-travel-surface/90 px-1.5 py-0.75 text-xs text-travel-ink [&_a]:text-inherit">
          {attribution}
          {terrain && (
            <>
              {" "}
              ·{" "}
              <a
                href="https://mapterhorn.com/attribution"
                target="_blank"
                rel="noreferrer"
                referrerPolicy="no-referrer"
              >
                © Mapterhorn
              </a>
            </>
          )}
          {satellite && (
            <>
              {" "}
              ·{" "}
              <a
                href="https://www.esri.com/"
                target="_blank"
                rel="noreferrer"
                referrerPolicy="no-referrer"
              >
                © Esri
              </a>
              , Maxar, Earthstar Geographics, and the GIS User Community
            </>
          )}
        </div>
      </div>
      {error && (
        <p role="status" className="help">
          {error}
        </p>
      )}
      <div className="button-row">
        <Button className="secondary compact" type="button" onClick={resetFocus}>
          {m.owner_show_whole_trip()}
        </Button>
        <Button
          className={cn(
            "secondary compact",
            terrain &&
              "border-travel-forest! bg-travel-forest! text-travel-on-action! inset-shadow-sm",
          )}
          type="button"
          aria-pressed={terrain}
          disabled={!ready}
          onClick={toggleTerrain}
        >
          {perspective?.label ?? m.owner_3d_terrain()}
          {terrain && m.owner_on()}
        </Button>
        <Button
          className={cn(
            "secondary compact",
            satellite &&
              "border-travel-forest! bg-travel-forest! text-travel-on-action! inset-shadow-sm",
          )}
          type="button"
          aria-pressed={satellite}
          disabled={!ready}
          onClick={toggleSatellite}
        >
          {m.owner_satellite()}
          {satellite && m.owner_on()}
        </Button>
        <Button
          className={cn(
            "secondary compact",
            globe &&
              "border-travel-forest! bg-travel-forest! text-travel-on-action! inset-shadow-sm",
          )}
          type="button"
          aria-pressed={globe}
          disabled={!ready}
          onClick={toggleGlobe}
        >
          {m.owner_globe()}
          {globe && m.owner_on()}
        </Button>
      </div>
      {satellite && (
        <p className="help">
          {m.owner_zoom_in_on_a_city_to_see_the_3d_buildings_above_the_satellite_imagery()}
        </p>
      )}
      <p className="m-0 text-sm">
        {m.owner_map_tiles_show_the_viewed_region_to_openfreemap_when_enabled_3d_terrain()}
      </p>
      {(selectedPoint || selectedLine) && (
        <div
          className="rounded-travel-media border border-travel-border bg-travel-map-detail px-4 py-3.5 [&_a]:font-bold [&_a]:text-travel-forest [&_p]:mt-1.25 [&_p]:mb-0 [&_ul]:mt-2.5 [&_ul]:mb-0 [&_ul]:flex [&_ul]:list-none [&_ul]:flex-wrap [&_ul]:gap-x-4 [&_ul]:gap-y-2 [&_ul]:p-0"
          aria-live="polite"
        >
          <strong>{selectedPoint?.label ?? selectedLine?.label}</strong>
          {(selectedLine?.from || selectedLine?.to) && (
            <p>
              {selectedLine.from ?? m.owner_unknown_departure()} →{" "}
              {selectedLine.to ?? m.owner_unknown_arrival()}
            </p>
          )}
          {selectedLine?.transport && <p>{ROUTE_MODE_LABELS[selectedLine.transport]}</p>}
          {(selectedPoint?.detail || selectedPoint?.dates || selectedLine?.dates) && (
            <p>
              {[selectedPoint?.detail, selectedPoint?.dates, selectedLine?.dates]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {links.length > 0 && (
            <ul>
              {links.map((link, index) => (
                <li key={`${link.label}-${index}`}>
                  {link.href ? (
                    <a href={link.href}>{link.label}</a>
                  ) : (
                    <Button className="secondary compact" type="button" onClick={link.onOpen}>
                      {link.label}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {selectedPoint?.kind === "derived" && onUseDerived && (
            <Button
              className="secondary compact"
              type="button"
              onClick={() => onUseDerived(selectedPoint)}
            >
              {m.owner_use_as_point()}
            </Button>
          )}
        </div>
      )}
      {points.length > 0 && (
        <div>
          <h4>{m.owner_points_on_the_map()}</h4>
          <ol className="flex list-none flex-wrap gap-1.75 p-0">
            {points.map((point) => (
              <li key={point.id}>
                <Button
                  className="secondary compact"
                  type="button"
                  aria-pressed={selectedKind === "point" && selected === point.id}
                  onClick={() => selectPoint(point)}
                >
                  {point.label}
                </Button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {lines.length > 0 && (
        <div>
          <h4>{m.owner_route_in_words()}</h4>
          <ol className="mb-0 pl-5.5">
            {lines.map((line) => (
              <li key={line.id}>
                <Button
                  className="secondary compact text-left"
                  type="button"
                  aria-pressed={selectedKind === "line" && selected === line.id}
                  onClick={() => selectLine(line)}
                >
                  {line.from && line.to ? `${line.from} → ${line.to} · ` : ""}
                  {line.label}
                </Button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
