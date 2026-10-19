import { Button } from "@base-ui/react/button";

import { useLocale } from "../../locale";
import { Markdown } from "../../Markdown";
import { m } from "../../paraglide/messages.js";
import { ROUTE_MODE_LABELS, routeTitle, type Route } from "../../tracker-model";
import { ROUTE_STATUS_LABELS } from "../labels";
import { RouteGeometryEditor } from "../RouteGeometryEditor";
import { VisibilityControl } from "../visibility";
import { routeTimes } from "./model";
import { RecordActions } from "../RecordActions";
import { IdeaNote } from "../IdeaNote";

/** The read-only view of one route, with its visibility, rejected alternatives and edit/delete actions. */
export function RouteDetails({
  tripId,
  selected,
  alternatives,
  saving,
  onCancelAlternatives,
  onEdit,
  onDelete,
}: {
  tripId: string;
  selected: Route;
  alternatives: Route[];
  saving: boolean;
  onCancelAlternatives: (alternatives: Route[]) => void;
  onEdit: (route: Route) => void;
  onDelete: (route: Route) => void;
}) {
  useLocale();
  return (
    <div className="stack-form">
      <div>
        <h3>{routeTitle(selected)}</h3>
        <p>
          {[
            ROUTE_MODE_LABELS[selected.mode],
            ROUTE_STATUS_LABELS[selected.status],
            routeTimes(selected),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p>
          {selected.booking_reference
            ? m.owner_booking_reference_2({ p0: selected.booking_reference })
            : m.owner_no_booking_reference()}
        </p>
        <Markdown html={selected.notes_html} text={selected.notes} />
      </div>
      {selected.geometry && (
        <RouteGeometryEditor
          coordinates={selected.geometry.coordinates}
          onChange={() => undefined}
          mode="preview"
        />
      )}
      {selected.status === "idea" ? (
        <IdeaNote kind="route" />
      ) : (
        <>
          <VisibilityControl
            tripId={tripId}
            kind="route"
            id={selected.id}
            value={selected.visibility}
            name={routeTitle(selected)}
          />
          <p className="help">
            {m.owner_visitors_see_the_areas_travel_mode_and_line_never_your_booking_code_clas()}
          </p>
        </>
      )}
      {alternatives.length > 0 && (
        <div>
          <p className="help">
            {m.owner_route_ideas_for_this_journey({ count: alternatives.length })}
          </p>
          <Button
            className="secondary compact"
            type="button"
            disabled={saving}
            onClick={() => onCancelAlternatives(alternatives)}
          >
            {m.owner_cancel_route_alternatives({ count: alternatives.length })}
          </Button>
        </div>
      )}
      <RecordActions onEdit={() => onEdit(selected)} onDelete={() => onDelete(selected)} />
    </div>
  );
}
