import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useFeedback, textNotice, errorNotice } from "../query/feedback";
import { Button } from "@base-ui/react/button";
import { useRef, useState } from "react";

import { DateField, TimeField } from "../forms/DateTimeFields";
import { RecordForm, requiredText, SelectField, TextField } from "../forms/fields";
import { MarkdownField } from "../forms/MarkdownField";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { Markdown } from "../Markdown";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import {
  addDays,
  daysBetween,
  formatDay,
  stayInPlan,
  stayLabel,
  locationName,
  type Area,
  type LocationInput,
  type PlaceSearchResult,
  type Stay,
  type Trip,
} from "../tracker-model";
import { PlaceSearchField } from "./PlaceSearchField";
import { VisibilityControl, visibilityLabel } from "./visibility";

const STATUS_LABELS: Record<Stay["status"], string> = {
  get idea() {
    return m.owner_idea();
  },
  get planned() {
    return m.owner_planned();
  },
  get confirmed() {
    return m.owner_confirmed();
  },
  get cancelled() {
    return m.owner_cancelled();
  },
};

/** The archive's hotel states: still choosing, proposed, or settled. */
export function stayStateLabel(stay: Stay): string {
  if (stay.status === "planned") return stay.property_name ? m.owner_suggested() : m.owner_still_to_choose();
  return STATUS_LABELS[stay.status];
}

type StayValues = {
  propertyName: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
  status: Stay["status"];
  websiteUrl: string;
  address: string;
  locality: string;
  countryCode: string;
  location: LocationInput | null;
  bookingReference: string;
  contactDetails: string;
  notes: string;
  shareDatePrecision: Stay["share_date_precision"];
};

const blankStay = (trip: Trip): StayValues => {
  const checkIn = trip.starts_on ?? new Date().toISOString().slice(0, 10);
  return {
    propertyName: "",
    checkInDate: checkIn,
    checkOutDate: addDays(checkIn, 1),
    checkInTime: "",
    checkOutTime: "",
    status: "planned",
    websiteUrl: "",
    address: "",
    locality: "",
    countryCode: "",
    location: null,
    bookingReference: "",
    contactDetails: "",
    notes: "",
    shareDatePrecision: "month",
  };
};
const locationInput = (place: Stay["location"]): LocationInput | null => {
  if (!place) return null;
  return { existing_location_id: place.id };
};
const fromStay = (stay: Stay): StayValues => ({
  propertyName: stay.property_name ?? "",
  checkInDate: stay.check_in_date,
  checkOutDate: stay.check_out_date,
  checkInTime: stay.check_in_time?.slice(0, 5) ?? "",
  checkOutTime: stay.check_out_time?.slice(0, 5) ?? "",
  status: stay.status,
  websiteUrl: stay.website_url ?? "",
  address: stay.location?.address_line1 ?? "",
  locality: stay.location?.locality ?? "",
  countryCode: stay.location?.country_code ?? "",
  location: locationInput(stay.location),
  bookingReference: stay.booking_reference ?? "",
  contactDetails: stay.contact_details ?? "",
  notes: stay.notes ?? "",
  shareDatePrecision: stay.share_date_precision,
});

const stayFields = {
  property_name: "propertyName",
  check_in_date: "checkInDate",
  check_out_date: "checkOutDate",
  check_in_time: "checkInTime",
  check_out_time: "checkOutTime",
  status: "status",
  website_url: "websiteUrl",
  booking_reference: "bookingReference",
  contact_details: "contactDetails",
  notes: "notes",
  share_date_precision: "shareDatePrecision",
};
const PLACE_FIELDS = ["propertyName", "address", "locality", "countryCode", "location"] as const;

const checkOutAfterCheckIn = ({
  value,
  fieldApi,
}: {
  value: string;
  fieldApi: { form: { getFieldValue: (name: never) => unknown } };
}) =>
  value && value <= String(fieldApi.form.getFieldValue("checkInDate" as never) ?? "")
    ? m.owner_check_out_is_no_earlier_than_the_morning_after_the_first_night
    : undefined;
const PLACE_REQUIRED = m.owner_choose_where_you_are_staying_search_for_a_location_or_enter_an_address_o;
const httpsOnly = ({ value }: { value: string }) =>
  value.trim() && !value.trim().startsWith("https://") ? m.owner_use_an_https_address : undefined;

const locationLine = (place: Stay["location"] | undefined) =>
  place ? [...new Set([locationName(place), place.locality].filter(Boolean))].join(" · ") : "";
const overlaps = (stay: Stay, checkIn: string, checkOut: string) =>
  stay.check_in_date < checkOut && checkIn < stay.check_out_date;
/** Ideas for the same dates are shown together as alternatives; a lone idea is listed like any stay. */
function stayEntries(stays: Stay[]): { stays: Stay[]; dates?: string }[] {
  const groups = new Map<string, Stay[]>();
  for (const stay of stays.filter((item) => item.status === "idea")) {
    const key = `${stay.check_in_date}|${stay.check_out_date}`;
    groups.set(key, [...(groups.get(key) ?? []), stay]);
  }
  const shown = new Set<string>();
  return stays.flatMap((stay) => {
    const key = `${stay.check_in_date}|${stay.check_out_date}`;
    const group = stay.status === "idea" ? groups.get(key)! : [stay];
    if (group.length < 2) return [{ stays: [stay] }];
    if (shown.has(key)) return [];
    shown.add(key);
    return [{ stays: group, dates: `${formatDay(stay.check_in_date)} → ${formatDay(stay.check_out_date)}` }];
  });
}
const overlapLabel = (stay: Stay) =>
  `${stayLabel(stay)} (${formatDay(stay.check_in_date)} → ${formatDay(stay.check_out_date)})`;

export function StayManager({ trip, focusId }: { trip: Trip; areas?: Area[]; focusId?: DialogFocusRequest | null }) {
  useLocale();
  const staysQuery = useTripResource(trip.id, "stays");
  const stays = staysQuery.data ?? [];
  const stayDialog = useRecordDialog(stays);
  useDialogFocus(focusId, stayDialog.inspect);
  const [message, setMessage] = useFeedback<string>(
    textNotice(() => m.owner_a_stay_is_private_if_you_share_it_visitors_only_see_the_city_or_area_and()),
  );
  const [deleteTarget, setDeleteTarget] = useState<Stay | null>(null);
  // A stay's place is only rewritten when one of its fields differs from what the editor opened with.
  const baseline = useRef<StayValues>(blankStay(trip));

  const saveStay = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, Stay>({
    fallback: m.owner_the_stay_could_not_be_saved,
    request: ({ id, payload }) => ({
      path: id ? `${tripPath(trip.id, "stays")}/${id}` : tripPath(trip.id, "stays"),
      method: id ? "PATCH" : "POST",
      body: payload,
    }),
    // Saving a hotel can create or reuse both a location and its derived area.
    invalidate: (subject) => [
      ownerKeys.tripResource(subject, trip.id, "stays"),
      ownerKeys.tripResource(subject, trip.id, "locations"),
      ownerKeys.tripResource(subject, trip.id, "areas"),
    ],
  });
  const deleteStay = useOwnerMutation<Stay>({
    fallback: m.owner_the_stay_could_not_be_deleted,
    request: (stay) => ({ path: `${tripPath(trip.id, "stays")}/${stay.id}`, method: "DELETE" }),
    invalidate: (subject) => [
      ownerKeys.tripResource(subject, trip.id, "stays"),
      ownerKeys.tripResource(subject, trip.id, "locations"),
      ownerKeys.tripResource(subject, trip.id, "areas"),
    ],
  });
  async function cancelAlternatives(alternatives: Stay[]) {
    try {
      for (const alternative of alternatives)
        await saveStay.mutateAsync({ id: alternative.id, payload: { status: "cancelled" } });
      stayDialog.close();
      setMessage(textNotice(() => m.owner_stay_alternatives_cancelled()));
    } catch (error) {
      stayDialog.setError(errorNotice(error, m.owner_the_stay_could_not_be_saved));
    }
  }
  const stayRecord = useRecordForm<StayValues>({
    defaultValues: blankStay(trip),
    fallback: m.owner_the_stay_could_not_be_saved,
    serverFields: stayFields,
    submit: async (values) => {
      const propertyName = values.propertyName.trim();
      const placeChanged = PLACE_FIELDS.some((name) => values[name] !== baseline.current[name]);
      const id = stayDialog.editingId ?? null;
      await saveStay.mutateAsync({
        id,
        payload: {
          property_name: propertyName || null,
          check_in_date: values.checkInDate,
          check_out_date: values.checkOutDate,
          check_in_time: values.checkInTime || null,
          check_out_time: values.checkOutTime || null,
          status: values.status,
          website_url: values.websiteUrl.trim() || null,
          booking_reference: values.bookingReference.trim() || null,
          contact_details: values.contactDetails.trim() || null,
          notes: values.notes.trim() || null,
          share_date_precision: values.shareDatePrecision,
          ...(!id || placeChanged
            ? {
                location: values.location?.existing_location_id
                  ? { existing_location_id: values.location.existing_location_id }
                  : {
                      ...values.location,
                      display_name: propertyName || null,
                      address_line1: values.address.trim() || null,
                      locality: values.locality.trim() || null,
                      country_code: values.countryCode.trim().toUpperCase() || null,
                    },
              }
            : {}),
        },
      });
    },
    onSuccess: () => {
      closeStay();
      setMessage(textNotice(() => m.owner_private_stay_saved()));
    },
  });
  // Only a new stay, or one whose place fields were edited, needs a place to send; the message sits on the Plaats field.
  function placeRequired({ fieldApi }: { fieldApi: { form: { state: { values: StayValues } } } }) {
    const values = fieldApi.form.state.values;
    const hasPlace = Boolean(
      values.location?.existing_location_id ||
      values.propertyName.trim() ||
      values.address.trim() ||
      values.locality.trim(),
    );
    const placeChanged = PLACE_FIELDS.some((name) => values[name] !== baseline.current[name]);
    return (!stayDialog.editingId || placeChanged) && !hasPlace ? PLACE_REQUIRED : undefined;
  }
  function loadStay(values: StayValues) {
    baseline.current = values;
    stayRecord.load(values);
  }
  function closeStay() {
    stayDialog.close();
    loadStay(blankStay(trip));
  }
  function newStay() {
    loadStay(blankStay(trip));
    stayDialog.create();
  }
  function editStay(stay: Stay) {
    loadStay(fromStay(stay));
    stayDialog.edit(stay.id);
  }
  function usePlaceResult(result: PlaceSearchResult, existingPlace?: Stay["location"]) {
    const place = existingPlace ?? result;
    stayRecord.form.setFieldValue("propertyName", place.display_name ?? "");
    stayRecord.form.setFieldValue("address", place.address_line1 ?? "");
    stayRecord.form.setFieldValue("locality", place.locality ?? "");
    stayRecord.form.setFieldValue("countryCode", place.country_code ?? "");
    stayRecord.form.setFieldValue("location", result);
  }
  function confirmDelete() {
    if (!deleteTarget) return;
    deleteStay.mutateAsync(deleteTarget).then(
      () => {
        closeStay();
        setDeleteTarget(null);
        setMessage(textNotice(() => m.owner_private_stay_deleted()));
      },
      (error: unknown) => {
        setDeleteTarget(null);
        stayDialog.setError(errorNotice(error, m.owner_the_stay_could_not_be_deleted));
      },
    );
  }

  const { selected: selectedStay, editing: editingStay, editingId: editingStayId } = stayDialog;
  const readError = staysQuery.error;
  // Once a stay is chosen, the ideas for its nights are the rejected alternatives.
  const alternatives =
    selectedStay && stayInPlan(selectedStay)
      ? stays.filter(
          (other) =>
            other.status === "idea" && overlaps(other, selectedStay.check_in_date, selectedStay.check_out_date),
        )
      : [];
  const currentPlace = locationLine(stays.find((stay) => stay.id === editingStayId)?.location);

  return (
    <section className="travel-card manager" id="stays" aria-labelledby="stays-title">
      <div className="capture-heading">
        <div>
          <h3 id="stays-title">{m.owner_stays()}</h3>
          <p>{m.owner_a_stay_is_a_series_of_nights_check_in_during_the_afternoon_of_the_first()}</p>
        </div>
        <Button className="secondary compact" type="button" onClick={newStay}>
          {m.owner_new_stay()}
        </Button>
      </div>
      <p className="help" role="status">
        {readError
          ? errorMessage(readError, m.owner_your_stays_could_not_be_loaded)
          : staysQuery.isPending
            ? m.owner_loading_your_private_stays()
            : message}
      </p>
      {stays.length > 0 && (
        <div className="saved-records mt-0.5">
          {stayEntries(stays).map((entry) => {
            const rows = entry.stays.map((stay) => {
              const nights = daysBetween(stay.check_in_date, stay.check_out_date);
              return (
                <article className="excerpt-row" key={stay.id}>
                  <Button className="document-select" type="button" onClick={() => stayDialog.inspect(stay.id)}>
                    <strong>{stayLabel(stay)}</strong>
                    <span>
                      {[
                        stay.area?.label,
                        `${formatDay(stay.check_in_date)} → ${formatDay(stay.check_out_date)}`,
                        m.owner_night_count({ count: nights }),
                        stayStateLabel(stay),
                        visibilityLabel(stay.visibility),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </Button>
                </article>
              );
            });
            if (!entry.dates) return rows;
            const label = m.owner_stay_alternatives({ dates: entry.dates });
            return (
              <div
                key={entry.stays[0].id}
                role="group"
                aria-label={label}
                className="border-l-2 border-travel-border pl-1"
              >
                <p className="help font-bold">{label}</p>
                {rows}
              </div>
            );
          })}
        </div>
      )}
      <RecordDialog
        open={editingStay || selectedStay !== null}
        title={editingStay ? (editingStayId ? m.owner_edit_stay() : m.owner_add_stay()) : m.owner_stay()}
        dirty={editingStay && stayRecord.dirty}
        error={stayDialog.error}
        onDismiss={closeStay}
      >
        {!editingStay && selectedStay && (
          <div className="stack-form">
            <div>
              <h3>{stayLabel(selectedStay)}</h3>
              {(selectedStay.location?.address_line1 || selectedStay.location?.locality) && (
                <p>
                  {[selectedStay.location.address_line1, selectedStay.location.locality].filter(Boolean).join(" · ")}
                </p>
              )}
              <p>
                {selectedStay.booking_reference
                  ? m.owner_booking_reference_2({ p0: selectedStay.booking_reference })
                  : m.owner_no_booking_reference()}
              </p>
              {selectedStay.contact_details && (
                <>
                  <p className="markdown-label">{m.owner_contact()}</p>
                  <Markdown html={selectedStay.contact_details_html} text={selectedStay.contact_details} />
                </>
              )}
              <Markdown html={selectedStay.notes_html} text={selectedStay.notes} />
            </div>
            {selectedStay.status === "idea" ? (
              <p className="help">
                {m.owner_a_stay_idea_is_a_candidate_it_may_overlap_other_stays_covers_no_night_and_is_never_shared()}
              </p>
            ) : (
              <VisibilityControl
                tripId={trip.id}
                kind="stay"
                id={selectedStay.id}
                value={selectedStay.visibility}
                name={stayLabel(selectedStay)}
              />
            )}
            {alternatives.length > 0 && (
              <div>
                <p className="help">{m.owner_stay_ideas_overlap_these_nights({ count: alternatives.length })}</p>
                <Button
                  className="secondary compact"
                  type="button"
                  disabled={saveStay.isPending}
                  onClick={() => cancelAlternatives(alternatives)}
                >
                  {m.owner_cancel_stay_alternatives({ count: alternatives.length })}
                </Button>
              </div>
            )}
            <div className="button-row">
              <Button type="button" onClick={() => editStay(selectedStay)}>
                {m.owner_edit()}
              </Button>
              <Button className="danger" type="button" onClick={() => setDeleteTarget(selectedStay)}>
                {m.owner_delete()}
              </Button>
            </div>
          </div>
        )}
        {editingStay && (
          <RecordForm
            record={stayRecord}
            submitLabel={editingStayId ? m.owner_save_stay() : m.owner_add_stay()}
            pendingLabel={m.owner_saving()}
          >
            <stayRecord.form.Field name="status">
              {(field) => (
                <SelectField field={field} label={m.owner_status()}>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectField>
              )}
            </stayRecord.form.Field>
            <stayRecord.form.Subscribe selector={(state) => state.values.status}>
              {(status) =>
                status === "idea" && (
                  <p className="help">
                    {m.owner_a_stay_idea_is_a_candidate_it_may_overlap_other_stays_covers_no_night_and_is_never_shared()}
                  </p>
                )
              }
            </stayRecord.form.Subscribe>
            <stayRecord.form.Field name="shareDatePrecision">
              {(field) => (
                <SelectField field={field} label={m.owner_dates_for_visitors()}>
                  <option value="day">{m.owner_full_dates()}</option>
                  <option value="month">{m.owner_months_only()}</option>
                  <option value="year">{m.owner_year_only()}</option>
                </SelectField>
              )}
            </stayRecord.form.Field>
            <stayRecord.form.Field name="propertyName">
              {(field) => (
                <TextField
                  field={field}
                  label={m.owner_accommodation()}
                  optional={m.owner_empty_until_chosen()}
                  maxLength={160}
                />
              )}
            </stayRecord.form.Field>
            <PlaceSearchField
              tripId={trip.id}
              legend={m.owner_search_stay()}
              inputLabel={m.owner_search_for_accommodation_or_an_address()}
              placeholder={m.owner_for_example_citizenm_taipei_north_gate()}
              help={m.owner_a_stay_always_has_a_location_search_for_one_or_enter_an_address_or_city()}
              onSelect={usePlaceResult}
              allowExisting
              current={
                currentPlace
                  ? m.owner_linked_location_choose_or_search_for_another_below_to_replace_it({ p0: currentPlace })
                  : undefined
              }
            />
            <div className="field-row">
              <stayRecord.form.Field
                name="checkInDate"
                validators={{
                  onChange: requiredText(m.owner_choose_the_first_night),
                  onSubmit: requiredText(m.owner_choose_the_first_night),
                }}
                listeners={{
                  onChange: ({ value }) => {
                    if (value && String(stayRecord.form.getFieldValue("checkOutDate")) <= value)
                      stayRecord.form.setFieldValue("checkOutDate", addDays(value, 1));
                  },
                }}
              >
                {(field) => <DateField field={field} label={m.owner_first_night_check_in()} required />}
              </stayRecord.form.Field>
              <stayRecord.form.Field
                name="checkOutDate"
                validators={{
                  onChangeListenTo: ["checkInDate"],
                  onChange: checkOutAfterCheckIn,
                  onSubmit: checkOutAfterCheckIn,
                }}
              >
                {(field) => <DateField field={field} label={m.owner_check_out_morning()} required />}
              </stayRecord.form.Field>
            </div>
            <stayRecord.form.Subscribe
              selector={(state) => [state.values.checkInDate, state.values.checkOutDate, state.values.status] as const}
            >
              {([checkIn, checkOut, status]) => {
                const nights = checkIn && checkOut ? daysBetween(checkIn, checkOut) : 0;
                // Ideas are expected to overlap: they neither warn nor are warned about.
                const overlapping =
                  nights > 0 && status !== "idea"
                    ? stays.filter(
                        (other) =>
                          other.id !== editingStayId && other.status !== "idea" && overlaps(other, checkIn, checkOut),
                      )
                    : [];
                return (
                  <>
                    <p className="help">
                      {nights > 0
                        ? m.owner_night_count({ count: nights })
                        : m.owner_choose_a_check_out_date_after_the_first_night()}{" "}
                      {m.owner_local_dates_at_the_stay()}
                    </p>
                    {overlapping.length > 0 && (
                      <p className="help font-bold text-travel-warning-dark" role="status">
                        {m.owner_these_nights_overlap_with()} {overlapping.map(overlapLabel).join(", ")}
                        {m.owner_that_is_allowed_but_check_that_you_are_not_booking_twice()}
                      </p>
                    )}
                  </>
                );
              }}
            </stayRecord.form.Subscribe>
            <div className="field-row">
              <stayRecord.form.Field name="checkInTime">
                {(field) => <TimeField field={field} label={m.owner_check_in_time()} optional />}
              </stayRecord.form.Field>
              <stayRecord.form.Field name="checkOutTime">
                {(field) => <TimeField field={field} label={m.owner_check_out_time()} optional />}
              </stayRecord.form.Field>
            </div>
            <div className="field-row">
              <stayRecord.form.Field name="address">
                {(field) => <TextField field={field} label={m.owner_address()} optional maxLength={160} />}
              </stayRecord.form.Field>
              <stayRecord.form.Field name="locality" validators={{ onSubmit: placeRequired }}>
                {(field) => <TextField field={field} label={m.owner_city()} optional maxLength={120} />}
              </stayRecord.form.Field>
            </div>
            <div className="field-row">
              <stayRecord.form.Field name="countryCode">
                {(field) => (
                  <TextField field={field} label={m.owner_country_code()} optional maxLength={2} placeholder="TW" />
                )}
              </stayRecord.form.Field>
              <stayRecord.form.Field name="websiteUrl" validators={{ onBlur: httpsOnly, onSubmit: httpsOnly }}>
                {(field) => (
                  <TextField
                    field={field}
                    label={m.owner_website()}
                    optional={m.owner_optional_https()}
                    type="url"
                    maxLength={2048}
                    placeholder="https://"
                  />
                )}
              </stayRecord.form.Field>
            </div>
            <stayRecord.form.Field name="bookingReference">
              {(field) => <TextField field={field} label={m.owner_booking_reference_3()} optional maxLength={255} />}
            </stayRecord.form.Field>
            <stayRecord.form.Field name="contactDetails">
              {(field) => (
                <MarkdownField
                  field={field}
                  format="contact"
                  label={m.owner_contact_details()}
                  optional
                  maxLength={2000}
                  rows={3}
                />
              )}
            </stayRecord.form.Field>
            <stayRecord.form.Field name="notes">
              {(field) => <MarkdownField field={field} label={m.owner_notes()} optional maxLength={4000} rows={3} />}
            </stayRecord.form.Field>
          </RecordForm>
        )}
      </RecordDialog>
      {deleteTarget && (
        <DeleteConfirmation
          title={m.owner_delete_2({ p0: stayLabel(deleteTarget) })}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </section>
  );
}
