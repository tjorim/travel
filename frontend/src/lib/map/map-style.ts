import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

/** The viewed region of a map, kept across the rebuild a theme change needs. */
export type MapCamera = { center: [number, number]; zoom: number; pitch: number; bearing: number };

export function readCamera(instance: MapLibreMap): MapCamera {
  const { lng, lat } = instance.getCenter();
  return {
    center: [lng, lat],
    zoom: instance.getZoom(),
    pitch: instance.getPitch(),
    bearing: instance.getBearing(),
  };
}

const defaultStyleUrl = "https://tiles.openfreemap.org/styles/liberty";
export const configuredMapStyleUrl = import.meta.env.VITE_MAP_STYLE_URL || defaultStyleUrl;

const numericFilters: Record<string, string> = {
  boundary_3: "admin_level",
  "highway-shield-non-us": "ref_length",
  "highway-shield-us-interstate": "ref_length",
  road_shield_us: "ref_length",
};

/** Loads the default style defensively: a few upstream filters require numeric properties. */
export async function loadMapStyle(
  styleUrl: string,
  signal: AbortSignal,
  theme = "light",
): Promise<string | StyleSpecification> {
  if (styleUrl !== defaultStyleUrl || import.meta.env.VITE_MAP_STYLE_URL) return styleUrl;
  const response = await fetch(
    theme === "dark" ? "https://tiles.openfreemap.org/styles/dark" : styleUrl,
    {
      signal,
      referrerPolicy: "no-referrer",
      credentials: "omit",
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const style = (await response.json()) as StyleSpecification;
  for (const layer of style.layers ?? []) {
    const property = numericFilters[layer.id];
    if (property && "filter" in layer && layer.filter)
      layer.filter = [
        "all",
        ["==", ["typeof", ["get", property]], "number"],
        layer.filter,
      ] as typeof layer.filter;
  }
  return style;
}

/** The stack OpenFreeMap's Liberty style labels with; used when a style names no font of its own. */
const FALLBACK_LABEL_FONT = ["Noto Sans Regular"];

/**
 * A font stack the loaded style's glyph server actually has. A symbol layer without `text-font` makes MapLibre ask
 * for its own default ("Open Sans Regular", "Arial Unicode MS Regular"), which most tile servers do not host, so the
 * labels are drawn from the style's own fonts instead, preferring a plain weight.
 */
export function styleLabelFont(style: Pick<StyleSpecification, "layers"> | undefined): string[] {
  const stacks = (style?.layers ?? []).flatMap((layer) => {
    const font = layer.type === "symbol" ? layer.layout?.["text-font"] : undefined;
    return Array.isArray(font) && font.length > 0 && font.every((name) => typeof name === "string")
      ? [font as string[]]
      : [];
  });
  return (
    stacks.find((stack) => !/bold|italic|oblique/i.test(stack.join(" "))) ??
    stacks[0] ??
    FALLBACK_LABEL_FONT
  );
}
