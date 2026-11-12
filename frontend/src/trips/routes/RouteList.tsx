import { Button } from "@/ui/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { ROUTE_MODE_LABELS, routeTitle, type Route } from "../../tracker-model";
import { PLANNING_STATUS_LABELS } from "../labels";
import { visibilityLabel } from "../visibility";
import { routeShift, routeTimes } from "./model";

/** The saved routes. Alternatives the owner confirmed are compared in the alternatives panel above. */
export function RouteList({
  routes,
  onInspect,
}: {
  routes: Route[];
  onInspect: (id: string) => void;
}) {
  useLocale();
  return (
    <div className="saved-records mt-0.5">
      {routes.map((route) => (
        <article className="excerpt-row" key={route.id}>
          <Button
            className="document-select"
            type="button"
            onClick={() => onInspect(route.id)}
            aria-label={m.owner_view_route({ p0: routeTitle(route) })}
          >
            <strong>{routeTitle(route)}</strong>
            <span>
              {[
                ROUTE_MODE_LABELS[route.mode],
                [routeTimes(route), routeShift(route)].filter(Boolean).join(""),
                PLANNING_STATUS_LABELS[route.status],
                route.carrier,
                route.geometry ? m.owner_with_line() : null,
                visibilityLabel(route.visibility),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </Button>
        </article>
      ))}
    </div>
  );
}
