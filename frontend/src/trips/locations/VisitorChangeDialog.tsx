import { DeleteConfirmation } from "../../RecordDialog";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { areaName, type Area } from "../../tracker-model";
import { audienceName, visitorFieldLabel, type VisitorChange } from "./model";

/**
 * The owner's last look before a location edit reaches visitors: each changed
 * field with its value before and after, and the audiences that read it.
 * Cancelling keeps the editor as it is; confirming sends the edit with the
 * acknowledgement the server asked for.
 */
export function VisitorChangeDialog({
  changes,
  areas,
  onCancel,
  onConfirm,
}: {
  changes: VisitorChange[];
  areas: Area[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useLocale();
  const value = (change: VisitorChange, side: "before" | "after") => {
    const id = change[side];
    // The server's area label is null for an unnamed area, which the owner reads in their own language.
    const area = change.field === "area_id" ? areas.find((candidate) => candidate.id === id) : null;
    const shown = area ? areaName(area) : change.field === "area_id" ? change[`${side}_label`] : id;
    return shown || m.owner_visitor_change_empty();
  };
  return (
    <DeleteConfirmation
      title={m.owner_visitor_change_title()}
      description={m.owner_visitor_change_description()}
      confirmLabel={m.owner_visitor_change_confirm()}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <ul className="m-0 grid list-none gap-2 p-0">
        {changes.map((change) => (
          <li key={change.field} className="grid gap-0.5 border-t border-travel-border pt-2">
            <strong>{visitorFieldLabel(change.field)}</strong>
            <span>{m.owner_visitor_change_before({ p0: value(change, "before") })}</span>
            <span>{m.owner_visitor_change_after({ p0: value(change, "after") })}</span>
            {change.field === "area_id" && (
              <span>
                {m.owner_visitor_change_carried({
                  p0: change.visits ?? 0,
                  p1: change.routes ?? 0,
                })}
              </span>
            )}
            <span>
              {m.owner_visitor_change_seen_by({
                p0: change.audiences.map(audienceName).join(", "),
              })}
            </span>
          </li>
        ))}
      </ul>
    </DeleteConfirmation>
  );
}
