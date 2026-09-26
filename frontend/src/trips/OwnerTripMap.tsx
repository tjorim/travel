import { useEffect, useMemo, useRef, useState } from "react";

import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage } from "../query/api";
import { useTripResource } from "../query/owner-queries";
import { TripMap, type MapLine, type MapPoint } from "../TripMap";
import { routeTitle, type Area, type Trip } from "../tracker-model";

type OfflineSnapshot = { points: MapPoint[]; lines: MapLine[] };

export function OwnerTripMap({ trip, areas, focus }: { trip: Trip; areas: Area[]; focus?: { id: string; request: number } | null }) {
  const offline = useOfflineCopies();
  const routesQuery = useTripResource(trip.id, "routes");
  const placesQuery = useTripResource(trip.id, "locations");
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [notice, setNotice] = useState("");

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

  const points = useMemo<MapPoint[]>(() => [
    ...areas.flatMap((place): MapPoint[] => place.latitude !== null && place.longitude !== null ? [{ id: place.id, label: place.label, coordinates: [place.longitude, place.latitude] }] : []),
    ...(placesQuery.data ?? []).flatMap((place): MapPoint[] => place.latitude !== null && place.longitude !== null ? [{ id: place.id, label: place.display_name ?? place.locality ?? "Locatie", coordinates: [place.longitude, place.latitude] }] : []),
  ], [placesQuery.data, areas]);
  const liveLines = useMemo<MapLine[]>(() => [
    // A route without a drawn line is a straight one between its two areas.
    ...(routesQuery.data ?? []).flatMap((route): MapLine[] => {
      const ends = [route.departure_area, route.arrival_area].flatMap((area): [number, number][] => area.latitude !== null && area.longitude !== null ? [[area.longitude, area.latitude]] : []);
      const coordinates = route.geometry?.coordinates ?? (ends.length === 2 ? ends : null);
      return coordinates ? [{ id: route.id, label: routeTitle(route), coordinates, transport: route.mode }] : [];
    }),
  ], [routesQuery.data]);
  const displayedPoints = snapshot?.points ?? points;
  const lines = snapshot?.lines ?? liveLines;

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

  return <><TripMap points={displayedPoints} lines={lines} owner focus={focus} /><div className="button-row"><button className="secondary compact" type="button" disabled={displayedPoints.length === 0 && lines.length === 0} onClick={() => void toggleOffline().catch((error: unknown) => setNotice(errorMessage(error, "De kaartgegevens konden niet offline worden bewaard.")))}>{offline.isPinned("route_data", trip.id) ? "Offline verwijderen" : "Kaart offline bewaren"}</button></div><p className="help">Alleen de private GeoJSON-kaartgegevens worden bewust bewaard; kaarttegels worden niet offline opgeslagen.</p>{status && <p className="help" role="status">{status}</p>}</>;
}
