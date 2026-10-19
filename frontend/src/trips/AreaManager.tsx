import { Button } from "@base-ui/react/button";
import { useMemo, useState } from "react";

import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorMessage, isResourceInUse } from "../query/api";
import { errorNotice, textNotice, useFeedback } from "../query/feedback";
import { useTripResource } from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import { ownerLocationName, type Area, type Trip } from "../tracker-model";
import { AreaDetails } from "./areas/AreaDetails";
import { AreaForm } from "./areas/AreaForm";
import { AreaInventory } from "./areas/AreaInventory";
import { DuplicateSuggestions } from "./areas/DuplicateSuggestions";
import { blank, fromArea, serverFields, type Values } from "./areas/model";
import { useAreaMutations } from "./areas/use-area-mutations";
import { LocationManager } from "./LocationManager";
import { matchableLocationName } from "./locations/model";
import { duplicateAreas, duplicateLocations } from "./merge-candidates";
import { mergedNotice, type MergeRequest } from "./MergeDialog";

export function AreaManager({
  trip,
  focusId,
  locationFocusId,
}: {
  trip: Trip;
  focusId?: DialogFocusRequest | null;
  locationFocusId?: DialogFocusRequest | null;
}) {
  useLocale();
  const areasQuery = useTripResource(trip.id, "areas");
  const areas = areasQuery.data ?? [];
  const locationsQuery = useTripResource(trip.id, "locations");
  const locations = locationsQuery.data ?? [];
  const [locationRequest, setLocationRequest] = useState<{
    id?: string;
    areaId?: string;
    duplicateIds?: string[];
    token: number;
  } | null>(null);
  const [resumeLocation, setResumeLocation] = useState(false);
  const requestLocation = (id?: string, areaId?: string, duplicateIds?: string[]) =>
    setLocationRequest({ id, areaId, duplicateIds, token: Date.now() + Math.random() });
  const [merge, setMerge] = useState<MergeRequest | null>(null);
  // The last delete was refused because the area is still used, so merging is the way to tidy up.
  const [inUse, setInUse] = useState(false);
  const duplicateAreaGroups = useMemo(() => duplicateAreas(areas), [areas]);
  const duplicateLocationGroups = useMemo(
    () => duplicateLocations(locations, matchableLocationName),
    [locations],
  );
  const dialog = useRecordDialog(areas);
  useDialogFocus(focusId, dialog.inspect);
  const [message, setMessage] = useFeedback<string>(
    textNotice(() =>
      m.owner_an_area_is_a_city_or_region_without_an_address_it_is_not_automatically_p(),
    ),
  );

  const { save, remove } = useAreaMutations(trip.id);

  const record = useRecordForm<Values, Area>({
    defaultValues: blank(),
    fallback: m.owner_the_area_could_not_be_saved,
    serverFields,
    submit: async (values) => {
      return save.mutateAsync({
        id: dialog.editingId ?? null,
        payload: {
          label: values.label.trim(),
          country_code: values.countryCode.trim().toUpperCase() || null,
          region: values.region.trim() || null,
          latitude: values.latitude === "" ? null : Number(values.latitude),
          longitude: values.longitude === "" ? null : Number(values.longitude),
          timezone: values.timezone.trim() || null,
        },
      });
    },
    onSuccess: (area) => {
      close();
      setMessage(
        textNotice(() =>
          m.owner_area_saved_you_can_deliberately_link_it_to_a_visit_travel_update_or_stay(),
        ),
      );
      if (resumeLocation) {
        setResumeLocation(false);
        requestLocation(undefined, area.id);
      }
    },
  });

  function close() {
    dialog.close();
    record.load(blank());
    setMerge(null);
    setInUse(false);
  }
  function create() {
    record.load(blank());
    dialog.create();
  }
  function edit(area: Area) {
    record.load(fromArea(area));
    dialog.edit(area.id);
  }
  function erase(area: Area) {
    remove.mutateAsync(area).then(
      () => {
        close();
        setMessage(textNotice(() => m.owner_area_deleted()));
      },
      (error: unknown) => {
        dialog.setConfirmDelete(false);
        setInUse(isResourceInUse(error));
        dialog.setError(errorNotice(error, m.owner_the_area_could_not_be_deleted));
      },
    );
  }
  const { selected, editing, editingId } = dialog;
  // dialog.error is cleared whenever the dialog moves to another record.
  const refused = inUse && Boolean(dialog.error);
  return (
    <section className="travel-card manager" aria-labelledby="areas-title">
      <span id="locations" />
      <div className="capture-heading">
        <div>
          <h3 id="areas-title">{m.owner_areas_and_locations()}</h3>
          <p>
            {m.owner_a_city_or_region_you_can_reuse_locations_stays_travel_updates_and_transp()}
          </p>
        </div>
        <div className="button-row">
          <Button className="secondary compact" type="button" onClick={create}>
            {m.owner_add_area()}
          </Button>
          <Button className="secondary compact" type="button" onClick={() => requestLocation()}>
            {m.owner_add_location()}
          </Button>
        </div>
      </div>
      <p className="help" role="status">
        {areasQuery.error
          ? errorMessage(areasQuery.error, m.owner_your_areas_could_not_be_loaded)
          : message}
      </p>
      {locationsQuery.error && (
        <p role="status">
          {errorMessage(locationsQuery.error, m.owner_your_locations_could_not_be_loaded)}
        </p>
      )}
      {locationsQuery.isPending && <p role="status">{m.owner_loading_locations()}</p>}
      <DuplicateSuggestions
        title={m.owner_possible_duplicate_areas()}
        groups={duplicateAreaGroups}
        nameOf={(id) => areas.find((area) => area.id === id)?.label ?? ""}
        onReview={({ ids: [keepId, ...duplicateIds] }) => {
          dialog.inspect(keepId);
          setInUse(false);
          setMerge({ keepId, duplicateIds, token: Date.now() });
        }}
      />
      <DuplicateSuggestions
        title={m.owner_possible_duplicate_locations()}
        groups={duplicateLocationGroups}
        nameOf={(id) => {
          const place = locations.find((candidate) => candidate.id === id);
          return place ? ownerLocationName(place) : "";
        }}
        onReview={({ ids: [keepId, ...duplicateIds] }) =>
          requestLocation(keepId, undefined, duplicateIds)
        }
      />
      {areas.length ? (
        <AreaInventory
          areas={areas}
          locations={locations}
          locationsReady={!locationsQuery.isPending && !locationsQuery.error}
          onInspect={dialog.inspect}
          onAddLocation={(areaId) => requestLocation(undefined, areaId)}
          onOpenLocation={(id) => requestLocation(id)}
        />
      ) : (
        !areasQuery.isPending &&
        !areasQuery.error && <p>{m.owner_no_areas_yet_add_an_area_to_keep_locations_in_it()}</p>
      )}
      <LocationManager
        trip={trip}
        areas={areas}
        focusId={locationFocusId}
        request={locationRequest}
        onNeedArea={() => {
          setResumeLocation(true);
          create();
        }}
      />
      <RecordDialog
        open={editing || selected !== null}
        title={editing ? (editingId ? m.owner_edit_area() : m.owner_add_area()) : m.owner_area()}
        dirty={editing && record.dirty}
        error={dialog.error}
        onDismiss={() => {
          close();
          setResumeLocation(false);
        }}
      >
        {!editing && selected && (
          <AreaDetails
            trip={trip}
            selected={selected}
            areas={areas}
            suggestions={duplicateAreaGroups}
            merge={merge}
            refused={refused}
            confirmDelete={dialog.confirmDelete}
            onConfirmDelete={dialog.setConfirmDelete}
            onEdit={edit}
            onErase={erase}
            onMerge={(area) => setMerge({ keepId: area.id, duplicateIds: [], token: Date.now() })}
            onMergeClose={() => setMerge(null)}
            onMerged={(_keepId, merged) => {
              close();
              setMessage(mergedNotice("area", merged));
            }}
            onOpenLocation={(id) => {
              dialog.close();
              requestLocation(id);
            }}
          />
        )}
        {editing && <AreaForm tripId={trip.id} record={record} />}
      </RecordDialog>
    </section>
  );
}
