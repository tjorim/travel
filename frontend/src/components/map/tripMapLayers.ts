import type { RouteMode } from "@/api-types";
import { themeColor } from "@/components/preferences/appearance";
import { styleLabelFont } from "@/lib/map/map-style";
import { routeLineGeometry } from "@/lib/map/route-line-geometry";
import type { FeatureCollection, LineString, MultiLineString, Point } from "geojson";
import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { MapLine, MapPerspective, MapPoint } from "./tripMapTypes";

const terrainUrl = "https://tiles.mapterhorn.com/tilejson.json";
const satelliteUrl =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export const focusFilter = (areaId: string): FilterSpecification => [
  "all",
  ["==", ["get", "kind"], "location"],
  ["==", ["get", "areaId"], areaId],
];

export function applyTerrain(
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

export function applySatellite(instance: MapLibreMap, on: boolean) {
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

export function tripMapPointData(points: MapPoint[]): FeatureCollection<Point> {
  return {
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
}

export function addTripMapLayers(instance: MapLibreMap, points: MapPoint[], lines: MapLine[]) {
  const routeData: FeatureCollection<LineString | MultiLineString> = {
    type: "FeatureCollection",
    features: lines.map((line) => ({
      type: "Feature",
      properties: { id: line.id, transport: line.transport ?? "other" },
      geometry: routeLineGeometry(line.coordinates),
    })),
  };
  const pointData = tripMapPointData(points);
  instance.addSource("routes", { type: "geojson", data: routeData });
  instance.addSource("stops", { type: "geojson", data: pointData });
  const routeStyles: Record<RouteMode, { color: string; width: number; dash?: number[] }> = {
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
}
