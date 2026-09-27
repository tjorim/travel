import { useEffect, useMemo, useRef, useState } from "react";

import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage } from "../query/api";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { ownerKeys } from "../query/keys";
import { TripMap, type MapLine, type MapPoint } from "../TripMap";
import { locationName, routeTitle, type Area, type Trip } from "../tracker-model";

type OfflineSnapshot = { points: MapPoint[]; lines: MapLine[] };

export function OwnerTripMap({ trip, areas, focus, onOpenRecord }: { trip: Trip; areas: Area[]; focus?: { id: string; request: number } | null; onOpenRecord?: (kind: "area" | "location" | "visit" | "route" | "update", id: string) => void }) {
  const offline = useOfflineCopies();
  const routesQuery = useTripResource(trip.id, "routes");
  const placesQuery = useTripResource(trip.id, "locations");
  const visitsQuery = useTripResource(trip.id, "visits");
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [notice, setNotice] = useState("");
  const savePoint = useOwnerMutation<{ id: string; latitude: number; longitude: number }, Area>({
    fallback: "Het gebiedspunt kon niet worden opgeslagen.",
    request: ({ id, latitude, longitude }) => ({ path: `${tripPath(trip.id, "areas")}/${id}`, method: "PATCH", body: { latitude, longitude } }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "areas"), ownerKeys.trips(subject)],
  });

  // The map answers from the pinned copy when the live reads cannot: offline, or the server refused them.
  const queries = [routesQuery, placesQuery];
  const unavailable = queries.some((query) => query.isError) || (!offline.online && queries.some((query) => query.data === undefined));
  const copy = offline.copies.find((candidate) => candidate.resourceKind === "route_data" && candidate.resourceId === trip.id);
  // The hook returns fresh functions each render; the effect below must only re-run when the copy changes.
  const openCopy = useRef(offline.open);
  openCopy.current = offline.open;

  useEffect(() => {
    if (!unavailable || !copy) { setSnapshot(null); return; }
    let cancelled = false;
    openCopy.current(copy.id).then(async (blob) => {
      const data = JSON.parse(await blob.text()) as Partial<OfflineSnapshot>;
      if (!Array.isArray(data.points) || !Array.isArray(data.lines)) throw new Error("Ongeldige offline kaartkopie.");
      if (!cancelled) setSnapshot({ points: data.points, lines: data.lines });
    }).catch(() => { if (!cancelled) setSnapshot(null); });
    return () => { cancelled = true; };
  }, [unavailable, copy?.id]);

  const areaPoints = useMemo(() => new Map(areas.flatMap((area): [string, MapPoint][] => {
    if (area.latitude !== null && area.longitude !== null) return [[area.id, { id: area.id, label: area.label, coordinates: [area.longitude, area.latitude], kind: "area" }]];
    const locations = (placesQuery.data ?? []).filter((location) => location.area_id === area.id && location.latitude !== null && location.longitude !== null);
    if (!locations.length) return [];
    return [[area.id, { id: area.id, label: area.label, coordinates: [
      locations.reduce((total, location) => total + location.longitude!, 0) / locations.length,
      locations.reduce((total, location) => total + location.latitude!, 0) / locations.length,
    ], kind: "derived", detail: "Afgeleid uit private locaties" }]];
  })), [areas, placesQuery.data]);
  const points = useMemo<MapPoint[]>(() => [
    ...areaPoints.values(),
    ...(placesQuery.data ?? []).flatMap((place): MapPoint[] => place.latitude !== null && place.longitude !== null ? [{ id: place.id, label: locationName(place), coordinates: [place.longitude, place.latitude], kind: "location", areaId: place.area_id }] : []),
  ], [placesQuery.data, areaPoints]);
  const liveLines = useMemo<MapLine[]>(() => [
    // A route without a drawn line is a straight one between its two areas.
    ...(routesQuery.data ?? []).flatMap((route): MapLine[] => {
      const ends = [route.departure_area, route.arrival_area].flatMap((area): [number, number][] => areaPoints.has(area.id) ? [areaPoints.get(area.id)!.coordinates] : []);
      const coordinates = route.geometry?.coordinates ?? (ends.length === 2 ? ends : null);
      return coordinates ? [{ id: route.id, label: routeTitle(route), coordinates, transport: route.mode }] : [];
    }),
  ], [routesQuery.data, areaPoints]);
  const openRecord = onOpenRecord;
  const displayedPoints = useMemo(() => (snapshot?.points ?? points).map((point) => {
    const areaId = point.kind === "location" ? point.areaId : point.id;
    const visits = (visitsQuery.data ?? []).filter((visit) => visit.area.id === areaId || visit.location?.id === point.id);
    const updates = trip.travel_updates.filter((update) => update.area_id === areaId || update.location?.id === point.id);
    const links = [
      ...(point.kind === "area" || point.kind === "derived" ? [{ label: "Gebied openen", onOpen: () => openRecord?.("area", point.id) }] : []),
      ...(point.kind === "location" ? [{ label: "Locatie openen", onOpen: () => openRecord?.("location", point.id) }] : []),
      ...visits.map((visit) => ({ label: `Bezoek: ${visit.title ?? visit.area.label}`, onOpen: () => openRecord?.("visit", visit.id) })),
      ...updates.map((update) => ({ label: `Update: ${update.title}${update.media_asset_ids.length ? ` · ${update.media_asset_ids.length} foto’s/media` : ""}`, onOpen: () => openRecord?.("update", update.id) })),
    ];
    return { ...point, links };
  }), [snapshot?.points, points, visitsQuery.data, trip.travel_updates, openRecord]);
  const lines = useMemo(() => (snapshot?.lines ?? liveLines).map((line) => {
    const route = (routesQuery.data ?? []).find((item) => item.id === line.id);
    return { ...line, from: route?.departure_area.label ?? line.from, to: route?.arrival_area.label ?? line.to,
      dates: route?.departs_on ?? line.dates,
      links: route ? [{ label: "Route openen", onOpen: () => openRecord?.("route", route.id) }] : line.links,
      transport: route?.mode ?? line.transport };
  }), [snapshot?.lines, liveLines, routesQuery.data, openRecord]);

  async function toggleOffline() {
    if (offline.isPinned("route_data", trip.id)) {
      await offline.removeByResource("route_data", trip.id);
      setNotice("Kaart- en routegegevens zijn niet langer offline beschikbaar.");
      return;
    }
    await offline.pin({
      resourceKind: "route_data",
      resourceId: trip.id,
      metadataUrl: `/api/trips/${trip.id}/offline-map`,
      title: `${trip.title} · kaart en route`,
      contentType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify({ version: 1, trip_id: trip.id, points: displayedPoints, lines })).buffer as ArrayBuffer,
    });
    setNotice("Kaart- en routegegevens zijn offline bewaard op dit toestel. Kaarttegels worden niet gekopieerd; die blijven onder de voorwaarden van de kaartaanbieder vallen.");
  }

  const readError = queries.find((query) => query.isError)?.error;
  const status = notice
    || (snapshot ? "Je gebruikt de bewust bewaarde offline kaart- en routegegevens. Kaarttegels worden niet offline opgeslagen."
      : unavailable ? errorMessage(readError, "Kaartgegevens konden niet worden geladen.")
      : "");

  return <><TripMap points={displayedPoints} lines={lines} owner focus={focus} onUseDerived={(point) => void savePoint.mutateAsync({ id: point.id, latitude: point.coordinates[1], longitude: point.coordinates[0] }).then(() => setNotice("Gebiedspunt opgeslagen."), (error: unknown) => setNotice(errorMessage(error, "Het gebiedspunt kon niet worden opgeslagen.")))} /><div className="button-row"><button className="secondary compact" type="button" disabled={displayedPoints.length === 0 && lines.length === 0} onClick={() => void toggleOffline().catch((error: unknown) => setNotice(errorMessage(error, "De kaartgegevens konden niet offline worden bewaard.")))}>{offline.isPinned("route_data", trip.id) ? "Offline verwijderen" : "Kaart offline bewaren"}</button></div><p className="help">Alleen de private GeoJSON-kaartgegevens worden bewust bewaard; kaarttegels worden niet offline opgeslagen.</p>{status && <p className="help" role="status">{status}</p>}</>;
}
