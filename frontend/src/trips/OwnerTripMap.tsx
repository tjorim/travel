import { useEffect, useMemo, useRef, useState } from "react";

import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage, ownerFile } from "../query/api";
import { useOwner, useTripResource } from "../query/owner-queries";
import { TripMap, type MapLine, type MapPoint } from "../TripMap";
import type { BroadPlace, Trip } from "../tracker-model";
import { parseRecordedTrack } from "./track-geometry";

type OfflineSnapshot = { points: MapPoint[]; lines: MapLine[] };

export function OwnerTripMap({ trip, broadPlaces, focus }: { trip: Trip; broadPlaces: BroadPlace[]; focus?: { id: string; request: number } | null }) {
  const owner = useOwner();
  const offline = useOfflineCopies();
  const routesQuery = useTripResource(trip.id, "broad-routes");
  const tracksQuery = useTripResource(trip.id, "recorded-tracks");
  const placesQuery = useTripResource(trip.id, "places");
  const [trackLines, setTrackLines] = useState<MapLine[]>([]);
  const [trackFailed, setTrackFailed] = useState(false);
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [notice, setNotice] = useState("");

  // The map answers from the pinned copy when the live reads cannot: offline, or the server refused them.
  const queries = [routesQuery, tracksQuery, placesQuery];
  const unavailable = queries.some((query) => query.isError) || (!offline.online && queries.some((query) => query.data === undefined));
  const copy = offline.copies.find((candidate) => candidate.resourceKind === "map_route_data" && candidate.resourceId === trip.id);
  // The hook returns fresh functions each render; the effect below must only re-run when the copy changes.
  const openCopy = useRef(offline.open);
  openCopy.current = offline.open;

  // The recorded tracks' source files are protected downloads: fetched per track, parsed and dropped, never cached.
  const tracks = tracksQuery.data;
  useEffect(() => {
    setTrackLines([]);
    setTrackFailed(false);
    if (!owner || !tracks?.length) return;
    const controller = new AbortController();
    void Promise.allSettled(tracks.map(async (track) => {
      const file = await ownerFile(owner.session, track.source_file_url, "Een private track kon niet worden geladen.", { cache: "no-store", signal: controller.signal });
      return parseRecordedTrack(await file.text(), track.kind).map((coordinates, index): MapLine => ({ id: `${track.id}:${index}`, label: `Afgewerkte track ${new Date(track.started_at).toLocaleDateString("nl-BE")}`, coordinates, exact: true }));
    })).then((results) => {
      if (controller.signal.aborted) return;
      setTrackLines(results.flatMap((result) => result.status === "fulfilled" ? result.value : []));
      setTrackFailed(results.some((result) => result.status === "rejected"));
    });
    return () => controller.abort();
  }, [owner, tracks]);

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
    ...broadPlaces.flatMap((place): MapPoint[] => place.latitude !== null && place.longitude !== null ? [{ id: place.id, label: place.label, coordinates: [place.longitude, place.latitude] }] : []),
    ...(placesQuery.data ?? []).flatMap((place): MapPoint[] => place.latitude !== null && place.longitude !== null ? [{ id: place.id, label: place.display_name ?? place.locality ?? "Exacte plaats", coordinates: [place.longitude, place.latitude] }] : []),
  ], [placesQuery.data, broadPlaces]);
  const liveLines = useMemo<MapLine[]>(() => [
    ...(routesQuery.data ?? []).map((route): MapLine => ({ id: route.id, label: route.label, coordinates: route.geometry.coordinates })),
    ...trackLines,
  ], [routesQuery.data, trackLines]);
  const displayedPoints = snapshot?.points ?? points;
  const lines = snapshot?.lines ?? liveLines;

  async function toggleOffline() {
    if (offline.isPinned("map_route_data", trip.id)) {
      await offline.removeByResource("map_route_data", trip.id);
      setNotice("Kaart- en routegegevens zijn niet langer offline beschikbaar.");
      return;
    }
    await offline.pin({
      resourceKind: "map_route_data",
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
      : trackFailed ? "Een private track kon niet worden getekend; de overige kaartgegevens blijven beschikbaar."
      : "");

  return <><TripMap points={displayedPoints} lines={lines} owner focus={focus} /><div className="button-row"><button className="secondary compact" type="button" disabled={displayedPoints.length === 0 && lines.length === 0} onClick={() => void toggleOffline().catch((error: unknown) => setNotice(errorMessage(error, "De kaartgegevens konden niet offline worden bewaard.")))}>{offline.isPinned("map_route_data", trip.id) ? "Offline verwijderen" : "Kaart offline bewaren"}</button></div><p className="help">Alleen de private GeoJSON-kaartgegevens worden bewust bewaard; kaarttegels worden niet offline opgeslagen.</p>{status && <p className="help" role="status">{status}</p>}</>;
}
