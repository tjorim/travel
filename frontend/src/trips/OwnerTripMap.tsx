import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../auth-context";
import { TripMap, type MapLine, type MapPoint } from "../TripMap";
import { apiHeaders, type BroadPlace, type BroadRoute, type Place, type RecordedTrack, type Trip } from "../tracker-model";
import { parseRecordedTrack } from "./track-geometry";

export function OwnerTripMap({ trip, broadPlaces, revision, focus }: { trip: Trip; broadPlaces: BroadPlace[]; revision: number; focus?: { id: string; request: number } | null }) {
  const { session } = useAuth();
  const [lines, setLines] = useState<MapLine[]>([]);
  const [exactPlaces, setExactPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState("");
  const points = useMemo<MapPoint[]>(() => [
    ...broadPlaces.flatMap((place): MapPoint[] => place.latitude !== null && place.longitude !== null ? [{ id: place.id, label: place.label, coordinates: [place.longitude, place.latitude] }] : []),
    ...exactPlaces.flatMap((place): MapPoint[] => place.latitude !== null && place.longitude !== null ? [{ id: place.id, label: place.display_name ?? place.locality ?? "Exacte plaats", coordinates: [place.longitude, place.latitude] }] : []),
  ], [exactPlaces, broadPlaces]);

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
    void load().catch((error: unknown) => { if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Kaartgegevens konden niet worden geladen."); });
    return () => controller.abort();
  }, [session, trip.id, revision]);

  return <><TripMap points={points} lines={lines} owner focus={focus} />{status && <p className="help" role="status">{status}</p>}</>;
}
