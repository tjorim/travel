import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { Markdown } from "../../Markdown";
import { formatDayRange } from "../../dates";
import { stayLabel, areaName } from "../../records";
import { type Stay, type Trip } from "../../api-types";
import { PLANNING_STATUS_LABELS } from "../labels";
import { placeLabel, RecordHeading, Section } from "./shared";
import { DetailList } from "./DetailList";

export function StaysBlock({ trip, stays }: { trip: Trip; stays: Stay[] }) {
  useLocale();
  return (
    <Section id="stays" title={m.common_stays()}>
      <DetailList empty={stays.length === 0} message={m.stays_no_stays_captured()}>
        {stays
          .slice()
          .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))
          .map((stay) => (
            <article key={stay.id}>
              <RecordHeading tripId={trip.id} kind="stay" id={stay.id}>
                {stayLabel(stay)}
              </RecordHeading>
              <p>
                {formatDayRange(stay.check_in_date, stay.check_out_date)} ·{" "}
                {PLANNING_STATUS_LABELS[stay.status]}
              </p>
              {(stay.check_in_time || stay.check_out_time) && (
                <p>
                  {[
                    stay.check_in_time &&
                      m.stays_check_in({ time: stay.check_in_time.slice(0, 5) }),
                    stay.check_out_time &&
                      m.stays_check_out({ time: stay.check_out_time.slice(0, 5) }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {stay.area.timezone ? ` (${stay.area.timezone})` : ""}
                </p>
              )}
              <p>
                {stay.location ? placeLabel(stay.location) : m.stays_accommodation_not_chosen_yet()}
                {` · ${areaName(stay.area)}`}
              </p>
              {stay.website_url && (
                <a href={stay.website_url} target="_blank" rel="noreferrer">
                  {m.stays_accommodation_website()}
                </a>
              )}
              {stay.booking_reference && (
                <p>
                  {m.common_booking_reference()} {stay.booking_reference}
                </p>
              )}
              {stay.contact_details && (
                <>
                  <p className="markdown-label">{m.stays_contact()}</p>
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
