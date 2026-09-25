import { useState } from "react";

import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { spotName, type BroadPlace, type Place, type Trip } from "../tracker-model";
import { VisibilityControl, visibilityLabel } from "./visibility";

type SpotChange = { label?: string | null; area_id?: string | null; share_address?: boolean };

function SpotRow({ tripId, place, areas }: { tripId: string; place: Place; areas: BroadPlace[] }) {
  const [label, setLabel] = useState(place.label ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const save = useOwnerMutation<SpotChange, Place>({
    fallback: "De plek kon niet worden opgeslagen.",
    request: (change) => ({ path: `${tripPath(tripId, "places")}/${place.id}`, method: "PATCH", body: change }),
    // A spot's area is embedded in updates and stays, so the trip is refreshed with it.
    invalidate: (subject) => [ownerKeys.tripResource(subject, tripId, "places"), ownerKeys.trips(subject)],
  });
  const apply = (change: SpotChange, done: string) => save.mutateAsync(change).then(() => setMessage(done), (error: unknown) => setMessage(errorMessage(error, "De plek kon niet worden opgeslagen.")));
  const trimmed = label.trim();
  return <article className="scope-item">
    <div><strong>{spotName(place)}</strong><span>{[place.locality, place.country_code, visibilityLabel(place.visibility)].filter(Boolean).join(" · ")}</span></div>
    <div className="field"><label>Gebied
      <select aria-label={`Gebied van ${spotName(place)}`} value={place.area_id ?? ""} disabled={save.isPending} onChange={(event) => void apply({ area_id: event.target.value || null }, "Gebied opgeslagen.")}>
        {areas.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}
      </select>
    </label></div>
    <div className="field"><label>Publieke naam
      <input aria-label={`Publieke naam van ${spotName(place)}`} value={label} maxLength={120} placeholder="Bijvoorbeeld: warme bron van Beitou" onChange={(event) => { setLabel(event.target.value); setMessage(null); }} />
    </label></div>
    <div className="button-row"><button className="secondary compact" type="button" disabled={save.isPending || trimmed === (place.label ?? "") || (trimmed === "" && place.visibility !== "private")} onClick={() => void apply({ label: trimmed || null }, "Publieke naam opgeslagen.")}>Naam bewaren</button></div>
    <label className="scope-choice"><input type="checkbox" aria-label={`Adres delen van ${spotName(place)}`} checked={place.share_address} disabled={save.isPending} onChange={(event) => void apply({ share_address: event.target.checked }, event.target.checked ? "Het adres wordt mee gedeeld zodra je de plek deelt." : "Het adres blijft privé.")} />Adres ook delen<small>{place.visibility === "private" ? " Pas van kracht wanneer je de plek deelt." : " Bezoekers zien straat, postcode en plaats, nooit je notities."}</small></label>
    {message && <p className="help" role="status">{message}</p>}
    <VisibilityControl tripId={tripId} kind="place" id={place.id} value={place.visibility} name={spotName(place)} />
  </article>;
}

/**
 * Spots are private. A shared one shows its public name, city, country and point, and its address
 * only when the owner also chooses that; never its notes. This is where the owner names a spot
 * (a monument, a hot spring, a hotel), files it under an area and chooses who sees it.
 */
export function ExactPlaceManager({ trip }: { trip: Trip }) {
  const placesQuery = useTripResource(trip.id, "places");
  const areasQuery = useTripResource(trip.id, "places/broad");
  const places = placesQuery.data ?? [];
  const areas = areasQuery.data ?? [];
  return <section className="card manager" aria-labelledby="spots-title">
    <div className="capture-heading"><div><h3 id="spots-title">Plekken delen</h3><p>Een plek is een hotel, station of monument met een adres en hoort altijd bij één gebied. Geef hem een publieke naam en kies wie hem ziet. Het adres deel je alleen als je dat zelf aanvinkt, bijvoorbeeld voor een hotel waar je bereikbaar bent. Notities en boekingen blijven altijd privé.</p></div></div>
    <p className="help" role="status">{placesQuery.error ? errorMessage(placesQuery.error, "Je plekken konden niet worden geladen.") : placesQuery.isPending ? "Laad je plekken…" : places.length === 0 ? "Nog geen plekken. Ze ontstaan wanneer je een verblijf, vervoer of reisupdate met een plaats vastlegt." : `${places.length} ${places.length === 1 ? "plek" : "plekken"}, allemaal privé tot je kiest.`}</p>
    {places.length > 0 && <details className="scope-group"><summary><strong>Plekken</strong><span>{places.filter((place) => place.visibility !== "private").length} van {places.length} gedeeld</span></summary>
      <div className="scope-group-body scope-items">{places.map((place) => <SpotRow key={place.id} tripId={trip.id} place={place} areas={areas} />)}</div>
    </details>}
  </section>;
}
