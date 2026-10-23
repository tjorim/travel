import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { FeedbackError, textNotice, errorNotice, useFeedback } from "../query/feedback";
import { Button } from "@/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";

import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage } from "../query/api";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { ownerKeys } from "../query/keys";
import { TripMap, type MapLine, type MapPoint } from "../TripMap";
import { locationName, routeTitle, type Area, type Trip } from "../tracker-model";

type OfflineSnapshot = { points: MapPoint[]; lines: MapLine[] };

export function OwnerTripMap({
  trip,
  areas,
  focus,
  onOpenRecord,
}: {
  trip: Trip;
  areas: Area[];
  focus?: { id: string; request: number } | null;
  onOpenRecord?: (kind: "area" | "location" | "visit" | "route" | "update", id: string) => void;
}) {
  const locale = useLocale();
  const offline = useOfflineCopies();
  const routesQuery = useTripResource(trip.id, "routes");
  const placesQuery = useTripResource(trip.id, "locations");
  const visitsQuery = useTripResource(trip.id, "visits");
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [notice, setNotice] = useFeedback<string>("");
  const savePoint = useOwnerMutation<{ id: string; latitude: number; longitude: number }, Area>({
    fallback: m.owner_the_area_point_could_not_be_saved,
    request: ({ id, latitude, longitude }) => ({
      path: `${tripPath(trip.id, "areas")}/${id}`,
      method: "PATCH",
      body: { latitude, longitude },
    }),
    invalidate: (subject) => [
      ownerKeys.tripResource(subject, trip.id, "areas"),
      ownerKeys.trips(subject),
    ],
  });

  // The map answers from the pinned copy when the live reads cannot: offline, or the server refused them.
  const queries = [routesQuery, placesQuery];
  const unavailable =
    queries.some((query) => query.isError) ||
    (!offline.online && queries.some((query) => query.data === undefined));
  const copy = offline.copies.find(
    (candidate) => candidate.resourceKind === "route_data" && candidate.resourceId === trip.id,
  );
  // The hook returns fresh functions each render; the effect below must only re-run when the copy changes.
  const openCopy = useRef(offline.open);
  openCopy.current = offline.open;

  useEffect(() => {
    if (!unavailable || !copy) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    openCopy
      .current(copy.id)
      .then(async (blob) => {
        const data = JSON.parse(await blob.text()) as Partial<OfflineSnapshot>;
        if (!Array.isArray(data.points) || !Array.isArray(data.lines))
          throw new FeedbackError(() => m.owner_invalid_offline_map_copy());
        if (!cancelled) setSnapshot({ points: data.points, lines: data.lines });
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [unavailable, copy?.id]);

  const areaPoints = useMemo(
    () =>
      new Map(
        areas.flatMap((area): [string, MapPoint][] => {
          if (area.latitude !== null && area.longitude !== null)
            return [
              [
                area.id,
                {
                  id: area.id,
                  label: area.label,
                  coordinates: [area.longitude, area.latitude],
                  kind: "area",
                },
              ],
            ];
          const locations = (placesQuery.data ?? []).filter(
            (location) =>
              location.area_id === area.id &&
              location.latitude !== null &&
              location.longitude !== null,
          );
          if (!locations.length) return [];
          return [
            [
              area.id,
              {
                id: area.id,
                label: area.label,
                coordinates: [
                  locations.reduce((total, location) => total + location.longitude!, 0) /
                    locations.length,
                  locations.reduce((total, location) => total + location.latitude!, 0) /
                    locations.length,
                ],
                kind: "derived",
                detail: m.owner_derived_from_private_locations(),
              },
            ],
          ];
        }),
      ),
    [locale, areas, placesQuery.data],
  );
  const points = useMemo<MapPoint[]>(
    () => [
      ...areaPoints.values(),
      ...(placesQuery.data ?? []).flatMap((place): MapPoint[] =>
        place.latitude !== null && place.longitude !== null
          ? [
              {
                id: place.id,
                label: locationName(place),
                coordinates: [place.longitude, place.latitude],
                kind: "location",
                areaId: place.area_id,
              },
            ]
          : [],
      ),
    ],
    [locale, placesQuery.data, areaPoints],
  );
  // A route without a drawn line is a straight one between its two areas.
  const liveLines = useMemo<MapLine[]>(
    () =>
      (routesQuery.data ?? []).flatMap((route): MapLine[] => {
        const ends = [route.departure_area, route.arrival_area].flatMap(
          (area): [number, number][] =>
            areaPoints.has(area.id) ? [areaPoints.get(area.id)!.coordinates] : [],
        );
        const coordinates = route.geometry?.coordinates ?? (ends.length === 2 ? ends : null);
        return coordinates
          ? [{ id: route.id, label: routeTitle(route), coordinates, transport: route.mode }]
          : [];
      }),
    [locale, routesQuery.data, areaPoints],
  );
  const openRecord = onOpenRecord;
  const displayedPoints = useMemo(
    () =>
      (snapshot?.points ?? points).map((point) => {
        const areaId = point.kind === "location" ? point.areaId : point.id;
        const visits = (visitsQuery.data ?? []).filter(
          (visit) => visit.area.id === areaId || visit.location?.id === point.id,
        );
        const updates = trip.travel_updates.filter(
          (update) => update.area_id === areaId || update.location?.id === point.id,
        );
        const links = [
          ...(point.kind === "area" || point.kind === "derived"
            ? [{ label: m.owner_open_area(), onOpen: () => openRecord?.("area", point.id) }]
            : []),
          ...(point.kind === "location"
            ? [{ label: m.owner_open_location(), onOpen: () => openRecord?.("location", point.id) }]
            : []),
          ...visits.map((visit) => ({
            label: m.owner_visit_2({ p0: visit.title ?? visit.area.label }),
            onOpen: () => openRecord?.("visit", visit.id),
          })),
          ...updates.map((update) => ({
            label: m.owner_update({
              p0: update.title,
              p1: update.media_asset_ids.length
                ? m.owner_photos_media({ p0: update.media_asset_ids.length })
                : "",
            }),
            onOpen: () => openRecord?.("update", update.id),
          })),
        ];
        return {
          ...point,
          detail:
            point.kind === "derived" ? m.owner_derived_from_private_locations() : point.detail,
          links,
        };
      }),
    [locale, snapshot?.points, points, visitsQuery.data, trip.travel_updates, openRecord],
  );
  const lines = useMemo(
    () =>
      (snapshot?.lines ?? liveLines).map((line) => {
        const route = (routesQuery.data ?? []).find((item) => item.id === line.id);
        return {
          ...line,
          from: route?.departure_area.label ?? line.from,
          to: route?.arrival_area.label ?? line.to,
          dates: route?.departs_on ?? line.dates,
          links: route
            ? [{ label: m.owner_open_route(), onOpen: () => openRecord?.("route", route.id) }]
            : [],
          transport: route?.mode ?? line.transport,
        };
      }),
    [locale, snapshot?.lines, liveLines, routesQuery.data, openRecord],
  );

  async function toggleOffline() {
    if (offline.isPinned("route_data", trip.id)) {
      await offline.removeByResource("route_data", trip.id);
      setNotice(textNotice(() => m.owner_map_and_route_data_are_no_longer_available_offline()));
      return;
    }
    await offline.pin({
      resourceKind: "route_data",
      resourceId: trip.id,
      metadataUrl: `/api/trips/${trip.id}/offline-map`,
      title: m.owner_map_and_route({ p0: trip.title }),
      contentType: "application/json",
      bytes: new TextEncoder().encode(
        JSON.stringify({
          version: 2,
          trip_id: trip.id,
          points: points.map(({ links: _links, detail, ...point }) => ({
            ...point,
            ...(point.kind === "derived" ? {} : { detail }),
          })),
          lines: lines.map(({ links: _links, ...line }) => line),
        }),
      ).buffer as ArrayBuffer,
    });
    setNotice(
      textNotice(() =>
        m.owner_map_and_route_data_are_saved_offline_on_this_device_map_tiles_are_not_co(),
      ),
    );
  }

  const readError = queries.find((query) => query.isError)?.error;
  const status =
    notice ||
    (snapshot
      ? m.owner_you_are_using_the_deliberately_saved_offline_map_and_route_data_map_tile()
      : unavailable
        ? errorMessage(readError, m.owner_map_data_could_not_be_loaded)
        : "");

  return (
    <>
      <TripMap
        points={displayedPoints}
        lines={lines}
        owner={!snapshot && !unavailable}
        focus={focus}
        onUseDerived={(point) =>
          void savePoint
            .mutateAsync({
              id: point.id,
              latitude: point.coordinates[1],
              longitude: point.coordinates[0],
            })
            .then(
              () => setNotice(textNotice(() => m.owner_area_point_saved())),
              (error: unknown) =>
                setNotice(errorNotice(error, m.owner_the_area_point_could_not_be_saved)),
            )
        }
      />
      <div className="button-row">
        <Button
          className="secondary compact"
          type="button"
          disabled={displayedPoints.length === 0 && lines.length === 0}
          onClick={() =>
            void toggleOffline().catch((error: unknown) =>
              setNotice(errorNotice(error, m.owner_the_map_data_could_not_be_saved_offline)),
            )
          }
        >
          {offline.isPinned("route_data", trip.id)
            ? m.owner_remove_offline_copy()
            : m.owner_save_map_offline()}
        </Button>
      </div>
      <p className="help">
        {m.owner_only_the_private_geojson_map_data_are_deliberately_saved_map_tiles_are_n()}
      </p>
      {status && (
        <p className="help" role="status">
          {status}
        </p>
      )}
    </>
  );
}
