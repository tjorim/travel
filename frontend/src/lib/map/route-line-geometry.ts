import type { LineString, MultiLineString } from "geojson";

type Coordinate = [number, number];

/** Split only the rendered line at the dateline; stored points stay valid longitude/latitude pairs. */
export function routeLineGeometry(coordinates: Coordinate[]): LineString | MultiLineString {
  const parts: Coordinate[][] = [[]];
  for (const point of coordinates) {
    const part = parts.at(-1)!;
    const previous = part.at(-1);
    if (previous && Math.abs(point[0] - previous[0]) > 180) {
      const longitude = point[0] + (point[0] > previous[0] ? -360 : 360);
      const edge = previous[0] >= 0 ? 180 : -180;
      const latitude =
        longitude === previous[0]
          ? previous[1]
          : previous[1] +
            ((point[1] - previous[1]) * (edge - previous[0])) / (longitude - previous[0]);
      part.push([edge, latitude]);
      parts.push([[-edge, latitude], point]);
    } else part.push(point);
  }
  return parts.length === 1
    ? { type: "LineString", coordinates }
    : { type: "MultiLineString", coordinates: parts };
}
