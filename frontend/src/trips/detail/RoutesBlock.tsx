import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { dayjs } from "../../dayjs";
import { Markdown } from "../../Markdown";
import {
  ROUTE_MODE_LABELS,
  formatDay,
  formatInstant,
  routeTitle,
  type Location,
  type Route,
  type Trip,
} from "../../tracker-model";
import { ROUTE_STATUS_LABELS } from "../labels";
import { placeLabel, RecordHeading, Section } from "./shared";
import { DetailList } from "./DetailList";

function endpointTime(instant: string, zone: string | null): string {
  return zone
    ? `${dayjs(instant).tz(zone).format("D MMM YYYY, HH:mm")} (${zone})`
    : `${formatInstant(instant)} (${dayjs.tz.guess()})`;
}

function routeEndpoint(area: string, place: Location | null): string {
  return place ? `${area} · ${placeLabel(place)}` : area;
}

export function RoutesBlock({ trip, routes }: { trip: Trip; routes: Route[] }) {
  useLocale();
  return (
    <Section id="routes" title={m.owner_routes()}>
      <DetailList empty={routes.length === 0} message={m.owner_no_routes_captured()}>
        {routes.map((route) => (
          <article key={route.id}>
            <RecordHeading tripId={trip.id} kind="route" id={route.id}>
              {routeTitle(route)}
            </RecordHeading>
            <p>
              {[
                ROUTE_MODE_LABELS[route.mode],
                ROUTE_STATUS_LABELS[route.status],
                route.departs_at && route.arrives_at
                  ? `${endpointTime(route.departs_at, route.departure_timezone)} → ${endpointTime(route.arrives_at, route.arrival_timezone)}`
                  : route.departs_on
                    ? formatDay(route.departs_on)
                    : null,
                route.geometry
                  ? m.owner_line_with_points({ p0: route.geometry.coordinates.length })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p>
              {routeEndpoint(route.departure_area.label, route.departure_location)} →{" "}
              {routeEndpoint(route.arrival_area.label, route.arrival_location)}
            </p>
            <p>
              {[route.carrier, route.service_reference, route.travel_class]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {route.booking_reference && (
              <p>
                {m.owner_booking_reference()} {route.booking_reference}
              </p>
            )}
            <Markdown html={route.notes_html} text={route.notes} />
          </article>
        ))}
      </DetailList>
    </Section>
  );
}
