import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { Link } from "@tanstack/react-router";

import { Markdown } from "../../Markdown";
import type { Location, Trip } from "../../tracker-model";
import { placeLabel, Section } from "./shared";
import { DetailList } from "./DetailList";

export function LocationsBlock({ trip, places }: { trip: Trip; places: Location[] }) {
  useLocale();
  return (
    <Section id="locations" title={m.owner_locations()}>
      <DetailList empty={places.length === 0} message={m.owner_no_locations_captured()}>
        {places.map((place) => (
          <article key={place.id}>
            <div className="flex items-baseline justify-between gap-2.5 [&_h3]:m-0">
              <h3>{placeLabel(place)}</h3>
              <Link
                className="action-link compact"
                to={`/trips/${encodeURIComponent(trip.id)}/plan`}
              >
                {m.owner_go_to_planning()}
              </Link>
            </div>
            <Markdown html={place.notes_html} text={place.notes} />
            {place.latitude != null && place.longitude != null && (
              <p>
                {m.owner_coordinates()} {place.latitude}, {place.longitude}
              </p>
            )}
          </article>
        ))}
      </DetailList>
    </Section>
  );
}
