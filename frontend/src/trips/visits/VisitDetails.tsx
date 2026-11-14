import { useLocale } from "../../locale";
import { Markdown } from "../../Markdown";
import { m } from "../../paraglide/messages.js";
import { DeleteConfirmation } from "../../RecordDialog";
import { visitTitle } from "../../records";
import { type Stay, type Trip, type Visit } from "../../api-types";
import { VisibilityControl } from "../visibility";
import { RestatedRoutesNote } from "../VisitRouteHint";
import { dayLine, visitPlace } from "./model";
import { Overnight } from "./Overnight";
import { RecordActions } from "../RecordActions";

/** The read-only view of one visit: what visitors see, the private note, visibility and edit/delete. */
export function VisitDetails({
  trip,
  selected,
  stays,
  confirmDelete,
  onConfirmDelete,
  onEdit,
  onErase,
}: {
  trip: Trip;
  selected: Visit;
  stays: Stay[];
  confirmDelete: boolean;
  onConfirmDelete: (confirming: boolean) => void;
  onEdit: (visit: Visit) => void;
  onErase: (visit: Visit) => void;
}) {
  useLocale();
  return (
    <div className="stack-form">
      <div>
        <h3>{visitTitle(selected)}</h3>
        <p>{dayLine(selected)}</p>
        <p>{visitPlace(selected)}</p>
        {selected.summary && (
          <>
            <p className="markdown-label">{m.visits_for_visitors()}</p>
            <Markdown html={selected.summary_html} text={selected.summary} />
          </>
        )}
        <Overnight visit={selected} stays={stays} trip={trip} />
        <RestatedRoutesNote routes={selected.possible_route_duplicates ?? []} />
      </div>
      <div>
        <h4>{m.common_only_for_you()}</h4>
        {selected.notes ? (
          <Markdown html={selected.notes_html} text={selected.notes} />
        ) : (
          <p className="help">{m.common_no_private_note()}</p>
        )}
      </div>
      {selected.status === "cancelled" ? (
        <p className="help">{m.visits_a_cancelled_visit_is_never_shared()}</p>
      ) : (
        <VisibilityControl
          tripId={trip.id}
          kind="visit"
          id={selected.id}
          value={selected.visibility}
          name={visitTitle(selected)}
        />
      )}
      <p className="help">
        {selected.start_time
          ? selected.share_time
            ? m.visits_time_shared_hint()
            : m.visits_the_time_stays_private()
          : m.visits_this_visit_has_no_time()}{" "}
        {m.visits_notes_always_stay_private()}
      </p>
      <RecordActions onEdit={() => onEdit(selected)} onDelete={() => onConfirmDelete(true)} />
      {confirmDelete && (
        <DeleteConfirmation
          title={m.visits_delete_visit({ title: visitTitle(selected) })}
          onCancel={() => onConfirmDelete(false)}
          onConfirm={() => onErase(selected)}
        />
      )}
    </div>
  );
}
