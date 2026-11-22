import type { ProjectionMedia } from "@/api-types";

export function positiveSize(item: ProjectionMedia, field: "width" | "height"): number | undefined {
  const value = item[field];
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 4000
    ? value
    : undefined;
}

export function focus(item: ProjectionMedia, field: "focal_x" | "focal_y"): number {
  const value = item[field];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : 50;
}

/** True when the record carries the projection-local file marker of this kind, and it is its own. */
export function hasFileMarker(item: ProjectionMedia, field: "image" | "video"): boolean {
  return item[field]?.id === item.id;
}
