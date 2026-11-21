import { Button } from "@/components/ui/button";

import { AuthoredText } from "@/i18n/content-language";
import { useLocale } from "@/i18n/locale";
import { Markdown } from "@/components/Markdown";
import { m } from "@/paraglide/messages.js";
import { ROUTE_MODE_LABELS, routeTitle } from "@/lib/records";
import { type Route } from "@/api-types";
import { PLANNING_STATUS_LABELS } from "@/lib/labels";
import { RouteGeometryEditor } from "@/trips/RouteGeometryEditor";
import { VisibilityControl } from "@/trips/visibility";
import { routeTimes } from "./model";
import { RecordActions } from "@/trips/RecordActions";
import { IdeaNote } from "@/trips/IdeaNote";
import { LinkedDocuments } from "@/trips/LinkedDocuments";

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
        <AuthoredText as="h3" record={selected} field="label">
          {routeTitle(selected)}
        </AuthoredText>
        <p>
          {[
            ROUTE_MODE_LABELS[selected.mode],
            PLANNING_STATUS_LABELS[selected.status],
            routeTimes(selected),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p>
          {selected.booking_reference
            ? m.common_booking_reference_detail({ reference: selected.booking_reference })
            : m.common_no_booking_reference()}
        </p>
        <Markdown html={selected.notes_html} text={selected.notes} />
      </div>
      <LinkedDocuments tripId={tripId} ids={selected.document_asset_ids} />
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
          <p className="help">{m.routes_visitor_fields_hint()}</p>
        </>
      )}
      {alternatives.length > 0 && (
        <div>
          <p className="help">
            {m.routes_route_ideas_for_this_journey({ count: alternatives.length })}
          </p>
          <Button
            className="secondary compact"
            type="button"
            disabled={saving}
            onClick={() => onCancelAlternatives(alternatives)}
          >
            {m.alternatives_cancel_count({ count: alternatives.length })}
          </Button>
        </div>
      )}
      <RecordActions onEdit={() => onEdit(selected)} onDelete={() => onDelete(selected)} />
    </div>
  );
}
