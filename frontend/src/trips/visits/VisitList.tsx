import { Button } from "@base-ui/react/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { Stay, Trip, Visit } from "../../tracker-model";
import { visitTitle } from "../../tracker-model";
import { visibilityLabel } from "../visibility";
import { RestatedRoutesNote } from "../VisitRouteHint";
import { dayLine, visitPlace } from "./model";
import { Overnight } from "./Overnight";

/** The saved visits in order, each with where it sleeps and its map, offline and reorder actions. */
export function VisitList({
  visits,
  stays,
  trip,
  pinned,
  onInspect,
  onShowOnMap,
  onToggleOffline,
  onShift,
}: {
  visits: Visit[];
  stays: Stay[];
  trip: Trip;
  pinned: (visit: Visit) => boolean;
  onInspect: (id: string) => void;
  onShowOnMap?: (visit: Visit) => void;
  onToggleOffline: (visit: Visit) => void;
  onShift: (visit: Visit, direction: -1 | 1) => void;
}) {
  useLocale();
  return (
    <div className="saved-records mt-0.5">
      {visits.map((visit, index) => (
        <article className="excerpt-row" data-stacked="" key={visit.id}>
          <Button
            className="document-select"
            type="button"
            onClick={() => onInspect(visit.id)}
            aria-label={m.owner_view_visit({ p0: visitTitle(visit) })}
          >
            <strong>{visitTitle(visit)}</strong>
            <span>
              {[dayLine(visit), visitPlace(visit), visibilityLabel(visit.visibility)].join(" · ")}
            </span>
          </Button>
          <Overnight visit={visit} stays={stays} trip={trip} />
          <RestatedRoutesNote routes={visit.possible_route_duplicates ?? []} />
          <div className="button-row">
            {onShowOnMap && (
              <Button
                className="secondary compact"
                type="button"
                onClick={() => onShowOnMap(visit)}
                aria-label={m.owner_show_on_map({ p0: visitTitle(visit) })}
              >
                {m.owner_show_on_map_2()}
              </Button>
            )}
            <Button
              className="secondary compact"
              type="button"
              onClick={() => onToggleOffline(visit)}
              aria-label={
                pinned(visit)
                  ? m.owner_remove_visit_offline({ name: visitTitle(visit) })
                  : m.owner_save_visit_offline({ name: visitTitle(visit) })
              }
            >
              {pinned(visit) ? m.owner_remove_offline_copy() : m.owner_save_offline()}
            </Button>
            <Button
              className="secondary compact"
              type="button"
              disabled={index === 0}
              onClick={() => onShift(visit, -1)}
              aria-label={m.owner_move_up({ p0: visitTitle(visit) })}
            >
              {m.owner_move_up_2()}
            </Button>
            <Button
              className="secondary compact"
              type="button"
              disabled={index === visits.length - 1}
              onClick={() => onShift(visit, 1)}
              aria-label={m.owner_move_down({ p0: visitTitle(visit) })}
            >
              {m.owner_move_down_2()}
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
