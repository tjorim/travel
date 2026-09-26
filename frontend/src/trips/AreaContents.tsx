import { routeTitle, stayLabel, visitTitle, type Area, type Trip } from "../tracker-model";
import { useTripResource } from "../query/owner-queries";

/** What belongs to one area: a private, derived view. Each record stays owned by its own editor. */
export function AreaContents({ trip, area }: { trip: Trip; area: Area }) {
  const locationsQuery = useTripResource(trip.id, "locations");
  const staysQuery = useTripResource(trip.id, "stays");
  const routesQuery = useTripResource(trip.id, "routes");
  const visitsQuery = useTripResource(trip.id, "visits");
  const locations = (locationsQuery.data ?? []).filter((location) => location.area_id === area.id);
  const updates = trip.travel_updates.filter((update) => update.area?.id === area.id);
  const stays = (staysQuery.data ?? []).filter((stay) => stay.area?.id === area.id);
  const routes = (routesQuery.data ?? []).filter((route) => route.departure_area.id === area.id || route.arrival_area.id === area.id);
  const visits = (visitsQuery.data ?? []).filter((visit) => visit.area.id === area.id);
  const error = locationsQuery.error || staysQuery.error || routesQuery.error || visitsQuery.error;
  const total = locations.length + updates.length + stays.length + routes.length + visits.length;
  return <div className="scope-group-body">
    {error && <p className="help" role="status">Wat bij dit gebied hoort kon niet volledig worden geladen.</p>}
    {locations.length > 0 && <p><strong>Locaties</strong> · {locations.map((location) => location.label || location.display_name?.split(",")[0] || location.locality || "Naamloze locatie").join("; ")}</p>}
    {visits.length > 0 && <p><strong>Bezoeken</strong> · {visits.map(visitTitle).join("; ")}</p>}
    {stays.length > 0 && <p><strong>Verblijven</strong> · {stays.map(stayLabel).join("; ")}</p>}
    {updates.length > 0 && <p><strong>Reisupdates</strong> · {updates.map((update) => update.title).join("; ")}</p>}
    {routes.length > 0 && <p><strong>Routes</strong> · {routes.map(routeTitle).join("; ")}</p>}
    {!total && !error && <p className="help">Nog geen locaties of reisgegevens in dit gebied.</p>}
  </div>;
}
