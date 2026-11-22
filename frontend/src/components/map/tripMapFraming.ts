import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapLine, MapPoint } from "./tripMapTypes";

/** Frame the majority regional cluster, leaving isolated long-haul stops for the whole-trip view. */
export function framingCoordinates(
  points: MapPoint[],
  lines: MapLine[],
  whole = false,
): [number, number][] {
  if (whole || !points.length)
    return [
      ...points.map((point) => point.coordinates),
      ...lines.flatMap((line) => line.coordinates),
    ];
  const clusters: MapPoint[][] = [];
  const remaining = new Set(points);
  const nearby = (a: MapPoint, b: MapPoint) => {
    const radians = Math.PI / 180;
    const [lng1, lat1] = a.coordinates.map((value) => value * radians);
    const [lng2, lat2] = b.coordinates.map((value) => value * radians);
    const distance =
      12742 *
      Math.asin(
        Math.sqrt(
          Math.sin((lat2 - lat1) / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
        ),
      );
    return distance < 2000;
  };
  for (const point of remaining) {
    const cluster = [point];
    remaining.delete(point);
    for (const member of cluster)
      for (const candidate of remaining)
        if (nearby(member, candidate)) {
          remaining.delete(candidate);
          cluster.push(candidate);
        }
    clusters.push(cluster);
  }
  const largest = clusters.sort((a, b) => b.length - a.length)[0];
  return (largest && largest.length > points.length / 2 ? largest : points).map(
    (point) => point.coordinates,
  );
}

export function fitToData(
  instance: MapLibreMap,
  Bounds: typeof import("maplibre-gl").LngLatBounds,
  points: MapPoint[],
  lines: MapLine[],
  duration = 0,
  whole = false,
) {
  const bounds = new Bounds();
  framingCoordinates(points, lines, whole).forEach((coordinate) => bounds.extend(coordinate));
  if (!bounds.isEmpty())
    instance.fitBounds(bounds, { padding: 45, maxZoom: 10, duration, pitch: 0, bearing: 0 });
}

/** The owner-only points to frame when an area is focused. */
export function areaFocusPoints(area: MapPoint, points: MapPoint[]): MapPoint[] {
  return [area, ...points.filter((point) => point.kind === "location" && point.areaId === area.id)];
}
