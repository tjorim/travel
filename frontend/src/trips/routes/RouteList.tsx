import { Button } from "@/ui/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { routeTitle } from "../../records";
import { type Route } from "../../api-types";
import { visibilityLabel } from "../visibility";
import { routeLine } from "./model";

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
            aria-label={m.routes_view_route({ title: routeTitle(route) })}
          >
            <strong>{routeTitle(route)}</strong>
            <span>
              {[routeLine(route, { withStatus: true }), visibilityLabel(route.visibility)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </Button>
        </article>
      ))}
    </div>
  );
}
