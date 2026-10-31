import { Button } from "@/ui/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { daysBetween, formatDay, stayLabel, type Stay } from "../../tracker-model";
import { stayStateLabel } from "../labels";
import { visibilityLabel } from "../visibility";
import { stayEntries } from "./model";
import { AlternativesGroup } from "../AlternativesGroup";

/** The saved stays, with ideas for the same dates grouped as alternatives. */
export function StayList({
  stays,
  onInspect,
  onAdjustNights,
  saving = false,
}: {
  stays: Stay[];
  onInspect: (id: string) => void;
  /** Moves a stay's check-out by a night; only offered for a stay still being planned or compared. */
  onAdjustNights?: (stay: Stay, delta: -1 | 1) => void;
  saving?: boolean;
}) {
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
              {onAdjustNights && (stay.status === "idea" || stay.status === "planned") && (
                <div
                  className="button-row items-center"
                  role="group"
                  aria-label={m.owner_stay_nights_group({ name: stayLabel(stay) })}
                >
                  <Button
                    className="secondary compact min-h-11 min-w-11"
                    type="button"
                    disabled={saving || nights <= 1}
                    aria-label={m.owner_stay_one_night_less({ name: stayLabel(stay) })}
                    onClick={() => onAdjustNights(stay, -1)}
                  >
                    −
                  </Button>
                  <span aria-hidden="true" className="min-w-16 text-center text-sm font-bold">
                    {m.owner_night_count({ count: nights })}
                  </span>
                  <Button
                    className="secondary compact min-h-11 min-w-11"
                    type="button"
                    disabled={saving}
                    aria-label={m.owner_stay_one_night_more({ name: stayLabel(stay) })}
                    onClick={() => onAdjustNights(stay, 1)}
                  >
                    +
                  </Button>
                </div>
              )}
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
