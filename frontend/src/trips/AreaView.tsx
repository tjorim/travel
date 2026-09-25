import { stayLabel, type BroadPlace, type Place, type Stay, type TransportLeg, type Trip } from "../tracker-model";
import { useTripResource } from "../query/owner-queries";

/** A private, derived view: records remain owned by their own editors. */
export function AreaView({ trip, areas }: { trip: Trip; areas: BroadPlace[] }) {
  const spotsQuery = useTripResource(trip.id, "places");
  const staysQuery = useTripResource(trip.id, "stays");
  const legsQuery = useTripResource(trip.id, "transport-legs");
  const spots = spotsQuery.data ?? [];
  const stays = staysQuery.data ?? [];
  const legs = legsQuery.data ?? [];
  const error = spotsQuery.error || staysQuery.error || legsQuery.error;

  if (!areas.length && !spots.length) return null;
  return <section className="card manager" aria-labelledby="areas-title">
    <div className="capture-heading"><div><h3 id="areas-title">Gebieden</h3><p>Alles is hier gegroepeerd op het gebied van de plek. Een gebied delen publiceert nooit automatisch de bijbehorende plekken.</p></div></div>
    {error && <p className="help" role="status">De gebiedsindeling kon niet volledig worden geladen.</p>}
    <div className="scope-items">{areas.map((area) => <AreaRow key={area.id} area={area} spots={spots} trip={trip} stays={stays} legs={legs} />)}</div>
  </section>;
}

function AreaRow({ area, spots, trip, stays, legs }: {
  area: BroadPlace; spots: Place[]; trip: Trip;
  stays: Stay[];
  legs: TransportLeg[];
}) {
  const areaSpots = spots.filter((spot) => spot.area_id === area.id);
  const areaUpdates = trip.travel_updates.filter((update) => update.area?.id === area.id);
  const areaStays = stays.filter((stay) => stay.area?.id === area.id);
  const areaLegs = legs.filter((leg) => leg.departure_area?.id === area.id || leg.arrival_area?.id === area.id);
  const endpoint = (leg: typeof legs[number]) => `${leg.departure_area?.label ?? "?"} → ${leg.arrival_area?.label ?? "?"}`;
  const total = areaSpots.length + areaUpdates.length + areaStays.length + areaLegs.length;
  return <details className="scope-group">
    <summary><strong>{area.label}</strong><span>{[area.region, area.country_code, `${total} ${total === 1 ? "onderdeel" : "onderdelen"}`].filter(Boolean).join(" · ")}</span></summary>
    <div className="scope-group-body">
      {areaSpots.length > 0 && <p><strong>Plekken</strong> · {areaSpots.map((spot) => spot.label || spot.display_name?.split(",")[0] || spot.locality || "Naamloze plek").join("; ")}</p>}
      {areaStays.length > 0 && <p><strong>Verblijven</strong> · {areaStays.map(stayLabel).join("; ")}</p>}
      {areaUpdates.length > 0 && <p><strong>Reisupdates</strong> · {areaUpdates.map((update) => update.title).join("; ")}</p>}
      {areaLegs.length > 0 && <p><strong>Vervoer</strong> · {areaLegs.map(endpoint).join("; ")}</p>}
      {!total && <p className="help">Nog geen plekken of reisgegevens in dit gebied.</p>}
    </div>
  </details>;
}
