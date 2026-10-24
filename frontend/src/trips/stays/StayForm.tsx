import { DateField, TimeField } from "../../forms/DateTimeFields";
import { RecordForm, requiredText, SelectField, TextField } from "../../forms/fields";
import { MarkdownField } from "../../forms/MarkdownField";
import type { useRecordForm } from "../../forms/useRecordForm";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { addDays, daysBetween, type PlaceSearchResult, type Stay } from "../../tracker-model";
import { STAY_STATUS_LABELS } from "../labels";
import { PlaceSearchField } from "../PlaceSearchField";
import { checkOutAfterCheckIn, httpsOnly, overlapLabel, overlaps, type StayValues } from "./model";
import { IdeaNote } from "../IdeaNote";

/** The stay editor's fields; the place validator belongs to the manager, which knows what the editor opened with. */
export function StayForm({
  tripId,
  record,
  editingId,
  stays,
  currentPlace,
  placeRequired,
}: {
  tripId: string;
  record: ReturnType<typeof useRecordForm<StayValues>>;
  editingId: string | null | undefined;
  stays: Stay[];
  /** The linked location's one-line name while editing, else empty. */
  currentPlace: string;
  placeRequired: (arg: {
    fieldApi: { form: { state: { values: StayValues } } };
  }) => (() => string) | undefined;
}) {
  useLocale();
  function choosePlace(result: PlaceSearchResult, existingPlace?: Stay["location"]) {
    const place = existingPlace ?? result;
    record.form.setFieldValue("propertyName", place.display_name ?? "");
    record.form.setFieldValue("address", place.address_line1 ?? "");
    record.form.setFieldValue("locality", place.locality ?? "");
    record.form.setFieldValue("countryCode", place.country_code ?? "");
    record.form.setFieldValue("location", result);
  }
  return (
    <RecordForm
      record={record}
      submitLabel={editingId ? m.owner_save_stay() : m.owner_add_stay()}
      pendingLabel={m.owner_saving()}
    >
      <record.form.Field name="status">
        {(field) => (
          <SelectField field={field} label={m.owner_status()}>
            {Object.entries(STAY_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        )}
      </record.form.Field>
      <record.form.Subscribe selector={(state) => state.values.status}>
        {(status) => status === "idea" && <IdeaNote kind="stay" />}
      </record.form.Subscribe>
      <record.form.Field name="shareDatePrecision">
        {(field) => (
          <SelectField field={field} label={m.owner_dates_for_visitors()}>
            <option value="day">{m.owner_full_dates()}</option>
            <option value="month">{m.owner_months_only()}</option>
            <option value="year">{m.owner_year_only()}</option>
          </SelectField>
        )}
      </record.form.Field>
      <record.form.Field name="propertyName">
        {(field) => (
          <TextField
            field={field}
            label={m.owner_accommodation()}
            optional={m.owner_empty_until_chosen()}
            maxLength={160}
          />
        )}
      </record.form.Field>
      <PlaceSearchField
        tripId={tripId}
        legend={m.owner_search_stay()}
        inputLabel={m.owner_search_for_accommodation_or_an_address()}
        placeholder={m.owner_for_example_central_station_hotel()}
        help={m.owner_a_stay_always_has_a_location_search_for_one_or_enter_an_address_or_city()}
        onSelect={choosePlace}
        allowExisting
        current={
          currentPlace
            ? m.owner_linked_location_choose_or_search_for_another_below_to_replace_it({
                p0: currentPlace,
              })
            : undefined
        }
      />
      <div className="field-row">
        <record.form.Field
          name="checkInDate"
          validators={{
            onChange: requiredText(m.owner_choose_the_first_night),
            onSubmit: requiredText(m.owner_choose_the_first_night),
          }}
          listeners={{
            onChange: ({ value }) => {
              if (value && String(record.form.getFieldValue("checkOutDate")) <= value)
                record.form.setFieldValue("checkOutDate", addDays(value, 1));
            },
          }}
        >
          {(field) => <DateField field={field} label={m.owner_first_night_check_in()} required />}
        </record.form.Field>
        <record.form.Field
          name="checkOutDate"
          validators={{
            onChangeListenTo: ["checkInDate"],
            onChange: checkOutAfterCheckIn,
            onSubmit: checkOutAfterCheckIn,
          }}
        >
          {(field) => <DateField field={field} label={m.owner_check_out_morning()} required />}
        </record.form.Field>
      </div>
      <record.form.Subscribe
        selector={(state) =>
          [state.values.checkInDate, state.values.checkOutDate, state.values.status] as const
        }
      >
        {([checkIn, checkOut, status]) => {
          const nights = checkIn && checkOut ? daysBetween(checkIn, checkOut) : 0;
          // Ideas are expected to overlap: they neither warn nor are warned about.
          const overlapping =
            nights > 0 && status !== "idea"
              ? stays.filter(
                  (other) =>
                    other.id !== editingId &&
                    other.status !== "idea" &&
                    overlaps(other, checkIn, checkOut),
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
      </record.form.Subscribe>
      <div className="field-row">
        <record.form.Field name="checkInTime">
          {(field) => <TimeField field={field} label={m.owner_check_in_time()} optional />}
        </record.form.Field>
        <record.form.Field name="checkOutTime">
          {(field) => <TimeField field={field} label={m.owner_check_out_time()} optional />}
        </record.form.Field>
      </div>
      <div className="field-row">
        <record.form.Field name="address">
          {(field) => (
            <TextField field={field} label={m.owner_address()} optional maxLength={160} />
          )}
        </record.form.Field>
        <record.form.Field name="locality" validators={{ onSubmit: placeRequired }}>
          {(field) => <TextField field={field} label={m.owner_city()} optional maxLength={120} />}
        </record.form.Field>
      </div>
      <div className="field-row">
        <record.form.Field name="countryCode">
          {(field) => (
            <TextField
              field={field}
              label={m.owner_country_code()}
              optional
              maxLength={2}
              placeholder="TW"
            />
          )}
        </record.form.Field>
        <record.form.Field
          name="websiteUrl"
          validators={{ onBlur: httpsOnly, onSubmit: httpsOnly }}
        >
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
        </record.form.Field>
      </div>
      <record.form.Field name="bookingReference">
        {(field) => (
          <TextField field={field} label={m.owner_booking_reference_3()} optional maxLength={255} />
        )}
      </record.form.Field>
      <record.form.Field name="contactDetails">
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
      </record.form.Field>
      <record.form.Field name="notes">
        {(field) => (
          <MarkdownField field={field} label={m.owner_notes()} optional maxLength={4000} rows={3} />
        )}
      </record.form.Field>
    </RecordForm>
  );
}
