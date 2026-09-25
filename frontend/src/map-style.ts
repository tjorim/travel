import type { StyleSpecification } from "maplibre-gl";

const defaultStyleUrl = "https://tiles.openfreemap.org/styles/liberty";
export const configuredMapStyleUrl = import.meta.env.VITE_MAP_STYLE_URL || defaultStyleUrl;

const numericFilters: Record<string, string> = {
  boundary_3: "admin_level",
  "highway-shield-non-us": "ref_length",
  "highway-shield-us-interstate": "ref_length",
  road_shield_us: "ref_length",
};

/** Loads the default style defensively: a few upstream filters require numeric properties. */
export async function loadMapStyle(styleUrl: string, signal: AbortSignal): Promise<string | StyleSpecification> {
  if (styleUrl !== defaultStyleUrl) return styleUrl;
  const response = await fetch(styleUrl, { signal, referrerPolicy: "no-referrer", credentials: "omit" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const style = await response.json() as StyleSpecification;
  for (const layer of style.layers ?? []) {
    const property = numericFilters[layer.id];
    if (property && "filter" in layer && layer.filter) layer.filter = ["all", ["==", ["typeof", ["get", property]], "number"], layer.filter] as typeof layer.filter;
  }
  return style;
}
