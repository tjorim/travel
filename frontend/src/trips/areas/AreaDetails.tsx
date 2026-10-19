import { Button } from "@base-ui/react/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { DeleteConfirmation } from "../../RecordDialog";
import type { Area, Trip } from "../../tracker-model";
import { AreaContents } from "../AreaContents";
import type { DuplicateGroup } from "../merge-candidates";
import { MergeDialog, type MergeRequest } from "../MergeDialog";
import { VisibilityControl } from "../visibility";
import { areaSummary } from "./model";
import { RecordActions } from "../RecordActions";

/** The read-only view of one area: its map point, contents, visibility, and the edit, merge and delete actions. */
export function AreaDetails({
  trip,
  selected,
  areas,
  suggestions,
  merge,
  refused,
  confirmDelete,
  onConfirmDelete,
  onEdit,
  onErase,
  onMerge,
  onMergeClose,
  onMerged,
  onOpenLocation,
}: {
  trip: Trip;
  selected: Area;
  areas: Area[];
  suggestions: DuplicateGroup[];
  merge: MergeRequest | null;
  /** The last delete was refused because the area is still used. */
  refused: boolean;
  confirmDelete: boolean;
  onConfirmDelete: (confirming: boolean) => void;
  onEdit: (area: Area) => void;
  onErase: (area: Area) => void;
  onMerge: (area: Area) => void;
  onMergeClose: () => void;
  onMerged: React.ComponentProps<typeof MergeDialog>["onMerged"];
  onOpenLocation: (locationId: string) => void;
}) {
  useLocale();
  const mergeButton = (
    <Button
      className={refused ? undefined : "secondary"}
      type="button"
      onClick={() => onMerge(selected)}
    >
      {m.owner_merge_with_other_areas()}
    </Button>
  );
  return (
    <div className="stack-form">
      <div>
        <h3>{selected.label}</h3>
        <p>{areaSummary(selected)}</p>
        {selected.latitude !== null && selected.longitude !== null && (
          <p>
            {m.owner_map_point()} {selected.latitude}, {selected.longitude}
          </p>
        )}
      </div>
      <AreaContents
        trip={trip}
        area={selected}
        onOpenLocation={(id) => {
          onOpenLocation(id);
        }}
      />
      <VisibilityControl
        tripId={trip.id}
        kind="area"
        id={selected.id}
        value={selected.visibility}
        name={selected.label}
      />
      <RecordActions onEdit={() => onEdit(selected)} onDelete={() => onConfirmDelete(true)}>
        {areas.length > 1 && !refused && mergeButton}
      </RecordActions>
      {refused && areas.length > 1 && (
        <div className="grid gap-2">
          <p>{m.owner_merge_instead_of_deleting_area()}</p>
          <div className="button-row">{mergeButton}</div>
        </div>
      )}
      <MergeDialog
        trip={trip}
        kind="area"
        records={areas.map((area) => ({
          id: area.id,
          name: area.label,
          detail: areaSummary(area),
        }))}
        suggestions={suggestions}
        request={merge}
        onClose={onMergeClose}
        onMerged={onMerged}
      />
      {confirmDelete && (
        <DeleteConfirmation
          title={m.owner_delete_area({ p0: selected.label })}
          description={m.owner_this_is_only_possible_when_the_area_is_no_longer_used_by_a_visit_travel()}
          onCancel={() => onConfirmDelete(false)}
          onConfirm={() => onErase(selected)}
        />
      )}
    </div>
  );
}
