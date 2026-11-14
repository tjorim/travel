import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { Area, Trip } from "../../api-types";
import { RecordHeading, Section } from "./shared";
import { DetailList } from "./DetailList";

export function AreasBlock({ trip, areas }: { trip: Trip; areas: Area[] }) {
  useLocale();
  return (
    <Section id="areas" title={m.common_areas()}>
      <DetailList empty={areas.length === 0} message={m.areas_no_areas_captured_yet()}>
        {areas.map((place) => (
          <article key={place.id}>
            <RecordHeading tripId={trip.id} kind="area" id={place.id}>
              {place.label}
            </RecordHeading>
            <p>{[place.region, place.country_code].filter(Boolean).join(" · ")}</p>
          </article>
        ))}
      </DetailList>
    </Section>
  );
}
