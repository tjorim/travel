import { useEffect, type RefObject } from "react";
import { useLocale } from "./locale";
import { m } from "./paraglide/messages.js";

/** MapLibre reads this table when creating controls; provider labels remain untouched. */
export function mapMessages(): Record<string, string> {
  return {
    "Map.Title": m.owner_map_title(),
    "NavigationControl.ZoomIn": m.owner_map_zoom_in(),
    "NavigationControl.ZoomOut": m.owner_map_zoom_out(),
    "NavigationControl.ResetBearing": m.owner_map_reset_bearing(),
    "AttributionControl.ToggleAttribution": m.owner_map_attribution(),
  };
}

/** Refresh existing controls in place: keep the camera, selected points, focus and drawn line. */
export function useMapMessages(container: RefObject<HTMLDivElement | null>, ready: boolean) {
  const locale = useLocale();
  useEffect(() => {
    const messages = mapMessages();
    const controls: Record<string, string> = {
      ".maplibregl-canvas": "Map.Title",
      ".maplibregl-ctrl-zoom-in": "NavigationControl.ZoomIn",
      ".maplibregl-ctrl-zoom-out": "NavigationControl.ZoomOut",
      ".maplibregl-ctrl-compass": "NavigationControl.ResetBearing",
      ".maplibregl-ctrl-attrib-button": "AttributionControl.ToggleAttribution",
    };
    for (const [selector, key] of Object.entries(controls)) {
      container.current?.querySelectorAll<HTMLElement>(selector).forEach((control) => {
        control.setAttribute("aria-label", messages[key]);
        if (selector !== ".maplibregl-canvas") control.title = messages[key];
      });
    }
  }, [container, ready, locale]);
}
