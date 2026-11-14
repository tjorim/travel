import { AdvancedSection } from "../../forms/AdvancedSection";
import { DateField, TimeField } from "../../forms/DateTimeFields";
import { DocumentLinksField } from "../../forms/DocumentLinksField";
import { Button } from "@/ui/button";
import { RecordForm, requiredText, SelectField, TextField } from "../../forms/fields";
import { MarkdownField } from "../../forms/MarkdownField";
import type { useRecordForm } from "../../forms/useRecordForm";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { useTripResource } from "../../query/owner-queries";
import { addDays, daysBetween } from "../../dates";
import { areaName } from "../../records";
import { type DocumentAsset, type LocationInput, type Stay } from "../../api-types";
import { PLANNING_STATUS_LABELS } from "../labels";
import { PlaceSearchField } from "../PlaceSearchField";
import { recordPrecisionOptions } from "../record-precision";
import {
  accommodationOf,
  checkOutAfterCheckIn,
  httpsOnly,
  overlapLabel,
  overlaps,
  type StayValues,
} from "./model";
import { IdeaNote } from "../IdeaNote";

/** The stay editor's fields; the place validator belongs to the manager, which knows what the editor opened with. */
export function StayForm({
  tripId,
  record,
  editingId,
  stays,
  documents,
  currentPlace,
  areaRequired,
}: {
  tripId: string;
  record: ReturnType<typeof useRecordForm<StayValues>>;
  editingId: string | null | undefined;
  stays: Stay[];
  /** The trip's documents, to attach a booking confirmation to the stay. */
  documents: DocumentAsset[];
  /** The linked location's one-line name while editing, else empty. */
  currentPlace: string;
  /** The area is required until an accommodation is chosen. */
  areaRequired: (arg: {
    fieldApi: { form: { state: { values: StayValues } } };
  }) => (() => string) | undefined;
}) {
  useLocale();
  const areas = useTripResource(tripId, "areas").data ?? [];
  function choosePlace(result: LocationInput, existingPlace?: Stay["location"]) {
    const place = existingPlace ?? result;
    record.form.setFieldValue("propertyName", place.display_name ?? "");
    record.form.setFieldValue("address", place.address_line1 ?? "");
    record.form.setFieldValue("locality", place.locality ?? "");
    record.form.setFieldValue("countryCode", place.country_code ?? "");
    record.form.setFieldValue("location", result);
    // A saved accommodation settles the area; a new one leaves the choice open ("derive from the city").
    if (existingPlace) record.form.setFieldValue("areaId", existingPlace.area_id);
  }
  /** Back to "accommodation not chosen yet": the stay keeps its area and the saved location is left alone. */
  function removeAccommodation() {
    record.form.setFieldValue("location", null);
    record.form.setFieldValue("address", "");
    record.form.setFieldValue("locality", "");
    record.form.setFieldValue("countryCode", "");
  }
  return (
    <RecordForm
      record={record}
      submitLabel={editingId ? m.stays_save_stay() : m.stays_add_stay()}
      pendingLabel={m.common_saving()}
    >
      <record.form.Field name="status">
        {(field) => (
          <SelectField field={field} label={m.common_status()}>
            {Object.entries(PLANNING_STATUS_LABELS).map(([value, label]) => (
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
      <record.form.Subscribe selector={(state) => state.values.shareDatePrecision !== ""}>
        {(inUse) => (
          <AdvancedSection summary={m.common_dates_for_visitors()} inUse={inUse}>
            <record.form.Field name="shareDatePrecision">
              {(field) => (
                <SelectField field={field} label={m.common_dates_for_visitors()}>
                  {recordPrecisionOptions()}
                </SelectField>
              )}
            </record.form.Field>
            <p className="help">{m.precision_record_help()}</p>
          </AdvancedSection>
        )}
      </record.form.Subscribe>
      <record.form.Subscribe selector={(state) => accommodationOf(state.values)}>
        {(accommodation) => (
          <record.form.Field name="areaId" validators={{ onSubmit: areaRequired }}>
            {(field) => (
              <>
                <SelectField
                  field={field}
                  label={m.common_area()}
                  disabled={accommodation === "saved"}
                  optional={accommodation === "new" ? m.common_optional() : undefined}
                >
                  <option value="">
                    {accommodation === "new"
                      ? m.stays_derive_the_area_from_the_city()
                      : m.locations_choose_an_area_option()}
                  </option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {areaName(area)}
                    </option>
                  ))}
                </SelectField>
                <p className="help">
                  {accommodation === "saved"
                    ? m.stays_area_follows_the_accommodation()
                    : m.stays_stay_area_help()}
                </p>
              </>
            )}
          </record.form.Field>
        )}
      </record.form.Subscribe>
      <record.form.Field name="propertyName">
        {(field) => (
          <TextField
            field={field}
            label={m.stays_accommodation()}
            optional={m.stays_empty_until_chosen()}
            maxLength={160}
          />
        )}
      </record.form.Field>
      <record.form.Subscribe
        selector={(state) =>
          accommodationOf(state.values) === "none" ? state.values.propertyName : ""
        }
      >
        {(suggestedQuery) => (
          <PlaceSearchField
            tripId={tripId}
            suggestedQuery={suggestedQuery}
            legend={m.stays_search_stay()}
            inputLabel={m.stays_search_for_accommodation_or_an_address()}
            placeholder={m.stays_for_example_central_station_hotel()}
            help={m.stays_stay_search_help()}
            onSelect={choosePlace}
            allowExisting
            current={
              currentPlace
                ? m.stays_linked_location_hint({
                    place: currentPlace,
                  })
                : undefined
            }
          />
        )}
      </record.form.Subscribe>
      <div className="field-row">
        <record.form.Field
          name="checkInDate"
          validators={{
            onChange: requiredText(m.stays_choose_the_first_night),
            onSubmit: requiredText(m.stays_choose_the_first_night),
          }}
          listeners={{
            onChange: ({ value }) => {
              if (value && String(record.form.getFieldValue("checkOutDate")) <= value)
                record.form.setFieldValue("checkOutDate", addDays(value, 1));
            },
          }}
        >
          {(field) => <DateField field={field} label={m.stays_first_night_check_in()} required />}
        </record.form.Field>
        <record.form.Field
          name="checkOutDate"
          validators={{
            onChangeListenTo: ["checkInDate"],
            onChange: checkOutAfterCheckIn,
            onSubmit: checkOutAfterCheckIn,
          }}
        >
          {(field) => <DateField field={field} label={m.stays_check_out_morning()} required />}
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
                  ? m.common_night_count({ count: nights })
                  : m.stays_choose_a_check_out_date_after_the_first_night()}{" "}
                {m.stays_local_dates_at_the_stay()}
              </p>
              {overlapping.length > 0 && (
                <p className="help font-bold text-travel-warning-dark" role="status">
                  {m.stays_these_nights_overlap_with()} {overlapping.map(overlapLabel).join(", ")}
                  {m.stays_overlap_suffix()}
                </p>
              )}
            </>
          );
        }}
      </record.form.Subscribe>
      <div className="field-row">
        <record.form.Field name="checkInTime">
          {(field) => <TimeField field={field} label={m.stays_check_in_time()} optional />}
        </record.form.Field>
        <record.form.Field name="checkOutTime">
          {(field) => <TimeField field={field} label={m.stays_check_out_time()} optional />}
        </record.form.Field>
      </div>
      <record.form.Subscribe selector={(state) => accommodationOf(state.values)}>
        {(accommodation) =>
          accommodation !== "none" && (
            <div>
              <Button className="secondary compact" type="button" onClick={removeAccommodation}>
                {m.stays_remove_the_accommodation()}
              </Button>
              <p className="help">{m.stays_remove_the_accommodation_help()}</p>
            </div>
          )
        }
      </record.form.Subscribe>
      <div className="field-row">
        <record.form.Field name="address">
          {(field) => (
            <TextField field={field} label={m.common_address()} optional maxLength={160} />
          )}
        </record.form.Field>
        <record.form.Field name="locality">
          {(field) => (
            <TextField field={field} label={m.locations_city()} optional maxLength={120} />
          )}
        </record.form.Field>
      </div>
      <div className="field-row">
        <record.form.Field name="countryCode">
          {(field) => (
            <TextField
              field={field}
              label={m.locations_country_code()}
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
              label={m.common_website()}
              optional={m.common_optional_https()}
              type="url"
              maxLength={2048}
              placeholder="https://"
            />
          )}
        </record.form.Field>
      </div>
      <record.form.Field name="bookingReference">
        {(field) => (
          <TextField
            field={field}
            label={m.common_booking_reference_label()}
            optional
            maxLength={255}
          />
        )}
      </record.form.Field>
      <record.form.Field name="contactDetails">
        {(field) => (
          <MarkdownField
            field={field}
            format="contact"
            label={m.stays_contact_details()}
            optional
            maxLength={2000}
            rows={3}
          />
        )}
      </record.form.Field>
      <record.form.Field name="notes">
        {(field) => (
          <MarkdownField
            field={field}
            label={m.common_notes()}
            optional
            maxLength={4000}
            rows={3}
          />
        )}
      </record.form.Field>
      <record.form.Field name="documentAssetIds">
        {(field) => (
          <DocumentLinksField
            documents={documents}
            value={field.state.value}
            onChange={field.handleChange}
          />
        )}
      </record.form.Field>
    </RecordForm>
  );
}
