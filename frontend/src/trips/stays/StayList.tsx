import { Button } from "@base-ui/react/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { daysBetween, formatDay, stayLabel, type Stay } from "../../tracker-model";
import { stayStateLabel } from "../labels";
import { visibilityLabel } from "../visibility";
import { stayEntries } from "./model";
import { AlternativesGroup } from "../AlternativesGroup";

/** The saved stays, with ideas for the same dates grouped as alternatives. */
export function StayList({ stays, onInspect }: { stays: Stay[]; onInspect: (id: string) => void }) {
  useLocale();
  return (
    <div className="saved-records mt-0.5">
      {stayEntries(stays).map((entry) => {
        const rows = entry.stays.map((stay) => {
          const nights = daysBetween(stay.check_in_date, stay.check_out_date);
          return (
            <article className="excerpt-row" key={stay.id}>
              <Button className="document-select" type="button" onClick={() => onInspect(stay.id)}>
                <strong>{stayLabel(stay)}</strong>
                <span>
                  {[
                    stay.area?.label,
                    `${formatDay(stay.check_in_date)} → ${formatDay(stay.check_out_date)}`,
                    m.owner_night_count({ count: nights }),
                    stayStateLabel(stay),
                    visibilityLabel(stay.visibility),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Button>
            </article>
          );
        });
        if (!entry.dates) return rows;
        const label = m.owner_stay_alternatives({ dates: entry.dates });
        return (
          <AlternativesGroup key={entry.stays[0].id} label={label}>
            {rows}
          </AlternativesGroup>
        );
      })}
    </div>
  );
}
