import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useFeedback, textNotice, errorNotice } from "../query/feedback";
import { Button } from "@base-ui/react/button";
import { useEffect, useMemo, useState } from "react";

import { CheckboxField, RecordForm, requiredText, SelectField, TextAreaField, TextField } from "../forms/fields";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { isResourceInUse } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";

import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import {
  locationName,
  type Area,
  type Location,
  type PlaceSearchResult,
  type PublicProjectionStatus,
  type ShareLink,
  type Trip,
} from "../tracker-model";
import { duplicateLocations } from "./merge-candidates";
import { MergeDialog, mergedNotice, type MergeRequest } from "./MergeDialog";
import { PlaceSearchField } from "./PlaceSearchField";
import { VisibilityControl, visibilityLabel } from "./visibility";

type Values = {
  areaId: string;
  displayName: string;
  label: string;
  addressLine1: string;
  addressLine2: string;
  locality: string;
  adminArea: string;
  postalCode: string;
  countryCode: string;
  notes: string;
  shareAddress: boolean;
};
const blank = (areaId = ""): Values => ({
  areaId,
  displayName: "",
  label: "",
  addressLine1: "",
  addressLine2: "",
  locality: "",
  adminArea: "",
  postalCode: "",
  countryCode: "",
  notes: "",
  shareAddress: false,
});
const fromPlace = (place: Location): Values => ({
  areaId: place.area_id,
  displayName: place.display_name ?? "",
  label: place.label ?? "",
  addressLine1: place.address_line1 ?? "",
  addressLine2: place.address_line2 ?? "",
  locality: place.locality ?? "",
  adminArea: place.admin_area ?? "",
  postalCode: place.postal_code ?? "",
  countryCode: place.country_code ?? "",
  notes: place.notes ?? "",
  shareAddress: place.share_address,
});
const addressFields = (value: Values | Location) =>
  "addressLine1" in value
    ? [value.addressLine1, value.addressLine2, value.postalCode, value.locality, value.adminArea]
    : [value.address_line1, value.address_line2, value.postal_code, value.locality, value.admin_area];
const address = (value: Values | Location) => addressFields(value).filter(Boolean).join(", ");
const shareableAddress = (value: Values | Location) => addressFields(value).some(Boolean);
const addressProjection = (value: Values | Location) => {
  const fields =
    "addressLine1" in value
      ? {
          line1: value.addressLine1,
          line2: value.addressLine2,
          postal_code: value.postalCode,
          locality: value.locality,
          admin_area: value.adminArea,
        }
      : {
          line1: value.address_line1,
          line2: value.address_line2,
          postal_code: value.postal_code,
          locality: value.locality,
          admin_area: value.admin_area,
        };
  return Object.fromEntries(Object.entries(fields).filter(([, field]) => field?.trim()));
};
const PROJECTION_LABELS: Record<string, () => string> = {
  line1: m.owner_address_line_1,
  line2: m.owner_address_line_2,
  postal_code: m.owner_postal_code,
  locality: m.owner_city,
  admin_area: m.owner_region,
};
/** The address field visitors would receive, as words rather than the API's JSON. */
const projectionText = (projection: Record<string, string | null | undefined>) =>
  Object.entries(projection)
    .map(([key, field]) => `${PROJECTION_LABELS[key]?.() ?? key}: ${field?.trim()}`)
    .join("; ");
function recipients(
  place: Location,
  status: PublicProjectionStatus | undefined,
  links: ShareLink[] | undefined,
): string[] {
  if (place.visibility === "private") return [];
  const included = (scope: PublicProjectionStatus["scope"]) =>
    place.visibility === "everyone" || scope.items?.some((item) => item.kind === "location" && item.id === place.id);
  const now = Date.now();
  return [
    ...(status?.surface_state === "published" && included(status.scope) ? [m.owner_public_page()] : []),
    ...(links ?? [])
      .filter(
        (link) =>
          link.state === "active" && (!link.expires_at || Date.parse(link.expires_at) > now) && included(link.scope),
      )
      .map((link) => m.owner_share_link({ p0: link.label })),
  ];
}
function mapTarget(latitude: number | null | undefined, longitude: number | null | undefined) {
  if (latitude == null || longitude == null) return null;
  return (
    <p className="help">
      {m.owner_saved_map_point_and_navigation_target()} {latitude}, {longitude} ·{" "}
      <a
        href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`}
        target="_blank"
        rel="noreferrer"
      >
        {m.owner_view_on_map()}
      </a>
    </p>
  );
}
export const ownerLocationName = (place: Location) => place.display_name?.split(",")[0]?.trim() || locationName(place);
/** The name two locations are compared by; an unnamed location has none, so it never matches by name. */
export const matchableLocationName = (place: Location) =>
  place.display_name || place.label || place.locality ? ownerLocationName(place) : "";
const optional = (value: string) => value.trim() || null;
const serverFields = {
  area_id: "areaId",
  display_name: "displayName",
  label: "label",
  address_line1: "addressLine1",
  address_line2: "addressLine2",
  locality: "locality",
  admin_area: "adminArea",
  postal_code: "postalCode",
  country_code: "countryCode",
  notes: "notes",
};

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
  const suggestions = useMemo(() => duplicateLocations(locations, matchableLocationName), [locations]);
  const [notice, setNotice] = useFeedback<string>("");
  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, Location>({
    fallback: m.owner_the_location_could_not_be_saved,
    request: ({ id, payload }) => ({
      path: id ? `${tripPath(trip.id, "locations")}/${id}` : tripPath(trip.id, "locations"),
      method: id ? "PATCH" : "POST",
      body: payload,
    }),
    invalidate: (subject) => [ownerKeys.trip(subject, trip.id), ownerKeys.trips(subject)],
  });
  const remove = useOwnerMutation<Location>({
    fallback: m.owner_the_location_could_not_be_deleted,
    request: (place) => ({ path: `${tripPath(trip.id, "locations")}/${place.id}`, method: "DELETE" }),
    invalidate: (subject) => [ownerKeys.trip(subject, trip.id), ownerKeys.trips(subject)],
  });
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
    for (const [key, value] of Object.entries(proposed)) record.form.setFieldValue(key as keyof Values, value ?? "");
  }
  const { selected, editing, editingId } = dialog;
  const addressPreview = addressProjection(record.values);
  const canShareAddress = shareableAddress(record.values);
  // dialog.error is cleared whenever the dialog moves to another record.
  const refused = inUse && Boolean(dialog.error);
  const areaLabel = (id: string) => areas.find((area) => area.id === id)?.label;
  const mergeButton = (
    <Button
      className={refused ? undefined : "secondary"}
      type="button"
      onClick={() => selected && setMerge({ keepId: selected.id, duplicateIds: [], token: Date.now() })}
    >
      {m.owner_merge_with_other_locations()}
    </Button>
  );
  const currentRecipients = selected ? recipients(selected, statusQuery.data, linksQuery.data) : [];
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
        title={editing ? (editingId ? m.owner_edit_location() : m.owner_add_location()) : m.owner_location()}
        dirty={editing && record.dirty}
        error={dialog.error}
        onDismiss={close}
      >
        {!editing && selected && (
          <div className="stack-form">
            <div>
              <h3>{ownerLocationName(selected)}</h3>
              <p>
                {m.owner_your_name()} {selected.display_name || m.owner_no_name_of_your_own()}
              </p>
              <p>
                {m.owner_area_2()} {areas.find((area) => area.id === selected.area_id)?.label ?? m.owner_unknown_area()}{" "}
                · {visibilityLabel(selected.visibility)}
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
              {mapTarget(selected.latitude, selected.longitude)}
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
                {statusQuery.isPending || linksQuery.isPending
                  ? m.owner_loading_recipients()
                  : statusQuery.isError || linksQuery.isError
                    ? m.owner_recipients_could_not_be_checked()
                    : currentRecipients.length
                      ? m.owner_currently_reaches({ p0: currentRecipients.join(", ") })
                      : m.owner_this_location_currently_reaches_no_visitors()}{" "}
                {m.owner_sharing_the_address_does_not_change_visibility_or_recipients()}
              </p>
              <p>
                {selected.share_address ? m.owner_address_sharing_is_on() : m.owner_address_sharing_is_off()}{" "}
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
            <div className="button-row">
              <Button type="button" onClick={() => edit(selected)}>
                {m.owner_edit()}
              </Button>
              {locations.length > 1 && !refused && mergeButton}
              <Button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>
                {m.owner_delete()}
              </Button>
            </div>
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
                detail: [place.address_line1, place.locality, areaLabel(place.area_id)].filter(Boolean).join(" · "),
                areaId: place.area_id,
              }))}
              areas={areas}
              suggestions={suggestions}
              request={merge}
              onClose={() => setMerge(null)}
              onMerged={(keepId, merged) => {
                setMerge(null);
                setInUse(false);
                dialog.inspect(keepId);
                setNotice(mergedNotice("location", merged));
                onSaved?.();
              }}
            />
            {dialog.confirmDelete && (
              <DeleteConfirmation
                title={m.owner_delete_location({ p0: ownerLocationName(selected) })}
                description={m.owner_this_is_only_possible_when_the_location_is_no_longer_used_by_a_visit_sta()}
                onCancel={() => dialog.setConfirmDelete(false)}
                onConfirm={() => erase(selected)}
              />
            )}
          </div>
        )}
        {editing && (
          <RecordForm
            record={record}
            submitLabel={m.owner_save_location()}
            pendingLabel={m.owner_saving()}
            disabled={
              !record.values.areaId ||
              (record.values.shareAddress && !canShareAddress) ||
              (!editingId &&
                !record.values.displayName.trim() &&
                !record.values.addressLine1.trim() &&
                !record.values.locality.trim())
            }
          >
            {!areas.length && <p>{m.owner_create_an_area_first_your_location_draft_is_kept()}</p>}
            {!areas.length && (
              <Button
                type="button"
                className="secondary"
                onClick={() => {
                  setResume(true);
                  dialog.close();
                  onNeedArea();
                }}
              >
                {m.owner_add_area()}
              </Button>
            )}
            <record.form.Field
              name="areaId"
              validators={{
                onChange: requiredText(m.owner_choose_an_area),
                onSubmit: requiredText(m.owner_choose_an_area),
              }}
            >
              {(field) => (
                <SelectField field={field} label={m.owner_area()}>
                  <option value="">{m.owner_choose_an_area_2()}</option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.label}
                    </option>
                  ))}
                </SelectField>
              )}
            </record.form.Field>
            {areas.length > 0 && (
              <Button
                type="button"
                className="secondary compact"
                onClick={() => {
                  setResume(true);
                  dialog.close();
                  onNeedArea();
                }}
              >
                {m.owner_add_new_area()}
              </Button>
            )}
            {!editingId && (
              <PlaceSearchField
                tripId={trip.id}
                legend={m.owner_search_location()}
                inputLabel={m.owner_search_via_openstreetmap()}
                placeholder={m.owner_for_example_brussels_central_station()}
                help={m.owner_a_result_only_fills_in_this_draft_save_creates_the_location()}
                onSelect={choose}
              />
            )}
            {(editingId || suggestion) && (
              <>
                {mapTarget(
                  editingId ? selected?.latitude : suggestion?.latitude,
                  editingId ? selected?.longitude : suggestion?.longitude,
                )}
                <p className="help">
                  {m.owner_address_changes_do_not_move_the_saved_map_point_or_navigation_target_the()}
                </p>
              </>
            )}
            <record.form.Field name="displayName">
              {(field) => <TextField field={field} label={m.owner_your_name_2()} optional maxLength={500} />}
            </record.form.Field>
            <record.form.Field name="label">
              {(field) => <TextField field={field} label={m.owner_public_name_2()} optional maxLength={120} />}
            </record.form.Field>
            <div className="field-row">
              <record.form.Field name="addressLine1">
                {(field) => <TextField field={field} label={m.owner_address_line_1()} optional maxLength={160} />}
              </record.form.Field>
              <record.form.Field name="addressLine2">
                {(field) => <TextField field={field} label={m.owner_address_line_2()} optional maxLength={160} />}
              </record.form.Field>
            </div>
            <div className="field-row">
              <record.form.Field name="postalCode">
                {(field) => <TextField field={field} label={m.owner_postal_code()} optional maxLength={20} />}
              </record.form.Field>
              <record.form.Field name="locality">
                {(field) => <TextField field={field} label={m.owner_city()} optional maxLength={120} />}
              </record.form.Field>
            </div>
            <div className="field-row">
              <record.form.Field name="adminArea">
                {(field) => <TextField field={field} label={m.owner_region()} optional maxLength={120} />}
              </record.form.Field>
              <record.form.Field name="countryCode">
                {(field) => <TextField field={field} label={m.owner_country_code()} optional maxLength={2} />}
              </record.form.Field>
            </div>
            <record.form.Field name="notes">
              {(field) => <TextAreaField field={field} label={m.owner_private_notes_2()} optional maxLength={2000} />}
            </record.form.Field>
            {editingId && (
              <>
                <record.form.Field name="shareAddress">
                  {(field) => (
                    <CheckboxField
                      field={field}
                      label={m.owner_also_share_the_address_with_this_location_s_recipients()}
                      disabled={!canShareAddress && !field.state.value}
                    />
                  )}
                </record.form.Field>
                <p className="help">
                  {canShareAddress
                    ? m.owner_exact_address_shown_to_visitors_when_address_sharing_is_on({
                        p0: projectionText(addressPreview),
                      })
                    : m.owner_no_shareable_address_fill_in_an_address_field_first_to_enable_address_sh()}{" "}
                  {m.owner_country_code_2()} {record.values.countryCode || "geen"}
                  {m.owner_public_name_3()} {record.values.label || "geen"}
                  {m.owner_these_are_separate_from_the_address_your_name_and_private_notes_stay_pri()}
                </p>
                <p className="help">
                  {statusQuery.isPending || linksQuery.isPending
                    ? m.owner_loading_recipients()
                    : statusQuery.isError || linksQuery.isError
                      ? m.owner_recipients_could_not_be_checked()
                      : currentRecipients.length
                        ? m.owner_current_recipients_a_saved_address_change_appears_immediately_for_them_w({
                            p0: currentRecipients.join(", "),
                          })
                        : m.owner_this_location_currently_reaches_no_visitors_address_sharing_alone_does_n()}
                </p>
                <p className="help">
                  {m.owner_changing_this_reusable_location_affects_all_linked_visits_stays_routes_a()}
                </p>
              </>
            )}
          </RecordForm>
        )}
      </RecordDialog>
    </>
  );
}
