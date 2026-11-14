import { Button } from "@/ui/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { Stay, Trip, Visit } from "../../api-types";
import { visitTitle } from "../../records";
import { visibilityLabel } from "../visibility";
import { RestatedRoutesNote } from "../VisitRouteHint";
import { dayLine, visitPlace } from "./model";
import { Overnight } from "./Overnight";

/** The saved visits in the server's order (day, time, creation), each with where it sleeps and its map and offline actions. */
export function VisitList({
  visits,
  stays,
  trip,
  pinned,
  onInspect,
  onShowOnMap,
  onToggleOffline,
}: {
  visits: Visit[];
  stays: Stay[];
  trip: Trip;
  pinned: (visit: Visit) => boolean;
  onInspect: (id: string) => void;
  onShowOnMap?: (visit: Visit) => void;
  onToggleOffline: (visit: Visit) => void;
}) {
  useLocale();
  return (
    <div className="saved-records mt-0.5">
      {visits.map((visit) => (
        <article className="excerpt-row" data-stacked="" key={visit.id}>
          <Button
            className="document-select"
            type="button"
            onClick={() => onInspect(visit.id)}
            aria-label={m.visits_view_visit({ title: visitTitle(visit) })}
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
                aria-label={m.visits_show_on_map_named({ title: visitTitle(visit) })}
              >
                {m.visits_show_on_map_action()}
              </Button>
            )}
            <Button
              className="secondary compact"
              type="button"
              onClick={() => onToggleOffline(visit)}
              aria-label={
                pinned(visit)
                  ? m.visits_remove_visit_offline({ name: visitTitle(visit) })
                  : m.visits_save_visit_offline({ name: visitTitle(visit) })
              }
            >
              {pinned(visit) ? m.common_remove_offline_copy() : m.common_save_offline()}
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
