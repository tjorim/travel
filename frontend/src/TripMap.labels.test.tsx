// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FeatureCollection, Point } from "geojson";
import type { SymbolLayerSpecification } from "maplibre-gl";
import { afterEach, expect, it, vi } from "vitest";
import { changeLocale } from "./locale";
import { TripMap, type MapPoint } from "./TripMap";

type CapturedMap = {
  sources: Record<string, FeatureCollection<Point>>;
  layers: SymbolLayerSpecification[];
  removed: boolean;
  options: Record<string, unknown>;
  fitted: number;
  projection?: string;
  terrain?: unknown;
  visibility?: string;
  filter?: unknown;
  camera: { center: { lng: number; lat: number }; zoom: number; pitch: number; bearing: number };
};
const maps = vi.hoisted(() => [] as CapturedMap[]);

vi.mock("./map-style", async (importOriginal) => ({
  readCamera: (await importOriginal<typeof import("./map-style")>()).readCamera,
  configuredMapStyleUrl: "test-style",
  loadMapStyle: async () => ({ version: 8, sources: {}, layers: [] }),
  styleLabelFont: () => ["Style Sans Regular"],
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
    fitted = 0;
    projection?: string;
    terrain?: unknown;
    visibility?: string;
    filter?: unknown;
    camera = { center: { lng: 121, lat: 25 }, zoom: 5, pitch: 0, bearing: 0 };
    constructor(public options: Record<string, unknown>) {
      maps.push(this);
    }
    getCenter() {
      return this.camera.center;
    }
    getZoom() {
      return this.camera.zoom;
    }
    getPitch() {
      return this.camera.pitch;
    }
    getBearing() {
      return this.camera.bearing;
    }
    setProjection({ type }: { type: string }) {
      this.projection = type;
    }
    setTerrain(terrain: unknown) {
      this.terrain = terrain;
    }
    setLayoutProperty(_id: string, _property: string, value: string) {
      this.visibility = value;
    }
    easeTo() {}
    flyTo() {}
    addControl() {}
    addSource(id: string, source: { data: FeatureCollection<Point> }) {
      this.sources[id] = source.data;
    }
    addLayer(layer: SymbolLayerSpecification) {
      this.layers.push(layer);
    }
    getSource(id: string) {
      return {
        setData: (data: FeatureCollection<Point>) => {
          this.sources[id] = data;
        },
      };
    }
    getStyle() {
      return { version: 8, sources: {}, layers: [] };
    }
    getLayer(id: string) {
      return this.layers.find((layer) => layer.id === id);
    }
    setFilter(id: string, filter: unknown) {
      if (id === "focused-locations") this.filter = filter;
    }
    fitBounds() {
      this.fitted += 1;
    }
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
  delete document.documentElement.dataset.theme;
  maps.length = 0;
  vi.restoreAllMocks();
  act(() => changeLocale("nl"));
});

it("supplies custom and derived area names to the visible label layer after map updates", async () => {
  Object.defineProperty(window, "WebGLRenderingContext", { configurable: true, value: class {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as WebGLRenderingContext);
  document.documentElement.style.setProperty("--color-travel-surface", "#fffdf8");
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
  // Labels use a font the style's own glyph server hosts, never MapLibre's built-in default.
  expect(labels.layout?.["text-font"]).toEqual(["Style Sans Regular"]);
  expect(labels.layout?.["text-allow-overlap"]).not.toBe(true);
  expect(labels.paint?.["text-halo-color"]).toBe("#fffdf8");
  expect(labels.paint?.["text-halo-width"]).toBe(2);

  rerender(
    <TripMap owner points={[{ ...points[0], label: "Renamed Base Camp" }, points[1]]} lines={[]} />,
  );
  await waitFor(() =>
    expect(maps[0].sources.stops.features[0].properties?.label).toBe("Renamed Base Camp"),
  );
  expect(maps[0].removed).toBe(false);
  expect(maps).toHaveLength(1);
  act(() => changeLocale("en"));
  expect(maps).toHaveLength(1);
  expect(maps[0].removed).toBe(false);
  expect(maps[0].sources.stops.features[1].properties?.label).toBe("Morning Walks");
});

it("keeps the camera, selection and layer toggles when the theme changes", async () => {
  Object.defineProperty(window, "WebGLRenderingContext", { configurable: true, value: class {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as WebGLRenderingContext);
  const points: MapPoint[] = [
    { id: "area", label: "Base Camp", coordinates: [121, 25], kind: "area" },
    { id: "near", label: "Near", coordinates: [121.1, 25.1], kind: "location", areaId: "area" },
  ];
  render(<TripMap owner points={points} lines={[]} />);
  await waitFor(() => expect(maps[0]?.sources.stops).toBeDefined());
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "Satelliet" }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Satelliet" }));
  fireEvent.click(screen.getByRole("button", { name: "Wereldbol" }));
  fireEvent.click(screen.getByRole("button", { name: "Base Camp" }));
  maps[0].camera = { center: { lng: 121.4, lat: 25.3 }, zoom: 11.5, pitch: 40, bearing: 30 };

  act(() => {
    document.documentElement.dataset.theme = "dark";
    window.dispatchEvent(new Event("travel-appearance-change"));
  });
  await waitFor(() => expect(maps).toHaveLength(2));
  expect(maps[0].removed).toBe(true);
  await waitFor(() => expect(maps[1].sources.stops).toBeDefined());
  expect(maps[1].options).toMatchObject({
    center: [121.4, 25.3],
    zoom: 11.5,
    pitch: 40,
    bearing: 30,
  });
  await waitFor(() => expect(maps[1].projection).toBe("globe"));
  expect(maps[1].visibility).toBe("visible");
  expect(maps[1].filter).toEqual([
    "all",
    ["==", ["get", "kind"], "location"],
    ["==", ["get", "areaId"], "area"],
  ]);
  expect(maps[1].fitted).toBe(0);
  expect(screen.getByRole("button", { name: /^Satelliet/ }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(screen.getByRole("button", { name: /^Wereldbol/ }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(screen.getByRole("button", { name: "Base Camp" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
});

it("starts over from the whole trip when the trip geometry changes", async () => {
  Object.defineProperty(window, "WebGLRenderingContext", { configurable: true, value: class {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as WebGLRenderingContext);
  const point: MapPoint = { id: "area", label: "Base Camp", coordinates: [121, 25], kind: "area" };
  const { rerender } = render(<TripMap owner points={[point]} lines={[]} />);
  await waitFor(() => expect(maps[0]?.sources.stops).toBeDefined());
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "Satelliet" }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Satelliet" }));
  rerender(<TripMap owner points={[{ ...point, coordinates: [122, 26] }]} lines={[]} />);
  await waitFor(() => expect(maps).toHaveLength(2));
  await waitFor(() => expect(maps[1].fitted).toBe(1));
  expect(maps[1].options.center).toBeUndefined();
  expect(screen.getByRole("button", { name: /^Satelliet/ }).getAttribute("aria-pressed")).toBe(
    "false",
  );
});
