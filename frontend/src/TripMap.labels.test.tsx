// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import type { FeatureCollection, Point } from "geojson";
import type { SymbolLayerSpecification } from "maplibre-gl";
import { afterEach, expect, it, vi } from "vitest";
import { TripMap, type MapPoint } from "./TripMap";

type CapturedMap = {
  sources: Record<string, FeatureCollection<Point>>;
  layers: SymbolLayerSpecification[];
  removed: boolean;
};
const maps = vi.hoisted(() => [] as CapturedMap[]);

vi.mock("./map-style", () => ({
  configuredMapStyleUrl: "test-style",
  loadMapStyle: async () => ({ version: 8, sources: {}, layers: [] }),
}));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: () => {},
  NavigationControl: class {},
  LngLatBounds: class {
    isEmpty() {
      return false;
    }
    extend() {
      return this;
    }
  },
  Map: class {
    sources: Record<string, FeatureCollection<Point>> = {};
    layers: SymbolLayerSpecification[] = [];
    removed = false;
    constructor() {
      maps.push(this);
    }
    addControl() {}
    addSource(id: string, source: { data: FeatureCollection<Point> }) {
      this.sources[id] = source.data;
    }
    addLayer(layer: SymbolLayerSpecification) {
      this.layers.push(layer);
    }
    getLayer(id: string) {
      return this.layers.find((layer) => layer.id === id);
    }
    setFilter() {}
    fitBounds() {}
    on(event: string, callback: () => void) {
      if (event === "load") queueMicrotask(callback);
    }
    remove() {
      this.removed = true;
    }
  },
}));

afterEach(() => {
  cleanup();
  maps.length = 0;
  vi.restoreAllMocks();
});

it("supplies custom and derived area names to the visible label layer after map updates", async () => {
  Object.defineProperty(window, "WebGLRenderingContext", { configurable: true, value: class {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as WebGLRenderingContext);
  const points: MapPoint[] = [
    { id: "custom", label: "My Secret Base Camp", coordinates: [121, 25], kind: "area" },
    { id: "derived", label: "Morning Walks", coordinates: [121.1, 25.1], kind: "derived" },
  ];
  const { rerender } = render(<TripMap owner points={points} lines={[]} />);
  await waitFor(() => expect(maps[0]?.sources.stops).toBeDefined());
  expect(maps[0].sources.stops.features.map((feature) => feature.properties)).toEqual([
    { id: "custom", label: "My Secret Base Camp", kind: "area", areaId: "" },
    { id: "derived", label: "Morning Walks", kind: "derived", areaId: "" },
  ]);
  expect(maps[0].sources.stops.features.map((feature) => feature.geometry.coordinates)).toEqual([
    [121, 25],
    [121.1, 25.1],
  ]);
  const labels = maps[0].layers.find((layer) => layer.id === "area-labels")!;
  expect(labels.source).toBe("stops");
  expect(labels.filter).toEqual(["in", ["get", "kind"], ["literal", ["area", "derived"]]]);
  expect(labels.layout?.["text-field"]).toEqual(["get", "label"]);
  expect(labels.layout?.["text-allow-overlap"]).not.toBe(true);
  expect(labels.paint?.["text-halo-color"]).toBe("#ffffff");
  expect(labels.paint?.["text-halo-width"]).toBe(2);

  rerender(<TripMap owner points={[{ ...points[0], label: "Renamed Base Camp" }, points[1]]} lines={[]} />);
  await waitFor(() => expect(maps[1]?.sources.stops).toBeDefined());
  expect(maps[0].removed).toBe(true);
  expect(maps[1].sources.stops.features[0].properties?.label).toBe("Renamed Base Camp");
  expect(maps[1].sources.stops.features[1].properties?.label).toBe("Morning Walks");
});
