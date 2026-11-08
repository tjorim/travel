import type { RouteCoordinate } from "../RouteGeometryEditor";

// A suggestion is deliberately small (roughly two-degree intervals),
// far below the existing route API's 10,000-point limit.
export const MAX_FLIGHT_ARC_POINTS = 91;
const radians = Math.PI / 180;
const rounded = (value: number) => Math.round(value * 1_000) / 1_000;
const valid = ([lng, lat]: RouteCoordinate) =>
  Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;

/** Shortest great-circle arc, using only resolved area points. Null means no unambiguous line. */
export function flightArc(from: RouteCoordinate, to: RouteCoordinate): RouteCoordinate[] | null {
  if (!valid(from) || !valid(to)) return null;
  const vector = ([lng, lat]: RouteCoordinate) => [
    Math.cos(lat * radians) * Math.cos(lng * radians),
    Math.cos(lat * radians) * Math.sin(lng * radians),
    Math.sin(lat * radians),
  ];
  const a = vector(from),
    b = vector(to);
  const dot = Math.max(
    -1,
    Math.min(
      1,
      a.reduce((sum, value, i) => sum + value * b[i], 0),
    ),
  );
  const angle = Math.acos(dot);
  // Coincident or nearly antipodal ends cannot define a useful unique arc.
  if (angle < 1e-6 || Math.PI - angle < 1e-5) return null;
  const segments = Math.min(
    MAX_FLIGHT_ARC_POINTS - 1,
    Math.max(2, Math.ceil(angle / (2 * radians))),
  );
  const points: RouteCoordinate[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const left = Math.sin((1 - t) * angle) / Math.sin(angle);
    const right = Math.sin(t * angle) / Math.sin(angle);
    const [x, y, z] = a.map((value, index) => left * value + right * b[index]);
    const point: RouteCoordinate =
      i === 0
        ? from
        : i === segments
          ? to
          : [Math.atan2(y, x) / radians, Math.atan2(z, Math.hypot(x, y)) / radians];
    const next: RouteCoordinate = [rounded(point[0]), rounded(point[1])];
    if (!points.length || next.some((value, index) => value !== points.at(-1)![index]))
      points.push(next);
  }
  return points.length >= 2 ? points : null;
}
