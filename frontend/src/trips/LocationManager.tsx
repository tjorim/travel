import { useState } from "react";

import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { locationName, type Area, type Location, type Trip } from "../tracker-model";
import { VisibilityControl, visibilityLabel } from "./visibility";

type LocationChange = { label?: string | null; area_id?: string | null; share_address?: boolean };

function LocationRow({ tripId, place, areas }: { tripId: string; place: Location; areas: Area[] }) {
  const [label, setLabel] = useState(place.label ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const save = useOwnerMutation<LocationChange, Location>({
    fallback: "De locatie kon niet worden opgeslagen.",
    request: (change) => ({ path: `${tripPath(tripId, "locations")}/${place.id}`, method: "PATCH", body: change }),
    // A location's area is embedded in updates and stays, so the trip is refreshed with it.
    invalidate: (subject) => [ownerKeys.tripResource(subject, tripId, "locations"), ownerKeys.trips(subject)],
  });
  const apply = (change: LocationChange, done: string) => save.mutateAsync(change).then(() => setMessage(done), (error: unknown) => setMessage(errorMessage(error, "De locatie kon niet worden opgeslagen.")));
  const trimmed = label.trim();
  return <article className="scope-item">
    <div><strong>{locationName(place)}</strong><span>{[place.locality, place.country_code, visibilityLabel(place.visibility)].filter(Boolean).join(" · ")}</span></div>
    <div className="field"><label>Gebied
      <select aria-label={`Gebied van ${locationName(place)}`} value={place.area_id ?? ""} disabled={save.isPending} onChange={(event) => void apply({ area_id: event.target.value || null }, "Gebied opgeslagen.")}>
        {areas.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}
      </select>
    </label></div>
    <div className="field"><label>Publieke naam
      <input aria-label={`Publieke naam van ${locationName(place)}`} value={label} maxLength={120} placeholder="Bijvoorbeeld: warme bron van Beitou" onChange={(event) => { setLabel(event.target.value); setMessage(null); }} />
    </label></div>
    <div className="button-row"><button className="secondary compact" type="button" disabled={save.isPending || trimmed === (place.label ?? "") || (trimmed === "" && place.visibility !== "private")} onClick={() => void apply({ label: trimmed || null }, "Publieke naam opgeslagen.")}>Naam bewaren</button></div>
    <label className="scope-choice"><input type="checkbox" aria-label={`Adres delen van ${locationName(place)}`} checked={place.share_address} disabled={save.isPending} onChange={(event) => void apply({ share_address: event.target.checked }, event.target.checked ? "Het adres wordt mee gedeeld zodra je de locatie deelt." : "Het adres blijft privé.")} />Adres ook delen<small>{place.visibility === "private" ? " Pas van kracht wanneer je de locatie deelt." : " Bezoekers zien straat, postcode en plaats, nooit je notities."}</small></label>
    {message && <p className="help" role="status">{message}</p>}
    <VisibilityControl tripId={tripId} kind="location" id={place.id} value={place.visibility} name={locationName(place)} />
  </article>;
}

/**
 * Locations are private. A shared one shows its public name, city, country and point, and its address
 * only when the owner also chooses that; never its notes. This is where the owner names a location
 * (a monument, a hot spring, a hotel), files it under an area and chooses who sees it.
 */
export function LocationManager({ trip }: { trip: Trip }) {
  const locationsQuery = useTripResource(trip.id, "locations");
  const areasQuery = useTripResource(trip.id, "areas");
  const locations = locationsQuery.data ?? [];
  const areas = areasQuery.data ?? [];
  return <section className="card manager" id="locations" aria-labelledby="locations-title">
    <div className="capture-heading"><div><h3 id="locations-title">Locaties</h3><p>Een locatie is een hotel, station of monument met een adres en hoort altijd bij één gebied. Geef ze een publieke naam en kies wie ze ziet. Het adres deel je alleen als je dat zelf aanvinkt, bijvoorbeeld voor een hotel waar je bereikbaar bent. Notities en boekingen blijven altijd privé.</p></div></div>
    <p className="help" role="status">{locationsQuery.error ? errorMessage(locationsQuery.error, "Je locaties konden niet worden geladen.") : locationsQuery.isPending ? "Laad je locaties…" : locations.length === 0 ? "Nog geen locaties. Ze ontstaan wanneer je een verblijf, vervoer of reisupdate met een locatie vastlegt." : `${locations.length} ${locations.length === 1 ? "locatie" : "locaties"}, allemaal privé tot je kiest.`}</p>
    {locations.length > 0 && <details className="scope-group"><summary><strong>Locaties</strong><span>{locations.filter((place) => place.visibility !== "private").length} van {locations.length} gedeeld</span></summary>
      <div className="scope-group-body scope-items">{locations.map((place) => <LocationRow key={place.id} tripId={trip.id} place={place} areas={areas} />)}</div>
    </details>}
  </section>;
}
