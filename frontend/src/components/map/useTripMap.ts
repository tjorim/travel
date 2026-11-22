import { useTheme } from "@/components/preferences/appearance";
import { textNotice, useFeedback } from "@/lib/api/feedback";
import { mapErrorReporter } from "@/lib/map/map-errors";
import { mapMessages, useMapMessages } from "@/lib/map/map-messages";
import { loadMapStyle, readCamera, type MapCamera } from "@/lib/map/map-style";
import { m } from "@/paraglide/messages.js";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";
import { areaFocusPoints, fitToData } from "./tripMapFraming";
import {
  addTripMapLayers,
  applySatellite,
  applyTerrain,
  focusFilter,
  tripMapPointData,
} from "./tripMapLayers";
import type { MapLine, MapPoint, TripMapProps } from "./tripMapTypes";

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

export function useTripMap({
  points,
  lines,
  owner,
  perspective,
  styleUrl,
  focus,
  follow,
  photos,
}: Pick<
  TripMapProps,
  "points" | "lines" | "owner" | "perspective" | "focus" | "follow" | "photos"
> & { styleUrl: string }) {
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
          addTripMapLayers(instance, points, lines);
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
    (map.current.getSource("stops") as GeoJSONSource | undefined)?.setData(
      tripMapPointData(points),
    );
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

  return {
    canvas,
    hasGeometry,
    hovered,
    controls: {
      error,
      ready,
      terrain,
      satellite,
      globe,
      selected,
      selectedKind,
      selectedPoint,
      selectedLine,
      resetFocus,
      toggleTerrain,
      toggleSatellite,
      toggleGlobe,
      selectPoint,
      selectLine,
    },
  };
}
