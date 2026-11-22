import type {
  Projection,
  ProjectionArea,
  ProjectionItem,
  ProjectionRoute,
  ProjectionUpdate,
  RouteMode,
} from "@/api-types";
import type { MapLine, MapPhoto, MapPoint } from "@/components/map/TripMap";
import type { useLocale } from "@/i18n/locale";
import { ROUTE_MODE_LABELS } from "@/lib/records";
import { m } from "@/paraglide/messages.js";
import { useMemo } from "react";
import {
  routeHeading,
  storyDate,
  text,
  transportPlace,
  transportTime,
  tripDates,
} from "./projectionFormatting";
import { hasFileMarker } from "./projectionMedia";

const transportMode = (value: string | null | undefined): RouteMode =>
  value && value in ROUTE_MODE_LABELS ? (value as RouteMode) : "other";

/** A delivered point as [longitude, latitude], only when both are real coordinates. */
const validPoint = (values: {
  latitude?: number | null;
  longitude?: number | null;
}): [number, number] | null => {
  const { latitude, longitude } = values;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  return [longitude, latitude];
};

/** A route's line: the owner's drawn one, else a straight one between its two ends (a shared location, else its area). */
function routeLines(projection: Projection): MapLine[] {
  return projection.routes.flatMap((item) => {
    if (text(item.status) === "cancelled") return [];
    const transport = transportMode(text(item.mode));
    const line = item.geometry;
    if (
      line &&
      line.type === "LineString" &&
      Array.isArray(line.coordinates) &&
      line.coordinates.length >= 2 &&
      line.coordinates.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every((value) => typeof value === "number" && Number.isFinite(value)) &&
          Math.abs(point[0]) <= 180 &&
          Math.abs(point[1]) <= 90,
      )
    ) {
      return [
        {
          id: item.id,
          label: routeHeading(item),
          coordinates: line.coordinates as [number, number][],
          transport,
        },
      ];
    }
    const end = (endpoint: "departure" | "arrival") => {
      const location = routeLocationPoint(item, endpoint);
      if (location) return { coordinates: location.coordinates, label: location.label };
      const area = item[endpoint];
      if (!area) return null;
      const coordinates = validPoint(area);
      return coordinates ? { coordinates, label: text(area.label) ?? "" } : null;
    };
    const departure = end("departure"),
      arrival = end("arrival");
    if (!departure || !arrival) return [];
    return [
      {
        id: `route-${item.id}`,
        label: routeHeading(item),
        coordinates: [departure.coordinates, arrival.coordinates],
        transport,
        from: departure.label,
        to: arrival.label,
      },
    ];
  });
}

export function projectionMapLines(projection: Projection): MapLine[] {
  return routeLines(projection);
}

export function projectionMapPoints(projection: Projection): MapPoint[] {
  const point = (id: string, area: ProjectionArea | null | undefined): MapPoint[] => {
    const coordinates = area ? validPoint(area) : null;
    return area && coordinates
      ? [{ id, label: area.label ?? m.visitor_location(), coordinates }]
      : [];
  };
  const points = [
    ...projection.places.flatMap((item) => point(item.id, item)),
    ...projection.visits.flatMap((item) => [
      ...point(item.id, item.place),
      ...point(`${item.id}-location`, item.location),
    ]),
    ...projection.routes.flatMap((item) =>
      [routeLocationPoint(item, "departure"), routeLocationPoint(item, "arrival")].filter(
        (value): value is MapPoint => value !== null,
      ),
    ),
  ];
  return [
    ...new Map(
      points.map((value) => [`${value.coordinates.join(",")}:${value.label}`, value]),
    ).values(),
  ];
}

function routeLocationPoint(
  item: ProjectionRoute,
  endpoint: "departure" | "arrival",
): MapPoint | null {
  const point = item.map?.[endpoint];
  const coordinates = point ? validPoint(point) : null;
  if (!point || !coordinates) return null;
  return {
    id: `transport-${item.id}-${endpoint}`,
    label:
      point.label ||
      (endpoint === "departure" ? m.visitor_departure_point() : m.visitor_arrival_point()),
    coordinates,
    kind: point.kind === "airport" ? "airport" : "place",
  };
}

export function useProjectionMapMarkers(
  projection: Projection,
  locale: ReturnType<typeof useLocale>,
) {
  const mapLines = useMemo(
    () =>
      projectionMapLines(projection).map((line) => {
        const route = projection.routes.find(
          (item) => item.id === line.id || `route-${item.id}` === line.id,
        );
        if (!route) return line;
        return {
          ...line,
          from: line.from ?? transportPlace(route.departure) ?? undefined,
          to: line.to ?? transportPlace(route.arrival) ?? undefined,
          dates:
            [
              transportTime(route, "departure") ??
                storyDate(route.departs_on, route.date_precision),
              transportTime(route, "arrival"),
            ]
              .filter(Boolean)
              .join(" → ") || undefined,
          links: [{ label: m.visitor_view_route(), href: `#route-${route.id}` }],
        };
      }),
    [projection, locale],
  );
  const mapPoints = useMemo(
    () =>
      projectionMapPoints(projection).map((point) => {
        const visit = projection.visits.find(
          (item) => item.id === point.id || `${item.id}-location` === point.id,
        );
        const placeItem = projection.places.find((item) => item.id === point.id);
        const route = projection.routes.find(
          (item) =>
            point.id === `transport-${item.id}-departure` ||
            point.id === `transport-${item.id}-arrival`,
        );
        const matchingPlace = (value: ProjectionArea | null | undefined) =>
          !!value &&
          value.latitude === point.coordinates[1] &&
          value.longitude === point.coordinates[0];
        const relatedVisits = projection.visits.filter(
          (item) =>
            item.id === visit?.id || matchingPlace(item.place) || matchingPlace(item.location),
        );
        const relatedUpdates = projection.updates.filter((item) => matchingPlace(item.place));
        const links = [
          ...(placeItem
            ? [{ label: m.visitor_view_location(), href: `#place-${placeItem.id}` }]
            : []),
          ...relatedVisits.map((item) => ({
            label: m.visitor_visit_link({ title: text(item.title) ?? m.visitor_visit() }),
            href: `#visit-${item.id}`,
          })),
          ...relatedUpdates.map((item) => ({
            label: m.visitor_update_link({ title: text(item.title) ?? m.visitor_update() }),
            href: `#${item.id}`,
          })),
          ...(route ? [{ label: m.visitor_view_route(), href: `#route-${route.id}` }] : []),
        ];
        return { ...point, dates: visit ? (tripDates(visit) ?? undefined) : undefined, links };
      }),
    [projection, locale],
  );
  return { mapLines, mapPoints };
}

export function projectionStoryMap(
  projection: Projection,
  mapPoints: MapPoint[],
  hasMap: boolean,
  activeUpdate: string | null,
  fileUrl: (item: ProjectionItem) => string | null,
  openUpdate: (id: string) => void,
) {
  // An update sits where its shared area sits on the map, found by the coordinates both already carry.
  const pointOf = (item: ProjectionUpdate) => {
    const area = item.place;
    if (!area) return undefined;
    const { latitude, longitude } = area;
    return mapPoints.find(
      (point) => point.coordinates[0] === longitude && point.coordinates[1] === latitude,
    );
  };
  // With the map and an update that has a place, the map sits beside the story and follows the reader down it.
  const mapBesideStory = hasMap && projection.updates.some((item) => pointOf(item));
  const followedUpdate = activeUpdate
    ? projection.updates.find((item) => item.id === activeUpdate)
    : undefined;
  const followed = followedUpdate ? pointOf(followedUpdate)?.id : undefined;
  // One photo per place, from the first update there: only photos this audience already receives, at a place it
  // already sees.
  const mapPhotos: MapPhoto[] = [];
  for (const update of projection.updates) {
    const point = pointOf(update);
    if (!point || mapPhotos.some((photo) => photo.pointId === point.id)) continue;
    const photo = projection.media.find(
      (item) => item.update === update.id && hasFileMarker(item, "image") && fileUrl(item),
    );
    if (photo)
      mapPhotos.push({
        id: `${update.id}-${photo.id}`,
        pointId: point.id,
        coordinates: point.coordinates,
        url: fileUrl(photo)!,
        label: text(update.title) ?? m.visitor_update(),
        onOpen: () => openUpdate(update.id),
      });
  }
  return { mapBesideStory, followed, mapPhotos };
}
