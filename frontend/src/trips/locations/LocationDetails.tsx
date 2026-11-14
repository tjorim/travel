import { Button } from "@/ui/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { DeleteConfirmation } from "../../RecordDialog";
import { ownerLocationName } from "../../records";
import { type Area, type Location, type Trip } from "../../api-types";
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
      {m.locations_merge_with_other_locations()}
    </Button>
  );
  return (
    <div className="stack-form">
      <div>
        <h3>{ownerLocationName(selected)}</h3>
        <p>
          {m.locations_your_name()} {selected.display_name || m.locations_no_name_of_your_own()}
        </p>
        <p>
          {m.locations_area_detail()}{" "}
          {areas.find((area) => area.id === selected.area_id)?.label ?? m.common_unknown_area()} ·{" "}
          {visibilityLabel(selected.visibility)}
        </p>
        <p>
          {m.locations_public_name()} {selected.label || m.locations_no_public_name_yet()}
        </p>
        <p>
          {m.locations_saved_address()} {address(selected) || m.locations_no_address_captured()}
          {address(selected) && selected.country_code ? `, ${selected.country_code}` : ""}
        </p>
        {!address(selected) && selected.country_code && (
          <p>
            {m.locations_country_code_detail()} {selected.country_code}
          </p>
        )}
        {selected.notes && (
          <p>
            {m.locations_private_notes()} {selected.notes}
          </p>
        )}
        <MapTarget latitude={selected.latitude} longitude={selected.longitude} />
        {selected.osm_url && (
          <p className="help">
            {m.locations_provider_location()}{" "}
            <a href={selected.osm_url} target="_blank" rel="noreferrer">
              {selected.osm_element_type} {selected.osm_element_id}
            </a>
            {m.locations_address_correction_suffix()}
          </p>
        )}
        <p>
          <RecipientsText
            state={recipientState}
            recipients={recipients}
            reaches={(names) => m.locations_currently_reaches({ audiences: names })}
            reachesNobody={m.locations_this_location_currently_reaches_no_visitors}
          />{" "}
          {m.locations_address_sharing_scope_hint()}
        </p>
        <p>
          {selected.share_address
            ? m.locations_address_sharing_is_on()
            : m.locations_address_sharing_is_off()}{" "}
          {shareableAddress(selected)
            ? m.locations_address_shown_to_visitors({
                address: projectionText(addressProjection(selected)),
              })
            : m.locations_no_shareable_address()}{" "}
          {m.locations_your_name_and_private_notes_are_not_shown()}
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
          <p>{m.locations_merge_instead_of_deleting_location()}</p>
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
          title={m.locations_delete_location({ name: ownerLocationName(selected) })}
          description={m.locations_delete_blocked_hint()}
          onCancel={() => onConfirmDelete(false)}
          onConfirm={() => onErase(selected)}
        />
      )}
    </div>
  );
}
