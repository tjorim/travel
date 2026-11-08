import { expect, it } from "vitest";
import { flightArc, MAX_FLIGHT_ARC_POINTS } from "./flight-arc";
import { routeLineGeometry } from "../../route-line-geometry";

it("bows a shortest arc poleward, preserving rounded endpoints with a bounded point count", () => {
  const points = flightArc([-60.12345, 40.12345], [60.98765, 40.54321])!;
  expect(points[0]).toEqual([-60.123, 40.123]);
  expect(points.at(-1)).toEqual([60.988, 40.543]);
  expect(Math.max(...points.map((p) => p[1]))).toBeGreaterThan(59);
  expect(points.length).toBeLessThanOrEqual(MAX_FLIGHT_ARC_POINTS);
  for (const point of points)
    for (const value of point) expect(value).toBe(Number(value.toFixed(3)));
  expect(flightArc([0, 0], [179.99, 0])!.length).toBe(MAX_FLIGHT_ARC_POINTS);
});

it("rejects degenerate, near-antipodal and invalid endpoints without NaN geometry", () => {
  for (const [from, to] of [
    [
      [0, 0],
      [0, 0],
    ],
    [
      [180, 0],
      [-180, 0],
    ],
    [
      [0, 90],
      [70, 90],
    ],
    [
      [0, 0],
      [180, 0],
    ],
    [
      [0, 0],
      [179.99999, 0],
    ],
    [
      [NaN, 0],
      [1, 0],
    ],
    [
      [181, 0],
      [0, 0],
    ],
    [
      [0, 91],
      [0, 0],
    ],
    [
      [0, 0],
      [0.00001, 0],
    ],
  ] as [number, number][][])
    expect(flightArc(from, to)).toBeNull();
});

it.each([1, -1])("crosses the dateline by the short path in either direction (%s)", (direction) => {
  const points = flightArc([direction * 170, 20], [-direction * 170, 20])!;
  expect(points.every(([lng, lat]) => Math.abs(lng) >= 170 && Number.isFinite(lat))).toBe(true);
  const geometry = routeLineGeometry(points);
  expect(geometry.type).toBe("MultiLineString");
  if (geometry.type !== "MultiLineString") throw new Error();
  for (const part of geometry.coordinates)
    for (let i = 1; i < part.length; i++) {
      expect(Math.abs(part[i][0] - part[i - 1][0])).toBeLessThanOrEqual(180);
    }
  expect(geometry.coordinates[0].at(-1)![1]).toBe(geometry.coordinates[1][0][1]);
});

it("handles polar and very short usable arcs with finite coordinates", () => {
  for (const points of [flightArc([0, 90], [40, 20])!, flightArc([0, 0], [0.01, 0])!]) {
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points.flat().every(Number.isFinite)).toBe(true);
  }
});

it("renders exact dateline aliases without division by zero", () => {
  const geometry = routeLineGeometry([
    [180, 20],
    [-180, 20],
    [-170, 30],
  ]);
  expect(JSON.stringify(geometry)).not.toContain("null");
  expect(geometry.type).toBe("MultiLineString");
});
