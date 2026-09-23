import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../auth-context";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { TripMap, type MapLine, type MapPoint } from "../TripMap";
import { apiHeaders, type BroadPlace, type BroadRoute, type Place, type RecordedTrack, type Trip } from "../tracker-model";
import { parseRecordedTrack } from "./track-geometry";

export function OwnerTripMap({ trip, broadPlaces, revision, focus }: { trip: Trip; broadPlaces: BroadPlace[]; revision: number; focus?: { id: string; request: number } | null }) {
  const { session } = useAuth();
  const offline = useOfflineCopies();
  const [lines, setLines] = useState<MapLine[]>([]);
  const [exactPlaces, setExactPlaces] = useState<Place[]>([]);
  const [offlinePoints, setOfflinePoints] = useState<MapPoint[] | null>(null);
  const [status, setStatus] = useState("");
  const points = useMemo<MapPoint[]>(() => [
    ...broadPlaces.flatMap((place): MapPoint[] => place.latitude !== null && place.longitude !== null ? [{ id: place.id, label: place.label, coordinates: [place.longitude, place.latitude] }] : []),
    ...exactPlaces.flatMap((place): MapPoint[] => place.latitude !== null && place.longitude !== null ? [{ id: place.id, label: place.display_name ?? place.locality ?? "Exacte plaats", coordinates: [place.longitude, place.latitude] }] : []),
  ], [exactPlaces, broadPlaces]);
  const displayedPoints = offlinePoints ?? points;

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    async function load() {
      const headers = apiHeaders(session!);
      const [routesResponse, tracksResponse, placesResponse] = await Promise.all([
        fetch(`/api/trips/${trip.id}/broad-routes`, { headers, cache: "no-store", signal: controller.signal }),
        fetch(`/api/trips/${trip.id}/recorded-tracks`, { headers, cache: "no-store", signal: controller.signal }),
        fetch(`/api/trips/${trip.id}/places`, { headers, cache: "no-store", signal: controller.signal }),
      ]);
      if (!routesResponse.ok || !tracksResponse.ok || !placesResponse.ok) throw new Error("Kaartgegevens konden niet worden geladen.");
      const routes = await routesResponse.json() as BroadRoute[];
      const tracks = await tracksResponse.json() as RecordedTrack[];
      const places = await placesResponse.json() as Place[];
      const broad: MapLine[] = routes.map((route) => ({ id: route.id, label: route.label, coordinates: route.geometry.coordinates }));
      const trackResults = await Promise.allSettled(tracks.map(async (track) => {
        const response = await fetch(track.source_file_url, { headers, cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Een private track kon niet worden geladen.");
        return parseRecordedTrack(await response.text(), track.kind).map((coordinates, index): MapLine => ({ id: `${track.id}:${index}`, label: `Afgewerkte track ${new Date(track.started_at).toLocaleDateString("nl-BE")}`, coordinates, exact: true }));
      }));
      if (!controller.signal.aborted) {
        setLines([...broad, ...trackResults.flatMap((result) => result.status === "fulfilled" ? result.value : [])]);
        setExactPlaces(places);
        setStatus(trackResults.some((result) => result.status === "rejected") ? "Een private track kon niet worden getekend; de overige kaartgegevens blijven beschikbaar." : "");
      }
    }
    setLines([]);
    setExactPlaces([]);
    setOfflinePoints(null);
    void load().catch(async (error: unknown) => {
      if (controller.signal.aborted) return;
      const copy = offline.copies.find((candidate) => candidate.resourceKind === "map_route_data" && candidate.resourceId === trip.id);
      if (copy) {
        try {
          const snapshot = await offline.open(copy!.id) as Blob;
          const data = JSON.parse(await snapshot.text()) as { points?: MapPoint[]; lines?: MapLine[] };
          if (!Array.isArray(data.points) || !Array.isArray(data.lines)) throw new Error("Ongeldige offline kaartkopie.");
          if (!controller.signal.aborted) {
            setOfflinePoints(data.points);
            setLines(data.lines);
            setStatus("Je gebruikt de bewust bewaarde offline kaart- en routegegevens. Kaarttegels worden niet offline opgeslagen.");
          }
          return;
        } catch {
          // Show the network error below when the pinned copy cannot be opened.
        }
      }
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Kaartgegevens konden niet worden geladen.");
    });
    return () => controller.abort();
  }, [session, trip.id, revision, offline.copies]);

  async function toggleOffline() {
    if (offline.isPinned("map_route_data", trip.id)) {
      await offline.removeByResource("map_route_data", trip.id);
      setStatus("Kaart- en routegegevens zijn niet langer offline beschikbaar.");
      return;
    }
    const snapshot = { version: 1, trip_id: trip.id, points: displayedPoints, lines };
    await offline.pin({
      resourceKind: "map_route_data",
      resourceId: trip.id,
      metadataUrl: `/api/trips/${trip.id}/offline-map`,
      title: `${trip.title} · kaart en route`,
      contentType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(snapshot)).buffer as ArrayBuffer,
    });
    setStatus("Kaart- en routegegevens zijn offline bewaard op dit toestel. Kaarttegels worden niet gekopieerd; die blijven onder de voorwaarden van de kaartaanbieder vallen.");
  }

  return <><TripMap points={displayedPoints} lines={lines} owner focus={focus} /><div className="button-row"><button className="secondary compact" type="button" disabled={displayedPoints.length === 0 && lines.length === 0} onClick={() => void toggleOffline().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "De kaartgegevens konden niet offline worden bewaard."))}>{offline.isPinned("map_route_data", trip.id) ? "Offline verwijderen" : "Kaart offline bewaren"}</button></div><p className="help">Alleen de private GeoJSON-kaartgegevens worden bewust bewaard; kaarttegels worden niet offline opgeslagen.</p>{status && <p className="help" role="status">{status}</p>}</>;
}
