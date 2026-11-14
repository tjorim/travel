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
import { locationName, routeTitle, areaName } from "../records";
import { type Area, type Trip } from "../api-types";
import type { CreateKind, CreatePrefill } from "./create-request";

type OfflineSnapshot = { points: MapPoint[]; lines: MapLine[] };

export function OwnerTripMap({
  trip,
  areas,
  focus,
  onOpenRecord,
  onCreateRecord,
}: {
  trip: Trip;
  areas: Area[];
  focus?: { id: string; request: number } | null;
  onOpenRecord?: (kind: "area" | "location" | "visit" | "route" | "update", id: string) => void;
  /** Starts a visit, stay or route at a point: the plan opens the existing dialog with the place filled in. */
  onCreateRecord?: (kind: CreateKind, prefill: CreatePrefill) => void;
}) {
  const locale = useLocale();
  const offline = useOfflineCopies();
  const routesQuery = useTripResource(trip.id, "routes");
  const placesQuery = useTripResource(trip.id, "locations");
  const visitsQuery = useTripResource(trip.id, "visits");
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [notice, setNotice] = useFeedback<string>("");
  const savePoint = useOwnerMutation<{ id: string; latitude: number; longitude: number }, Area>({
    fallback: m.map_the_area_point_could_not_be_saved,
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
          throw new FeedbackError(() => m.map_invalid_offline_map_copy());
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
                  label: areaName(area),
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
                label: areaName(area),
                coordinates: [
                  locations.reduce((total, location) => total + location.longitude!, 0) /
                    locations.length,
                  locations.reduce((total, location) => total + location.latitude!, 0) /
                    locations.length,
                ],
                kind: "derived",
                detail: m.common_derived_from_private_locations(),
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
  // A saved offline copy has no live records to add to.
  const canCreate = Boolean(onCreateRecord) && !snapshot && !unavailable;
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
        const here: CreatePrefill =
          point.kind === "location"
            ? { areaId: point.areaId, locationId: point.id }
            : { areaId: point.id };
        const links = [
          ...(point.kind === "area" || point.kind === "derived"
            ? [{ label: m.map_open_area(), onOpen: () => openRecord?.("area", point.id) }]
            : []),
          ...(point.kind === "location"
            ? [{ label: m.map_open_location(), onOpen: () => openRecord?.("location", point.id) }]
            : []),
          ...visits.map((visit) => ({
            label: m.map_visit_label({ title: visit.title ?? areaName(visit.area) }),
            onOpen: () => openRecord?.("visit", visit.id),
          })),
          ...updates.map((update) => ({
            label: m.map_update({
              title: update.title,
              photos: update.media_asset_ids.length
                ? m.map_photos_media({ count: update.media_asset_ids.length })
                : "",
            }),
            onOpen: () => openRecord?.("update", update.id),
          })),
          ...(canCreate
            ? [
                {
                  label: m.map_add_visit_here(),
                  onOpen: () => onCreateRecord?.("visit", here),
                },
                {
                  label: m.map_add_stay_here(),
                  onOpen: () => onCreateRecord?.("stay", here),
                },
                {
                  label: m.map_add_route_from_here(),
                  onOpen: () => onCreateRecord?.("route", here),
                },
              ]
            : []),
        ];
        return {
          ...point,
          detail:
            point.kind === "derived" ? m.common_derived_from_private_locations() : point.detail,
          links,
        };
      }),
    [
      locale,
      snapshot?.points,
      points,
      visitsQuery.data,
      trip.travel_updates,
      openRecord,
      canCreate,
      onCreateRecord,
    ],
  );
  const lines = useMemo(
    () =>
      (snapshot?.lines ?? liveLines).map((line) => {
        const route = (routesQuery.data ?? []).find((item) => item.id === line.id);
        return {
          ...line,
          from: route ? areaName(route.departure_area) : line.from,
          to: route ? areaName(route.arrival_area) : line.to,
          dates: route?.departs_on ?? line.dates,
          links: route
            ? [{ label: m.map_open_route(), onOpen: () => openRecord?.("route", route.id) }]
            : [],
          transport: route?.mode ?? line.transport,
        };
      }),
    [locale, snapshot?.lines, liveLines, routesQuery.data, openRecord],
  );

  async function toggleOffline() {
    if (offline.isPinned("route_data", trip.id)) {
      await offline.removeByResource("route_data", trip.id);
      setNotice(textNotice(() => m.map_and_route_data_are_no_longer_available_offline()));
      return;
    }
    await offline.pin({
      resourceKind: "route_data",
      contentMetadata: {
        areas,
        locations: placesQuery.data,
        routes: routesQuery.data,
        visits: visitsQuery.data,
      },
      resourceId: trip.id,
      metadataUrl: `/api/trips/${trip.id}/offline-map`,
      title: m.map_and_route({ trip: trip.title }),
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
    setNotice(textNotice(() => m.map_offline_saved_notice()));
  }

  const readError = queries.find((query) => query.isError)?.error;
  const status =
    notice ||
    (snapshot
      ? m.map_offline_in_use_notice()
      : unavailable
        ? errorMessage(readError, m.map_data_could_not_be_loaded)
        : "");

  return (
    <>
      <TripMap
        collapseLists
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
              () => setNotice(textNotice(() => m.map_area_point_saved())),
              (error: unknown) =>
                setNotice(errorNotice(error, m.map_the_area_point_could_not_be_saved)),
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
              setNotice(errorNotice(error, m.map_the_map_data_could_not_be_saved_offline)),
            )
          }
        >
          {offline.isPinned("route_data", trip.id)
            ? m.common_remove_offline_copy()
            : m.map_save_map_offline()}
        </Button>
      </div>
      <p className="help">{m.map_offline_geojson_notice()}</p>
      {status && (
        <p className="help" role="status">
          {status}
        </p>
      )}
    </>
  );
}
