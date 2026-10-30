import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { Markdown } from "../../Markdown";
import { visitTitle, type Trip, type Visit, areaName } from "../../tracker-model";
import { VISIT_KIND_LABELS, VISIT_STATUS_LABELS, visitWhen } from "../labels";
import { placeLabel, RecordHeading, Section } from "./shared";
import { DetailList } from "./DetailList";

export function VisitsBlock({ trip, visits }: { trip: Trip; visits: Visit[] }) {
  useLocale();
  return (
    <Section id="visits" title={m.owner_visits()}>
      <DetailList empty={visits.length === 0} message={m.owner_no_visits_yet()} ordered>
        {visits.map((visit) => (
          <li key={visit.id}>
            <RecordHeading tripId={trip.id} kind="visit" id={visit.id}>
              <strong>{visitTitle(visit)}</strong>
            </RecordHeading>
            <span>
              {visitWhen(visit)}
              {visit.kind ? ` · ${VISIT_KIND_LABELS[visit.kind]}` : ""}
              {visit.status ? ` · ${VISIT_STATUS_LABELS[visit.status]}` : ""} ·{" "}
              {visit.location ? `${placeLabel(visit.location)} · ` : ""}
              {areaName(visit.area)}
            </span>
            <Markdown html={visit.notes_html} text={visit.notes} />
            {visit.summary && (
              <>
                <p className="markdown-label">{m.owner_for_visitors()}</p>
                <Markdown html={visit.summary_html} text={visit.summary} />
              </>
            )}
          </li>
        ))}
      </DetailList>
    </Section>
  );
}
