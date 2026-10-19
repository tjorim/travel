import { RecordForm, requiredText, TextField, TimeZoneField } from "../../forms/fields";
import type { useRecordForm } from "../../forms/useRecordForm";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { Area, PlaceSearchResult } from "../../tracker-model";
import { PlaceSearchField } from "../PlaceSearchField";
import {
  areaCoordinate,
  bothCoordinates,
  knownTimeZone,
  latitudeRange,
  longitudeRange,
  type Values,
} from "./model";

/** The area editor's fields; a search result only fills in this draft. */
export function AreaForm({
  tripId,
  record,
}: {
  tripId: string;
  record: ReturnType<typeof useRecordForm<Values, Area>>;
}) {
  useLocale();
  function fillFromSearch(result: PlaceSearchResult) {
    record.form.setFieldValue(
      "label",
      result.locality ?? result.admin_area ?? result.display_name ?? "",
    );
    record.form.setFieldValue("countryCode", result.country_code ?? "");
    record.form.setFieldValue("region", result.admin_area ?? "");
    // A Nominatim result can be a precise POI. Areas deliberately use a
    // roughly kilometre-sized map point; the owner can still edit every field.
    record.form.setFieldValue(
      "latitude",
      typeof result.latitude === "number" ? areaCoordinate(result.latitude) : "",
    );
    record.form.setFieldValue(
      "longitude",
      typeof result.longitude === "number" ? areaCoordinate(result.longitude) : "",
    );
  }
  return (
    <RecordForm record={record} submitLabel={m.owner_save_area()} pendingLabel={m.owner_saving()}>
      <PlaceSearchField
        tripId={tripId}
        legend={m.owner_search_city_or_region()}
        inputLabel={m.owner_search_for_a_city_or_region()}
        placeholder={m.owner_for_example_taipei()}
        help={m.owner_use_this_for_a_city_or_region_a_result_is_only_stored_when_you_save_and()}
        onSelect={fillFromSearch}
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
          {(field) => (
            <TextField field={field} label={m.owner_country_code()} optional maxLength={2} />
          )}
        </record.form.Field>
      </div>
      <div className="field-row">
        <record.form.Field name="region">
          {(field) => <TextField field={field} label={m.owner_region()} optional maxLength={120} />}
        </record.form.Field>
        <record.form.Field
          name="timezone"
          validators={{ onBlur: knownTimeZone, onSubmit: knownTimeZone }}
        >
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
        <record.form.Field
          name="longitude"
          validators={{ onChange: longitudeRange, onSubmit: longitudeRange }}
        >
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
  );
}
