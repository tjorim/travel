import { afterEach, expect, it, vi } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { configuredMapStyleUrl, loadMapStyle, styleLabelFont } from "./map-style";

afterEach(() => vi.unstubAllGlobals());
it("loads the dark default basemap with the same defensive filter handling", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        version: 8,
        sources: {},
        layers: [{ id: "boundary_3", type: "line", filter: ["==", "admin_level", 3] }],
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const style = await loadMapStyle(configuredMapStyleUrl, new AbortController().signal, "dark");
  expect(fetch).toHaveBeenCalledWith(
    "https://tiles.openfreemap.org/styles/dark",
    expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer" }),
  );
  expect(typeof style).toBe("object");
  if (typeof style !== "string")
    expect(style.layers[0]).toHaveProperty("filter", [
      "all",
      ["==", ["typeof", ["get", "admin_level"]], "number"],
      ["==", "admin_level", 3],
    ]);
});
it("preserves custom styles in dark mode", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await loadMapStyle("https://example.com/style.json", new AbortController().signal, "dark")).toBe(
    "https://example.com/style.json",
  );
  expect(fetch).not.toHaveBeenCalled();
});

const symbol = (id: string, font?: unknown) =>
  ({
    id,
    type: "symbol",
    source: "s",
    layout: font ? { "text-font": font } : {},
  }) as StyleSpecification["layers"][number];

it("takes the plain-weight font stack the style itself labels with", () => {
  expect(
    styleLabelFont({ layers: [symbol("water", ["Noto Sans Italic"]), symbol("roads", ["Noto Sans Regular"])] }),
  ).toEqual(["Noto Sans Regular"]);
});

it("falls back to a styled stack, then to Noto Sans, so MapLibre's default font is never requested", () => {
  expect(styleLabelFont({ layers: [symbol("cities", ["Noto Sans Bold"])] })).toEqual(["Noto Sans Bold"]);
  expect(styleLabelFont({ layers: [symbol("bare"), symbol("expression", ["literal", ["Open Sans"]])] })).toEqual([
    "Noto Sans Regular",
  ]);
  expect(styleLabelFont(undefined)).toEqual(["Noto Sans Regular"]);
});
