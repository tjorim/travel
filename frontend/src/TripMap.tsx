import { routeLineGeometry } from "./route-line-geometry";
import { mapErrorReporter } from "./map-errors";
import { mapMessages, useMapMessages } from "./map-messages";
import { textNotice, useFeedback } from "./query/feedback";
import { useLocale } from "./locale";
import { m } from "./paraglide/messages.js";
import { themeColor, useTheme } from "./appearance";
import { Collapsible } from "@/ui/collapsible";
import { Button } from "@/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import type { FeatureCollection, LineString, MultiLineString, Point } from "geojson";
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
import { ROUTE_MODE_LABELS } from "./records";
import { type RouteMode } from "./api-types";

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
/** An approved photo of a shared update, pinned where that update's shared area sits. */
export type MapPhoto = {
  id: string;
  /** The map point the photo belongs to; the marker lights up while the story is at that point. */
  pointId: string;
  coordinates: [number, number];
  url: string;
  label: string;
  onOpen: () => void;
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
      });
  } else {
    instance.setTerrain(null);
    if (animate) instance.easeTo({ pitch: 0, duration: 700 });
  }
}

/** The theme style's own building paint, kept so turning satellite off restores it. */
const styleBuildingPaint = new WeakMap<MapLibreMap, Map<string, [unknown, unknown]>>();

/**
 * The dark style paints 3D buildings near black, which looks heavy over imagery. While satellite is
 * on, tint them a light stone with some transparency; turning it off restores the style's paint.
 */
export function paintBuildings(instance: MapLibreMap, onSatellite: boolean) {
  const saved = styleBuildingPaint.get(instance) ?? new Map<string, [unknown, unknown]>();
  styleBuildingPaint.set(instance, saved);
  const tint = themeColor("map-building");
  for (const layer of instance.getStyle().layers) {
    if (layer.type !== "fill-extrusion" || layer["source-layer"] !== "building") continue;
    if (onSatellite) {
      const color = instance.getPaintProperty(layer.id, "fill-extrusion-color");
      if (color !== tint)
        saved.set(layer.id, [color, instance.getPaintProperty(layer.id, "fill-extrusion-opacity")]);
      instance.setPaintProperty(layer.id, "fill-extrusion-color", tint);
      instance.setPaintProperty(layer.id, "fill-extrusion-opacity", 0.85);
    } else if (saved.has(layer.id)) {
      const [color, opacity] = saved.get(layer.id) ?? [];
      instance.setPaintProperty(layer.id, "fill-extrusion-color", color as never);
      instance.setPaintProperty(layer.id, "fill-extrusion-opacity", opacity as never);
      saved.delete(layer.id);
    }
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
  paintBuildings(instance, on);
}

/** Frame the majority regional cluster, leaving isolated long-haul stops for the whole-trip view. */
export function framingCoordinates(
  points: MapPoint[],
  lines: MapLine[],
  whole = false,
): [number, number][] {
  if (whole || !points.length)
    return [
      ...points.map((point) => point.coordinates),
      ...lines.flatMap((line) => line.coordinates),
    ];
  const clusters: MapPoint[][] = [];
  const remaining = new Set(points);
  const nearby = (a: MapPoint, b: MapPoint) => {
    const radians = Math.PI / 180;
    const [lng1, lat1] = a.coordinates.map((value) => value * radians);
    const [lng2, lat2] = b.coordinates.map((value) => value * radians);
    const distance =
      12742 *
      Math.asin(
        Math.sqrt(
          Math.sin((lat2 - lat1) / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
        ),
      );
    return distance < 2000;
  };
  for (const point of remaining) {
    const cluster = [point];
    remaining.delete(point);
    for (const member of cluster)
      for (const candidate of remaining)
        if (nearby(member, candidate)) {
          remaining.delete(candidate);
          cluster.push(candidate);
        }
    clusters.push(cluster);
  }
  const largest = clusters.sort((a, b) => b.length - a.length)[0];
  return (largest && largest.length > points.length / 2 ? largest : points).map(
    (point) => point.coordinates,
  );
}

function fitToData(
  instance: MapLibreMap,
  Bounds: typeof import("maplibre-gl").LngLatBounds,
  points: MapPoint[],
  lines: MapLine[],
  duration = 0,
  whole = false,
) {
  const bounds = new Bounds();
  framingCoordinates(points, lines, whole).forEach((coordinate) => bounds.extend(coordinate));
  if (!bounds.isEmpty())
    instance.fitBounds(bounds, { padding: 45, maxZoom: 10, duration, pitch: 0, bearing: 0 });
}

function Heading({
  level,
  ...props
}: { level: number } & React.HTMLAttributes<HTMLHeadingElement>) {
  const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5";
  return <Tag {...props} />;
}

/** The owner-only points to frame when an area is focused. */
export function areaFocusPoints(area: MapPoint, points: MapPoint[]): MapPoint[] {
  return [area, ...points.filter((point) => point.kind === "location" && point.areaId === area.id)];
}

export function TripMap({
  points,
  lines,
  owner = false,
  collapseLists = false,
  wide = false,
  bare = false,
  headingLevel = 3,
  perspective,
  styleUrl = configuredMapStyleUrl,
  focus,
  follow,
  photos,
  onUseDerived,
}: {
  points: MapPoint[];
  lines: MapLine[];
  owner?: boolean;
  collapseLists?: boolean;
  /** A visitor map beside the trip context: taller on wide screens, as the owner map is. */
  wide?: boolean;
  /**
   * Below the width where the map sits beside the story, drop the card around the map and keep its heading for
   * assistive technology only, so the map itself gets the room; the canvas also grows to most of the window.
   */
  bare?: boolean;
  /** The level of the map's own heading; the point and route lists sit one level below it. */
  headingLevel?: 2 | 3;
  perspective?: MapPerspective;
  styleUrl?: string;
  focus?: { id: string; request: number } | null;
  /** The point the story is at: the map eases to it and rings it, without opening its details. */
  follow?: string | null;
  /** Photos from the story pinned on the map; a click or tap opens the update. They are for pointer users only. */
  photos?: MapPhoto[];
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
        setError(textNotice(() => m.map_webgl_unsupported()));
        return;
      }
      const probe = document.createElement("canvas");
      if (!probe.getContext("webgl2") && !probe.getContext("webgl")) {
        setError(textNotice(() => m.map_webgl_unsupported()));
        return;
      }
    } catch {
      setError(textNotice(() => m.map_unavailable()));
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
          const routeData: FeatureCollection<LineString | MultiLineString> = {
            type: "FeatureCollection",
            features: lines.map((line) => ({
              type: "Feature",
              properties: { id: line.id, transport: line.transport ?? "other" },
              geometry: routeLineGeometry(line.coordinates),
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
          instance.addLayer({
            id: "followed-stop",
            type: "circle",
            source: "stops",
            filter: ["==", ["get", "id"], ""],
            paint: {
              "circle-radius": 20,
              "circle-color": themeColor("map-yellow"),
              "circle-opacity": 0.18,
              "circle-stroke-width": 3,
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
              setError(textNotice(() => m.map_unavailable()));
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
        // Only a failure that leaves the owner without a map gets a notice; see mapErrorReporter.
        const reporter = mapErrorReporter({
          style: () => setError(textNotice(() => m.map_style_load_error())),
          tiles: () => setError(textNotice(() => m.map_tiles_incomplete())),
          clear: () => setError(""),
        });
        created.on("sourcedata", (event) => {
          if (event.tile && !disposed) reporter.tileLoaded();
        });
        created.on("error", (event) => {
          if (!disposed) reporter.error(event, Boolean(created.isStyleLoaded()));
        });
      })
      .catch(() => {
        if (!disposed) setError(textNotice(() => m.map_unavailable()));
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

  // The story moves the map without selecting anything: ring the point and ease it into view. A visitor who asks for
  // reduced motion gets a jump, because this move is not essential.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance?.getLayer("followed-stop")) return;
    const point = follow ? points.find((candidate) => candidate.id === follow) : undefined;
    instance.setFilter("followed-stop", ["==", ["get", "id"], point?.id ?? ""]);
    if (point) instance.easeTo({ center: point.coordinates, zoom: 9, duration: 700 });
  }, [follow, ready]);

  // Photo markers are pointer shortcuts laid over the map; the same updates stay reachable from the point buttons below it.
  const photoKey = JSON.stringify(
    (photos ?? []).map(({ id, url, coordinates }) => [id, url, coordinates]),
  );
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => {
    const instance = map.current;
    const shown = photosRef.current ?? [];
    if (!ready || !instance || !shown.length) return;
    let cancelled = false;
    const markers: { remove: () => void }[] = [];
    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || map.current !== instance) return;
      for (const photo of shown) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "travel-map-photo";
        // The map is one image to assistive technology, so a control inside it cannot be reached. Keyboard and
        // screen reader visitors use the point buttons under the map, whose cards link to the same update.
        button.tabIndex = -1;
        button.setAttribute("aria-hidden", "true");
        button.title = photo.label;
        button.dataset.pointId = photo.pointId;
        if (follow === photo.pointId) button.dataset.active = "";
        button.addEventListener("click", (event) => {
          // The click belongs to the marker; the map under it must not also treat it as a tap on a point.
          event.stopPropagation();
          photosRef.current?.find((candidate) => candidate.id === photo.id)?.onOpen();
        });
        const image = document.createElement("img");
        image.src = photo.url;
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        button.append(image);
        markers.push(
          new maplibregl.Marker({ element: button }).setLngLat(photo.coordinates).addTo(instance),
        );
      }
    });
    return () => {
      cancelled = true;
      for (const marker of markers) marker.remove();
    };
  }, [ready, photoKey]);
  useEffect(() => {
    for (const button of canvas.current?.querySelectorAll<HTMLElement>(".travel-map-photo") ?? [])
      if (follow && button.dataset.pointId === follow) button.dataset.active = "";
      else delete button.dataset.active;
  }, [follow, ready, photoKey]);

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
      setError(textNotice(() => m.map_terrain_load_error()));
    }
  }

  function viewLabel(view: string, on: boolean) {
    return on ? m.map_view_on({ view }) : view;
  }

  function toggleGlobe() {
    const instance = map.current;
    if (!instance || !ready) return;
    try {
      instance.setProjection({ type: globe ? "mercator" : "globe" });
      setGlobe(!globe);
      setError("");
    } catch {
      setError(textNotice(() => m.map_globe_load_error()));
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
      setError(textNotice(() => m.map_satellite_load_error()));
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
      if (map.current === instance) fitToData(instance, LngLatBounds, points, lines, 500, true);
    });
  }

  const links = selectedPoint?.links ?? selectedLine?.links ?? [];

  if (!hasGeometry)
    return (
      <section className="travel-card grid min-w-0 gap-3.5">
        <Heading level={headingLevel} className="m-0">
          {m.map_title()}
        </Heading>
        <p>{m.map_no_map_coordinates_are_available_for_this_trip_yet()}</p>
      </section>
    );
  return (
    <section
      className={cn("grid min-w-0 gap-3.5", bare ? "min-[1100px]:travel-card" : "travel-card")}
      aria-label={m.map_trip_map()}
    >
      <Heading level={headingLevel} className={cn("m-0", bare && "max-[1099px]:sr-only")}>
        {m.map_title()}
      </Heading>
      <div
        className={cn(
          "relative h-map-canvas overflow-hidden rounded-xl border border-travel-border bg-travel-map-bg",
          owner && "min-[960px]:h-map-owner-canvas",
          wide && "min-[1100px]:h-map-wide-canvas",
          bare && "max-[1099px]:h-map-phone-canvas",
        )}
      >
        <div
          ref={canvas}
          className="size-full"
          // A group, not an image: the map library puts a focusable canvas and marker controls inside it.
          role="group"
          aria-label={m.map_with_points_and_routes()}
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
            {m.map_unavailable_point_buttons()}
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
          {m.map_show_whole_trip()}
        </Button>
        <ToggleGroup
          multiple
          aria-label={m.map_view()}
          value={[terrain && "terrain", satellite && "satellite", globe && "globe"].filter(
            (name) => typeof name === "string",
          )}
        >
          <ToggleGroupItem value="terrain" disabled={!ready} onClick={toggleTerrain}>
            {viewLabel(perspective?.label ?? m.map_3d_terrain(), terrain)}
          </ToggleGroupItem>
          <ToggleGroupItem value="satellite" disabled={!ready} onClick={toggleSatellite}>
            {viewLabel(m.map_satellite(), satellite)}
          </ToggleGroupItem>
          <ToggleGroupItem value="globe" disabled={!ready} onClick={toggleGlobe}>
            {viewLabel(m.map_globe(), globe)}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {satellite && <p className="help">{m.map_buildings_zoom_hint()}</p>}
      <p className="m-0 text-sm">{m.map_provider_privacy_notice()}</p>
      {(selectedPoint || selectedLine) && (
        <div
          className="rounded-travel-media border border-travel-border bg-travel-map-detail px-4 py-3.5 [&_a]:font-bold [&_a]:text-travel-forest [&_p]:mt-1.25 [&_p]:mb-0 [&_ul]:mt-2.5 [&_ul]:mb-0 [&_ul]:flex [&_ul]:list-none [&_ul]:flex-wrap [&_ul]:gap-x-4 [&_ul]:gap-y-2 [&_ul]:p-0"
          aria-live="polite"
        >
          <strong>{selectedPoint?.label ?? selectedLine?.label}</strong>
          {(selectedLine?.from || selectedLine?.to) && (
            <p>
              {selectedLine.from ?? m.map_unknown_departure()} →{" "}
              {selectedLine.to ?? m.map_unknown_arrival()}
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
              {m.map_use_as_point()}
            </Button>
          )}
        </div>
      )}
      {points.length > 0 && (
        <Collapsible.Root defaultOpen={!collapseLists}>
          <Heading level={headingLevel + 1}>
            <Collapsible.Trigger className="min-h-11 rounded-travel-control bg-transparent text-left font-bold text-travel-forest underline focus-visible:outline-3 focus-visible:outline-travel-focus">
              {m.map_points_count({ count: points.length })}
            </Collapsible.Trigger>
          </Heading>
          <Collapsible.Panel>
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
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
      {lines.length > 0 && (
        <Collapsible.Root defaultOpen={!collapseLists}>
          <Heading level={headingLevel + 1}>
            <Collapsible.Trigger className="min-h-11 rounded-travel-control bg-transparent text-left font-bold text-travel-forest underline focus-visible:outline-3 focus-visible:outline-travel-focus">
              {m.map_lines_count({ count: lines.length })}
            </Collapsible.Trigger>
          </Heading>
          <Collapsible.Panel>
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
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </section>
  );
}
