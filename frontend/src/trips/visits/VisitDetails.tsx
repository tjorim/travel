import { useLocale } from "../../locale";
import { Markdown } from "../../Markdown";
import { m } from "../../paraglide/messages.js";
import { DeleteConfirmation } from "../../RecordDialog";
import { visitTitle, type Stay, type Trip, type Visit } from "../../tracker-model";
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
            <p className="markdown-label">{m.owner_for_visitors()}</p>
            <Markdown html={selected.summary_html} text={selected.summary} />
          </>
        )}
        <Overnight visit={selected} stays={stays} trip={trip} />
        <RestatedRoutesNote routes={selected.possible_route_duplicates ?? []} />
      </div>
      <div>
        <h4>{m.owner_only_for_you()}</h4>
        {selected.notes ? (
          <Markdown html={selected.notes_html} text={selected.notes} />
        ) : (
          <p className="help">{m.owner_no_private_note()}</p>
        )}
      </div>
      {selected.status === "cancelled" ? (
        <p className="help">{m.owner_a_cancelled_visit_is_never_shared()}</p>
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
            ? m.owner_visitors_also_see_the_time_because_you_selected_it_and_share_the_full_da()
            : m.owner_the_time_stays_private()
          : m.owner_this_visit_has_no_time()}{" "}
        {m.owner_notes_always_stay_private()}
      </p>
      <RecordActions onEdit={() => onEdit(selected)} onDelete={() => onConfirmDelete(true)} />
      {confirmDelete && (
        <DeleteConfirmation
          title={m.owner_delete_visit({ p0: visitTitle(selected) })}
          onCancel={() => onConfirmDelete(false)}
          onConfirm={() => onErase(selected)}
        />
      )}
    </div>
  );
}
