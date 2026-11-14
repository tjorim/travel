import { Button } from "@/ui/button";

import { useLocale } from "../../locale";
import { Markdown } from "../../Markdown";
import { m } from "../../paraglide/messages.js";
import { areaName, stayLabel } from "../../records";
import { type Stay } from "../../api-types";
import { VisibilityControl } from "../visibility";
import { RecordActions } from "../RecordActions";
import { IdeaNote } from "../IdeaNote";
import { LinkedDocuments } from "../LinkedDocuments";

/** The read-only view of one stay, with its visibility, overlapping ideas and edit/delete actions. */
export function StayDetails({
  tripId,
  selected,
  alternatives,
  saving,
  onCancelAlternatives,
  onEdit,
  onDelete,
}: {
  tripId: string;
  selected: Stay;
  alternatives: Stay[];
  saving: boolean;
  onCancelAlternatives: (alternatives: Stay[]) => void;
  onEdit: (stay: Stay) => void;
  onDelete: (stay: Stay) => void;
}) {
  useLocale();
  return (
    <div className="stack-form">
      <div>
        <h3>{stayLabel(selected)}</h3>
        {selected.location ? (
          (selected.location.address_line1 || selected.location.locality) && (
            <p>
              {[selected.location.address_line1, selected.location.locality]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )
        ) : (
          <p>{m.stays_stay_accommodation_not_chosen_yet_in({ area: areaName(selected.area) })}</p>
        )}
        <p>
          {selected.booking_reference
            ? m.common_booking_reference_detail({ reference: selected.booking_reference })
            : m.common_no_booking_reference()}
        </p>
        {selected.contact_details && (
          <>
            <p className="markdown-label">{m.stays_contact()}</p>
            <Markdown html={selected.contact_details_html} text={selected.contact_details} />
          </>
        )}
        <Markdown html={selected.notes_html} text={selected.notes} />
      </div>
      <LinkedDocuments tripId={tripId} ids={selected.document_asset_ids} />
      {selected.status === "idea" ? (
        <IdeaNote kind="stay" />
      ) : (
        <VisibilityControl
          tripId={tripId}
          kind="stay"
          id={selected.id}
          value={selected.visibility}
          name={stayLabel(selected)}
        />
      )}
      {alternatives.length > 0 && (
        <div>
          <p className="help">
            {m.stays_stay_ideas_overlap_these_nights({ count: alternatives.length })}
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
