import { Button } from "@/ui/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { DeleteConfirmation } from "../../RecordDialog";
import { ownerLocationName, type Area, type Location, type Trip } from "../../tracker-model";
import { MergeDialog, type MergeRequest } from "../MergeDialog";
import { VisibilityControl, visibilityLabel } from "../visibility";
import { MapTarget } from "./MapTarget";
import {
  address,
  addressProjection,
  projectionText,
  shareableAddress,
  type RecipientState,
} from "./model";
import { RecordActions } from "../RecordActions";
import { RecipientsText } from "./RecipientsText";

/** The read-only view of one location: what is saved, who it reaches, and its visibility, merge and delete actions. */
export function LocationDetails({
  trip,
  selected,
  areas,
  locations,
  suggestions,
  recipients,
  recipientState,
  notice,
  refused,
  confirmDelete,
  merge,
  onConfirmDelete,
  onEdit,
  onErase,
  onMerge,
  onMergeClose,
  onMerged,
}: {
  trip: Trip;
  selected: Location;
  areas: Area[];
  locations: Location[];
  suggestions: React.ComponentProps<typeof MergeDialog>["suggestions"];
  recipients: string[];
  recipientState: RecipientState;
  notice: string;
  /** The last delete was refused because the location is still used. */
  refused: boolean;
  confirmDelete: boolean;
  merge: MergeRequest | null;
  onConfirmDelete: (confirming: boolean) => void;
  onEdit: (place: Location) => void;
  onErase: (place: Location) => void;
  onMerge: (place: Location) => void;
  onMergeClose: () => void;
  onMerged: React.ComponentProps<typeof MergeDialog>["onMerged"];
}) {
  useLocale();
  const areaLabel = (id: string) => areas.find((area) => area.id === id)?.label;
  const mergeButton = (
    <Button
      className={refused ? undefined : "secondary"}
      type="button"
      onClick={() => onMerge(selected)}
    >
      {m.owner_merge_with_other_locations()}
    </Button>
  );
  return (
    <div className="stack-form">
      <div>
        <h3>{ownerLocationName(selected)}</h3>
        <p>
          {m.owner_your_name()} {selected.display_name || m.owner_no_name_of_your_own()}
        </p>
        <p>
          {m.owner_area_2()}{" "}
          {areas.find((area) => area.id === selected.area_id)?.label ?? m.owner_unknown_area()} ·{" "}
          {visibilityLabel(selected.visibility)}
        </p>
        <p>
          {m.owner_public_name()} {selected.label || m.owner_no_public_name_yet()}
        </p>
        <p>
          {m.owner_saved_address()} {address(selected) || m.owner_no_address_captured()}
          {address(selected) && selected.country_code ? `, ${selected.country_code}` : ""}
        </p>
        {!address(selected) && selected.country_code && (
          <p>
            {m.owner_country_code_2()} {selected.country_code}
          </p>
        )}
        {selected.notes && (
          <p>
            {m.owner_private_notes()} {selected.notes}
          </p>
        )}
        <MapTarget latitude={selected.latitude} longitude={selected.longitude} />
        {selected.osm_url && (
          <p className="help">
            {m.owner_provider_location()}{" "}
            <a href={selected.osm_url} target="_blank" rel="noreferrer">
              {selected.osm_element_type} {selected.osm_element_id}
            </a>
            {m.owner_correcting_the_address_does_not_move_this_map_point_or_navigation_target()}
          </p>
        )}
        <p>
          <RecipientsText
            state={recipientState}
            recipients={recipients}
            reaches={(names) => m.owner_currently_reaches({ p0: names })}
            reachesNobody={m.owner_this_location_currently_reaches_no_visitors}
          />{" "}
          {m.owner_sharing_the_address_does_not_change_visibility_or_recipients()}
        </p>
        <p>
          {selected.share_address
            ? m.owner_address_sharing_is_on()
            : m.owner_address_sharing_is_off()}{" "}
          {shareableAddress(selected)
            ? m.owner_address_shown_to_visitors_when_address_sharing_is_on_and_this_location_r({
                p0: projectionText(addressProjection(selected)),
              })
            : m.owner_no_shareable_address()}{" "}
          {m.owner_your_name_and_private_notes_are_not_shown()}
        </p>
      </div>
      <VisibilityControl
        tripId={trip.id}
        kind="location"
        id={selected.id}
        value={selected.visibility}
        name={ownerLocationName(selected)}
      />
      {notice && <p role="status">{notice}</p>}
      <RecordActions onEdit={() => onEdit(selected)} onDelete={() => onConfirmDelete(true)}>
        {locations.length > 1 && !refused && mergeButton}
      </RecordActions>
      {refused && locations.length > 1 && (
        <div className="grid gap-2">
          <p>{m.owner_merge_instead_of_deleting_location()}</p>
          <div className="button-row">{mergeButton}</div>
        </div>
      )}
      <MergeDialog
        trip={trip}
        kind="location"
        records={locations.map((place) => ({
          id: place.id,
          name: ownerLocationName(place),
          detail: [place.address_line1, place.locality, areaLabel(place.area_id)]
            .filter(Boolean)
            .join(" · "),
          areaId: place.area_id,
        }))}
        areas={areas}
        suggestions={suggestions}
        request={merge}
        onClose={onMergeClose}
        onMerged={onMerged}
      />
      {confirmDelete && (
        <DeleteConfirmation
          title={m.owner_delete_location({ p0: ownerLocationName(selected) })}
          description={m.owner_this_is_only_possible_when_the_location_is_no_longer_used_by_a_visit_sta()}
          onCancel={() => onConfirmDelete(false)}
          onConfirm={() => onErase(selected)}
        />
      )}
    </div>
  );
}
