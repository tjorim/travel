import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useFeedback, textNotice, errorNotice } from "../query/feedback";
import { Button } from "@base-ui/react/button";
import { useState } from "react";

import { RecordForm, requiredText, TextField, TimeZoneField } from "../forms/fields";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { type Area, type PlaceSearchResult, type Trip } from "../tracker-model";
import { VisibilityControl, visibilityLabel } from "./visibility";
import { PlaceSearchField } from "./PlaceSearchField";
import { AreaContents } from "./AreaContents";
import { LocationManager, ownerLocationName } from "./LocationManager";

type Values = {
  label: string;
  countryCode: string;
  region: string;
  latitude: string;
  longitude: string;
  timezone: string;
};
const blank = (): Values => ({ label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" });
const fromArea = (area: Area): Values => ({
  label: area.label,
  countryCode: area.country_code ?? "",
  region: area.region ?? "",
  latitude: area.latitude?.toString() ?? "",
  longitude: area.longitude?.toString() ?? "",
  timezone: area.timezone ?? "",
});
const serverFields = {
  label: "label",
  country_code: "countryCode",
  region: "region",
  latitude: "latitude",
  longitude: "longitude",
  timezone: "timezone",
};

const bothCoordinates = ({
  value,
  fieldApi,
}: {
  value: string;
  fieldApi: { form: { getFieldValue: (name: never) => unknown } };
}) =>
  (value === "") !== (String(fieldApi.form.getFieldValue("longitude" as never) ?? "") === "")
    ? m.owner_enter_both_map_coordinates_or_leave_both_empty
    : undefined;
const withinRange =
  (min: number, max: number, name: () => string) =>
  ({ value }: { value: string }) =>
    value !== "" && !(Number(value) >= min && Number(value) <= max)
      ? () => m.owner_must_be_between_and_degrees({ p0: name(), p1: min, p2: max })
      : undefined;
const latitudeRange = withinRange(-90, 90, m.owner_latitude);
const longitudeRange = withinRange(-180, 180, m.owner_longitude);
const knownTimeZone = ({ value }: { value: string }) => {
  if (!value.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.trim() });
    return undefined;
  } catch {
    return m.owner_unknown_time_zone_choose_one_from_the_suggestions;
  }
};
const areaCoordinate = (value: number) => (Math.round(value * 100) / 100).toString();

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
  const [locationRequest, setLocationRequest] = useState<{ id?: string; areaId?: string; token: number } | null>(null);
  const [resumeLocation, setResumeLocation] = useState(false);
  const requestLocation = (id?: string, areaId?: string) =>
    setLocationRequest({ id, areaId, token: Date.now() + Math.random() });
  const dialog = useRecordDialog(areas);
  useDialogFocus(focusId, dialog.inspect);
  const [message, setMessage] = useFeedback<string>(
    textNotice(() => m.owner_an_area_is_a_city_or_region_without_an_address_it_is_not_automatically_p()),
  );

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, Area>({
    fallback: m.owner_the_area_could_not_be_saved,
    request: ({ id, payload }) => ({
      path: id ? `${tripPath(trip.id, "areas")}/${id}` : tripPath(trip.id, "areas"),
      method: id ? "PATCH" : "POST",
      body: payload,
    }),
    // Visits, stays and reisupdates embed the area, so the trip is refreshed with it.
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "areas"), ownerKeys.trips(subject)],
  });
  const remove = useOwnerMutation<Area>({
    fallback: m.owner_the_area_could_not_be_deleted,
    request: (area) => ({ path: `${tripPath(trip.id, "areas")}/${area.id}`, method: "DELETE" }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "areas"), ownerKeys.trips(subject)],
  });

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
      setMessage(textNotice(() => m.owner_area_saved_you_can_deliberately_link_it_to_a_visit_travel_update_or_stay()));
      if (resumeLocation) {
        setResumeLocation(false);
        requestLocation(undefined, area.id);
      }
    },
  });

  function close() {
    dialog.close();
    record.load(blank());
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
        dialog.setError(errorNotice(error, m.owner_the_area_could_not_be_deleted));
      },
    );
  }
  function useSearchResult(result: PlaceSearchResult) {
    record.form.setFieldValue("label", result.locality ?? result.admin_area ?? result.display_name ?? "");
    record.form.setFieldValue("countryCode", result.country_code ?? "");
    record.form.setFieldValue("region", result.admin_area ?? "");
    // A Nominatim result can be a precise POI. Areas deliberately use a
    // roughly kilometre-sized map point; the owner can still edit every field.
    record.form.setFieldValue("latitude", typeof result.latitude === "number" ? areaCoordinate(result.latitude) : "");
    record.form.setFieldValue(
      "longitude",
      typeof result.longitude === "number" ? areaCoordinate(result.longitude) : "",
    );
  }

  const summary = (area: Area) =>
    [area.region, area.country_code, area.timezone].filter(Boolean).join(" · ") || m.owner_only_for_this_trip();
  const { selected, editing, editingId } = dialog;

  return (
    <section className="travel-card manager" id="areas" aria-labelledby="areas-title">
      <span id="locations" />
      <div className="capture-heading">
        <div>
          <h3 id="areas-title">{m.owner_areas_and_locations()}</h3>
          <p>{m.owner_a_city_or_region_you_can_reuse_locations_stays_travel_updates_and_transp()}</p>
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
        {areasQuery.error ? errorMessage(areasQuery.error, m.owner_your_areas_could_not_be_loaded) : message}
      </p>
      {locationsQuery.error && (
        <p role="status">{errorMessage(locationsQuery.error, m.owner_your_locations_could_not_be_loaded)}</p>
      )}
      {locationsQuery.isPending && <p role="status">{m.owner_loading_locations()}</p>}
      {areas.length ? (
        <div className="saved-records mt-0.5">
          {areas.map((area) => (
            <article
              className="grid gap-2.5 rounded-xl border border-travel-divider bg-travel-surface p-4"
              key={area.id}
            >
              <div className="capture-heading m-0 items-center max-[620px]:flex-col max-[620px]:items-stretch">
                <Button
                  className="document-select"
                  type="button"
                  onClick={() => dialog.inspect(area.id)}
                  aria-label={m.owner_view_area({ p0: area.label })}
                >
                  <strong>{area.label}</strong>
                  <span>
                    {summary(area)} · {visibilityLabel(area.visibility)}
                  </span>
                </Button>
                <Button className="secondary compact" type="button" onClick={() => requestLocation(undefined, area.id)}>
                  {m.owner_add_location()}
                </Button>
              </div>
              {!locationsQuery.isPending && !locationsQuery.error && (
                <div className="saved-records ml-4 border-l-2 border-travel-divider pl-4 max-[620px]:ml-1 max-[620px]:pl-3">
                  {locations
                    .filter((place) => place.area_id === area.id)
                    .map((place) => (
                      <Button
                        className="document-select"
                        key={place.id}
                        type="button"
                        onClick={() => requestLocation(place.id)}
                      >
                        <strong>{ownerLocationName(place)}</strong>
                        <span>
                          {[place.address_line1, place.locality, place.country_code, visibilityLabel(place.visibility)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </Button>
                    ))}
                  {!locations.some((place) => place.area_id === area.id) && (
                    <p className="help">{m.owner_no_locations_in_this_area_yet()}</p>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
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
          <div className="stack-form">
            <div>
              <h3>{selected.label}</h3>
              <p>{summary(selected)}</p>
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
                dialog.close();
                requestLocation(id);
              }}
            />
            <VisibilityControl
              tripId={trip.id}
              kind="area"
              id={selected.id}
              value={selected.visibility}
              name={selected.label}
            />
            <div className="button-row">
              <Button type="button" onClick={() => edit(selected)}>
                {m.owner_edit()}
              </Button>
              <Button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>
                {m.owner_delete()}
              </Button>
            </div>
            {dialog.confirmDelete && (
              <DeleteConfirmation
                title={m.owner_delete_area({ p0: selected.label })}
                description={m.owner_this_is_only_possible_when_the_area_is_no_longer_used_by_a_visit_travel()}
                onCancel={() => dialog.setConfirmDelete(false)}
                onConfirm={() => erase(selected)}
              />
            )}
          </div>
        )}
        {editing && (
          <RecordForm record={record} submitLabel={m.owner_save_area()} pendingLabel={m.owner_saving()}>
            <PlaceSearchField
              tripId={trip.id}
              legend={m.owner_search_city_or_region()}
              inputLabel={m.owner_search_for_a_city_or_region()}
              placeholder={m.owner_for_example_taipei()}
              help={m.owner_use_this_for_a_city_or_region_a_result_is_only_stored_when_you_save_and()}
              onSelect={useSearchResult}
            />
            <div className="field-row">
              <record.form.Field
                name="label"
                validators={{
                  onChange: requiredText(m.owner_give_the_area_a_name),
                  onSubmit: requiredText(m.owner_give_the_area_a_name),
                }}
              >
                {(field) => <TextField field={field} label={m.owner_name()} required maxLength={120} />}
              </record.form.Field>
              <record.form.Field name="countryCode">
                {(field) => <TextField field={field} label={m.owner_country_code()} optional maxLength={2} />}
              </record.form.Field>
            </div>
            <div className="field-row">
              <record.form.Field name="region">
                {(field) => <TextField field={field} label={m.owner_region()} optional maxLength={120} />}
              </record.form.Field>
              <record.form.Field name="timezone" validators={{ onBlur: knownTimeZone, onSubmit: knownTimeZone }}>
                {(field) => (
                  <TimeZoneField
                    field={field}
                    label={m.owner_time_zone()}
                    optional={m.owner_optional_private()}
                    maxLength={64}
                  />
                )}
              </record.form.Field>
            </div>
            <div className="field-row">
              <record.form.Field
                name="latitude"
                validators={{
                  onChangeListenTo: ["longitude"],
                  onChange: (props) => bothCoordinates(props) ?? latitudeRange(props),
                  onSubmit: (props) => bothCoordinates(props) ?? latitudeRange(props),
                }}
              >
                {(field) => (
                  <TextField
                    field={field}
                    label={m.owner_latitude_2()}
                    optional
                    type="number"
                    min={-90}
                    max={90}
                    step="any"
                  />
                )}
              </record.form.Field>
              <record.form.Field name="longitude" validators={{ onChange: longitudeRange, onSubmit: longitudeRange }}>
                {(field) => (
                  <TextField
                    field={field}
                    label={m.owner_longitude_2()}
                    optional
                    type="number"
                    min={-180}
                    max={180}
                    step="any"
                  />
                )}
              </record.form.Field>
            </div>
          </RecordForm>
        )}
      </RecordDialog>
    </section>
  );
}
