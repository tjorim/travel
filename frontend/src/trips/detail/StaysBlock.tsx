import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { Markdown } from "../../Markdown";
import { formatDayRange, stayLabel, type Stay, type Trip, areaName } from "../../tracker-model";
import { stayStateLabel } from "../labels";
import { placeLabel, RecordHeading, Section } from "./shared";
import { DetailList } from "./DetailList";

export function StaysBlock({ trip, stays }: { trip: Trip; stays: Stay[] }) {
  useLocale();
  return (
    <Section id="stays" title={m.owner_stays()}>
      <DetailList empty={stays.length === 0} message={m.owner_no_stays_captured()}>
        {stays
          .slice()
          .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))
          .map((stay) => (
            <article key={stay.id}>
              <RecordHeading tripId={trip.id} kind="stay" id={stay.id}>
                {stayLabel(stay)}
              </RecordHeading>
              <p>
                {formatDayRange(stay.check_in_date, stay.check_out_date)} · {stayStateLabel(stay)}
              </p>
              {(stay.check_in_time || stay.check_out_time) && (
                <p>
                  {[
                    stay.check_in_time && m.owner_check_in({ p0: stay.check_in_time.slice(0, 5) }),
                    stay.check_out_time &&
                      m.owner_check_out({ p0: stay.check_out_time.slice(0, 5) }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {stay.area.timezone ? ` (${stay.area.timezone})` : ""}
                </p>
              )}
              <p>
                {placeLabel(stay.location)}
                {` · ${areaName(stay.area)}`}
              </p>
              {stay.website_url && (
                <a href={stay.website_url} target="_blank" rel="noreferrer">
                  {m.owner_accommodation_website()}
                </a>
              )}
              {stay.booking_reference && (
                <p>
                  {m.owner_booking_reference()} {stay.booking_reference}
                </p>
              )}
              {stay.contact_details && (
                <>
                  <p className="markdown-label">{m.owner_contact()}</p>
                  <Markdown html={stay.contact_details_html} text={stay.contact_details} />
                </>
              )}
              <Markdown html={stay.notes_html} text={stay.notes} />
            </article>
          ))}
      </DetailList>
    </Section>
  );
}
