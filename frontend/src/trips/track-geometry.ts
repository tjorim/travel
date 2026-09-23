import type { RecordedTrack } from "../tracker-model";

export type Coordinate = [number, number];

function coordinate(latitude: unknown, longitude: unknown): Coordinate {
  if (latitude === null || longitude === null || latitude === undefined || longitude === undefined || latitude === "" || longitude === "") throw new Error("Ongeldige trackcoördinaten");
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("Ongeldige trackcoördinaten");
  return [lon, lat];
}

export function parseRecordedTrack(data: string, kind: RecordedTrack["kind"]): Coordinate[][] {
  if (kind === "point_array") {
    const decoded: unknown = JSON.parse(data);
    const points = Array.isArray(decoded) ? decoded : decoded && typeof decoded === "object" ? (decoded as { points?: unknown }).points : null;
    if (!Array.isArray(points) || points.length < 2) throw new Error("Ongeldige JSON-track");
    return [points.map((point: unknown) => {
      if (!point || typeof point !== "object") throw new Error("Ongeldig trackpunt");
      const value = point as Record<string, unknown>;
      return coordinate(value.latitude ?? value.lat, value.longitude ?? value.lon);
    })];
  }
  const xml = new DOMParser().parseFromString(data, "application/xml");
  if (xml.querySelector("parsererror") || xml.documentElement.localName !== "gpx") throw new Error("Ongeldige GPX-track");
  const segments = Array.from(xml.getElementsByTagName("*"))
    .filter((element) => element.localName === "trkseg")
    .map((segment) => Array.from(segment.getElementsByTagName("*"))
      .filter((element) => element.localName === "trkpt")
      .map((point) => coordinate(point.getAttribute("lat"), point.getAttribute("lon"))))
    .filter((segment) => segment.length >= 2);
  if (!segments.length) throw new Error("GPX-track zonder lijn");
  return segments;
}
