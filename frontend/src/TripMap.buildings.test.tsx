// @vitest-environment happy-dom
import type { Map as MapLibreMap } from "maplibre-gl";
import { beforeEach, describe, expect, it } from "vitest";
import { paintBuildings } from "./TripMap";

/** A minimal stand-in for the parts of MapLibre that `paintBuildings` touches. */
function fakeMap(color: string, opacity: number) {
  const paint = new Map<string, unknown>([
    ["building-3d:fill-extrusion-color", color],
    ["building-3d:fill-extrusion-opacity", opacity],
  ]);
  return {
    paint,
    getStyle: () => ({
      layers: [
        { id: "building-3d", type: "fill-extrusion", "source-layer": "building" },
        { id: "water", type: "fill", "source-layer": "water" },
      ],
    }),
    getPaintProperty: (id: string, name: string) => paint.get(`${id}:${name}`),
    setPaintProperty: (id: string, name: string, value: unknown) =>
      paint.set(`${id}:${name}`, value),
  };
}

describe("paintBuildings", () => {
  beforeEach(() => {
    document.documentElement.style.setProperty("--color-travel-map-building", "#d9d3c5");
  });

  it("lightens dark 3D buildings over satellite imagery and restores the style paint after", () => {
    const map = fakeMap("#111111", 0.6);
    paintBuildings(map as unknown as MapLibreMap, true);
    expect(map.paint.get("building-3d:fill-extrusion-color")).toBe("#d9d3c5");
    expect(map.paint.get("building-3d:fill-extrusion-opacity")).toBe(0.85);
    // Turning satellite on again must not overwrite the saved style colour with the tint.
    paintBuildings(map as unknown as MapLibreMap, true);
    paintBuildings(map as unknown as MapLibreMap, false);
    expect(map.paint.get("building-3d:fill-extrusion-color")).toBe("#111111");
    expect(map.paint.get("building-3d:fill-extrusion-opacity")).toBe(0.6);
  });

  it("leaves other layers and an untouched style alone when satellite is off", () => {
    const map = fakeMap("#111111", 0.6);
    paintBuildings(map as unknown as MapLibreMap, false);
    expect(map.paint.get("building-3d:fill-extrusion-color")).toBe("#111111");
  });
});
