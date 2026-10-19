import { Button } from "@base-ui/react/button";
import { useEffect, useMemo, useState } from "react";

import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { isResourceInUse } from "../query/api";
import { errorNotice, textNotice, useFeedback } from "../query/feedback";
import { useTripResource } from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import type { Area, Location, PlaceSearchResult, Trip } from "../tracker-model";
import { duplicateLocations } from "./merge-candidates";
import { mergedNotice, type MergeRequest } from "./MergeDialog";
import { LocationDetails } from "./locations/LocationDetails";
import { LocationForm } from "./locations/LocationForm";
import {
  addressProjection,
  blank,
  fromPlace,
  matchableLocationName,
  optional,
  recipients,
  serverFields,
  shareableAddress,
  type RecipientState,
  type Values,
} from "./locations/model";
import { useLocationMutations } from "./locations/use-location-mutations";

/** The only location detail and editor, shared by the area inventory and record-focus links. */
export function LocationManager({
  trip,
  areas,
  focusId,
  request,
  onNeedArea,
  onSaved,
}: {
  trip: Trip;
  areas: Area[];
  focusId?: DialogFocusRequest | null;
  /** Opens a location, starts a new one in an area, or (with `duplicateIds`) previews merging them into `id`. */
  request?: { id?: string; areaId?: string; duplicateIds?: string[]; token: number } | null;
  onNeedArea: () => void;
  onSaved?: () => void;
}) {
  useLocale();
  const locationsQuery = useTripResource(trip.id, "locations");
  const statusQuery = useTripResource(trip.id, "public-projection");
  const linksQuery = useTripResource(trip.id, "share-links");
  const locations = locationsQuery.data ?? [];
  const dialog = useRecordDialog(locations);
  useDialogFocus(focusId, dialog.inspect);
  const [suggestion, setSuggestion] = useState<PlaceSearchResult | null>(null);
  const [resume, setResume] = useState(false);
  const [merge, setMerge] = useState<MergeRequest | null>(null);
  // The last delete was refused because the location is still used, so merging is the way to tidy up.
  const [inUse, setInUse] = useState(false);
  const suggestions = useMemo(
    () => duplicateLocations(locations, matchableLocationName),
    [locations],
  );
  const [notice, setNotice] = useFeedback<string>("");
  const { save, remove } = useLocationMutations(trip.id);
  const record = useRecordForm<Values, Location>({
    defaultValues: blank(),
    fallback: m.owner_the_location_could_not_be_saved,
    serverFields,
    submit: (values) => {
      const fields = {
        display_name: optional(values.displayName),
        label: optional(values.label),
        address_line1: optional(values.addressLine1),
        address_line2: optional(values.addressLine2),
        locality: optional(values.locality),
        admin_area: optional(values.adminArea),
        postal_code: optional(values.postalCode),
        country_code: optional(values.countryCode)?.toUpperCase(),
        notes: optional(values.notes),
      };
      if (dialog.editingId)
        return save.mutateAsync({
          id: dialog.editingId,
          payload: { ...fields, area_id: values.areaId, share_address: values.shareAddress },
        });
      return save.mutateAsync({
        id: null,
        payload: {
          ...fields,
          area_id: values.areaId,
          ...(suggestion
            ? {
                osm_element_type: suggestion.osm_element_type,
                osm_element_id: suggestion.osm_element_id,
                latitude: suggestion.latitude,
                longitude: suggestion.longitude,
                viewport_north: suggestion.viewport_north,
                viewport_south: suggestion.viewport_south,
                viewport_east: suggestion.viewport_east,
                viewport_west: suggestion.viewport_west,
                navigation_provider: suggestion.navigation_provider,
                navigation_provider_place_id: suggestion.navigation_provider_place_id,
              }
            : {}),
        },
      });
    },
    onSuccess: (place) => {
      setSuggestion(null);
      dialog.inspect(place.id);
      setNotice(textNotice(() => m.owner_location_saved()));
      onSaved?.();
    },
  });
  function close() {
    dialog.close();
    record.load(blank());
    setSuggestion(null);
    setResume(false);
    setMerge(null);
    setInUse(false);
  }
  function create(areaId = "") {
    record.load(blank(areaId));
    setSuggestion(null);
    setNotice("");
    dialog.create();
  }
  function erase(place: Location) {
    remove.mutateAsync(place).then(
      () => {
        close();
        setNotice(textNotice(() => m.owner_location_deleted()));
        onSaved?.();
      },
      (error: unknown) => {
        dialog.setConfirmDelete(false);
        setInUse(isResourceInUse(error));
        dialog.setError(errorNotice(error, m.owner_the_location_could_not_be_deleted));
      },
    );
  }
  function edit(place: Location) {
    record.load(fromPlace(place));
    setSuggestion(null);
    setNotice("");
    dialog.edit(place.id);
  }
  useEffect(() => {
    if (!request) return;
    if (request.id) {
      dialog.inspect(request.id);
      setInUse(false);
      if (request.duplicateIds)
        setMerge({ keepId: request.id, duplicateIds: request.duplicateIds, token: request.token });
    } else if (resume) {
      record.form.setFieldValue("areaId", request.areaId ?? "");
      setResume(false);
      dialog.create();
    } else create(request.areaId);
    // A request token is the deliberate trigger; form and dialog callbacks change each render.
  }, [request?.token]);
  function choose(result: PlaceSearchResult) {
    setSuggestion(result);
    const proposed = {
      displayName: result.display_name,
      label: result.label,
      addressLine1: result.address_line1,
      addressLine2: result.address_line2,
      locality: result.locality,
      adminArea: result.admin_area,
      postalCode: result.postal_code,
      countryCode: result.country_code,
    };
    for (const [key, value] of Object.entries(proposed))
      record.form.setFieldValue(key as keyof Values, value ?? "");
  }
  const { selected, editing, editingId } = dialog;
  const addressPreview = addressProjection(record.values);
  const canShareAddress = shareableAddress(record.values);
  // dialog.error is cleared whenever the dialog moves to another record.
  const refused = inUse && Boolean(dialog.error);
  const currentRecipients = selected ? recipients(selected, statusQuery.data, linksQuery.data) : [];
  const recipientState: RecipientState =
    statusQuery.isPending || linksQuery.isPending
      ? "loading"
      : statusQuery.isError || linksQuery.isError
        ? "failed"
        : "ready";
  function addArea() {
    setResume(true);
    dialog.close();
    onNeedArea();
  }
  return (
    <>
      {resume && !editing && (
        <Button
          type="button"
          className="secondary compact"
          onClick={() => {
            setResume(false);
            dialog.create();
          }}
        >
          {m.owner_resume_location_draft()}
        </Button>
      )}
      <RecordDialog
        open={editing || selected !== null}
        title={
          editing
            ? editingId
              ? m.owner_edit_location()
              : m.owner_add_location()
            : m.owner_location()
        }
        dirty={editing && record.dirty}
        error={dialog.error}
        onDismiss={close}
      >
        {!editing && selected && (
          <LocationDetails
            trip={trip}
            selected={selected}
            areas={areas}
            locations={locations}
            suggestions={suggestions}
            recipients={currentRecipients}
            recipientState={recipientState}
            notice={notice}
            refused={refused}
            confirmDelete={dialog.confirmDelete}
            merge={merge}
            onConfirmDelete={dialog.setConfirmDelete}
            onEdit={edit}
            onErase={erase}
            onMerge={(place) => setMerge({ keepId: place.id, duplicateIds: [], token: Date.now() })}
            onMergeClose={() => setMerge(null)}
            onMerged={(keepId, merged) => {
              setMerge(null);
              setInUse(false);
              dialog.inspect(keepId);
              setNotice(mergedNotice("location", merged));
              onSaved?.();
            }}
          />
        )}
        {editing && (
          <LocationForm
            tripId={trip.id}
            record={record}
            editingId={editingId}
            selected={selected}
            suggestion={suggestion}
            areas={areas}
            addressPreview={addressPreview}
            canShareAddress={canShareAddress}
            recipients={currentRecipients}
            recipientState={recipientState}
            onAddArea={addArea}
            onChoose={choose}
          />
        )}
      </RecordDialog>
    </>
  );
}
