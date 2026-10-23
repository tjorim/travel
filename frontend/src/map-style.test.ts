import { http, HttpResponse } from "msw/http";
import { afterEach, expect, it, vi } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { server } from "./mocks/server";
import { configuredMapStyleUrl, loadMapStyle, styleLabelFont } from "./map-style";

afterEach(() => vi.restoreAllMocks());

it("loads the dark default basemap with the same defensive filter handling", async () => {
  // Credentials and referrer policy are client-side options that never reach the network: spy on the call.
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  server.use(
    http.get("https://tiles.openfreemap.org/styles/dark", () => {
      return HttpResponse.json({
        version: 8,
        sources: {},
        layers: [{ id: "boundary_3", type: "line", filter: ["==", "admin_level", 3] }],
      });
    }),
  );
  const style = await loadMapStyle(configuredMapStyleUrl, new AbortController().signal, "dark");
  expect(fetchSpy).toHaveBeenCalledWith(
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
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  expect(
    await loadMapStyle("https://example.com/style.json", new AbortController().signal, "dark"),
  ).toBe("https://example.com/style.json");
  expect(fetchSpy).not.toHaveBeenCalled();
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
    styleLabelFont({
      layers: [symbol("water", ["Noto Sans Italic"]), symbol("roads", ["Noto Sans Regular"])],
    }),
  ).toEqual(["Noto Sans Regular"]);
});

it("falls back to a styled stack, then to Noto Sans, so MapLibre's default font is never requested", () => {
  expect(styleLabelFont({ layers: [symbol("cities", ["Noto Sans Bold"])] })).toEqual([
    "Noto Sans Bold",
  ]);
  expect(
    styleLabelFont({ layers: [symbol("bare"), symbol("expression", ["literal", ["Open Sans"]])] }),
  ).toEqual(["Noto Sans Regular"]);
  expect(styleLabelFont(undefined)).toEqual(["Noto Sans Regular"]);
});
