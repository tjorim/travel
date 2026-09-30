import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { Button } from "@base-ui/react/button";
import { routeTitle, stayLabel, visitTitle, type Area, type Trip } from "../tracker-model";
import { useTripResource } from "../query/owner-queries";

/** What belongs to one area: a private, derived view. Each record stays owned by its own editor. */
export function AreaContents({
  trip,
  area,
  onOpenLocation,
}: {
  trip: Trip;
  area: Area;
  onOpenLocation: (id: string) => void;
}) {
  useLocale();
  const locationsQuery = useTripResource(trip.id, "locations");
  const staysQuery = useTripResource(trip.id, "stays");
  const routesQuery = useTripResource(trip.id, "routes");
  const visitsQuery = useTripResource(trip.id, "visits");
  const locations = (locationsQuery.data ?? []).filter((location) => location.area_id === area.id);
  const updates = trip.travel_updates.filter((update) => update.area?.id === area.id);
  const stays = (staysQuery.data ?? []).filter((stay) => stay.area?.id === area.id);
  const routes = (routesQuery.data ?? []).filter(
    (route) => route.departure_area.id === area.id || route.arrival_area.id === area.id,
  );
  const visits = (visitsQuery.data ?? []).filter((visit) => visit.area.id === area.id);
  const error = locationsQuery.error || staysQuery.error || routesQuery.error || visitsQuery.error;
  const total = locations.length + updates.length + stays.length + routes.length + visits.length;
  return (
    <div className="grid gap-2.5 px-3.25 pt-0 pb-3.25">
      {error && (
        <p className="help" role="status">
          {m.owner_the_records_in_this_area_could_not_be_fully_loaded()}
        </p>
      )}
      {locations.length > 0 && (
        <div>
          <strong>{m.owner_locations()}</strong>
          <ul>
            {locations.map((location) => (
              <li key={location.id}>
                <Button className="secondary compact" type="button" onClick={() => onOpenLocation(location.id)}>
                  {location.label ||
                    location.display_name?.split(",")[0] ||
                    location.locality ||
                    m.owner_unnamed_location()}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {visits.length > 0 && (
        <p>
          <strong>{m.owner_visits()}</strong> · {visits.map(visitTitle).join("; ")}
        </p>
      )}
      {stays.length > 0 && (
        <p>
          <strong>{m.owner_stays()}</strong> · {stays.map(stayLabel).join("; ")}
        </p>
      )}
      {updates.length > 0 && (
        <p>
          <strong>{m.owner_travel_updates()}</strong> · {updates.map((update) => update.title).join("; ")}
        </p>
      )}
      {routes.length > 0 && (
        <p>
          <strong>{m.owner_routes()}</strong> · {routes.map(routeTitle).join("; ")}
        </p>
      )}
      {!total && !error && <p className="help">{m.owner_no_locations_or_travel_records_in_this_area_yet()}</p>}
    </div>
  );
}
