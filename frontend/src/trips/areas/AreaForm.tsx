import { RecordForm, TextField, TimeZoneField } from "../../forms/fields";
import { LocalizedField } from "../../forms/LocalizedField";
import { LocalNameField } from "../../forms/LocalNameField";
import { SuggestedNamesNotice } from "../../forms/SuggestedNames";
import { useContentLanguage } from "@/i18n/content-language";
import type { useRecordForm } from "@/hooks/useRecordForm";
import { useLocale } from "@/i18n/locale";
import { m } from "../../paraglide/messages.js";
import { useState } from "react";
import type { Area, LocationInput } from "../../api-types";
import { PlaceSearchField } from "../PlaceSearchField";
import type { SuggestedNames } from "../place-result";
import {
  areaCoordinate,
  areaLabelOf,
  namesTheArea,
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
  const language = useContentLanguage();
  const [suggested, setSuggested] = useState<SuggestedNames | null>(null);
  function fillFromSearch(result: LocationInput, _existing?: unknown, names?: SuggestedNames) {
    // The provider's name is in one language only: it goes into the trip's, and the owner can add the other.
    record.form.setFieldValue(language === "en" ? "labelEn" : "labelNl", areaLabelOf(result));
    // The provider's names belong to the result. They describe the area only when the result is the city or region
    // itself; a result inside it (a station, a hotel) names something else, so nothing of it is offered.
    const itself = namesTheArea(result);
    record.form.setFieldValue("localName", itself ? (result.local_name ?? "") : "");
    setSuggested(itself && names ? names : null);
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
    <RecordForm record={record} submitLabel={m.areas_save_area()} pendingLabel={m.common_saving()}>
      <PlaceSearchField
        tripId={tripId}
        legend={m.areas_search_city_or_region()}
        inputLabel={m.areas_search_for_a_city_or_region()}
        placeholder={m.areas_for_example_taipei()}
        help={m.areas_search_hint()}
        onSelect={fillFromSearch}
      />
      <div className="field-row">
        <LocalizedField
          form={record.form}
          name="label"
          label={m.common_name()}
          required
          requiredMessage={m.areas_give_the_area_a_name}
          maxLength={120}
        />
        <record.form.Field name="countryCode">
          {(field) => (
            <TextField field={field} label={m.locations_country_code()} optional maxLength={2} />
          )}
        </record.form.Field>
      </div>
      <SuggestedNamesNotice form={record.form} name="label" names={suggested} />
      <record.form.Field name="localName">
        {(field) => (
          <LocalNameField
            field={field}
            label={m.areas_local_name()}
            hint={m.areas_local_name_hint()}
          />
        )}
      </record.form.Field>
      <div className="field-row">
        <record.form.Field name="region">
          {(field) => (
            <TextField field={field} label={m.locations_region()} optional maxLength={120} />
          )}
        </record.form.Field>
        <record.form.Field
          name="timezone"
          validators={{ onBlur: knownTimeZone, onSubmit: knownTimeZone }}
        >
          {(field) => (
            <TimeZoneField
              field={field}
              label={m.areas_time_zone()}
              optional={m.areas_optional_private()}
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
              label={m.areas_latitude_label()}
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
              label={m.areas_longitude_label()}
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
