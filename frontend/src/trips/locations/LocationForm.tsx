import { AdvancedSection } from "../../forms/AdvancedSection";
import { areaName } from "../../records";
import { Button } from "@/ui/button";

import {
  CheckboxField,
  RecordForm,
  requiredText,
  SelectField,
  TextAreaField,
  TextField,
} from "../../forms/fields";
import type { useRecordForm } from "../../forms/useRecordForm";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { Area, Location, LocationInput } from "../../api-types";
import { PlaceSearchField } from "../PlaceSearchField";
import { MapTarget } from "./MapTarget";
import {
  pendingVisitorFields,
  projectionText,
  visitorFieldLabel,
  type RecipientState,
  type Values,
} from "./model";
import { RecipientsText } from "./RecipientsText";

/** The location editor's fields; choosing a search result and adding an area are handled by the manager. */
export function LocationForm({
  tripId,
  record,
  editingId,
  selected,
  suggestion,
  areas,
  addressPreview,
  canShareAddress,
  recipients,
  recipientState,
  onAddArea,
  onChoose,
}: {
  tripId: string;
  record: ReturnType<typeof useRecordForm<Values, Location>>;
  editingId: string | null | undefined;
  selected: Location | null;
  suggestion: LocationInput | null;
  areas: Area[];
  addressPreview: Record<string, string | null | undefined>;
  canShareAddress: boolean;
  recipients: string[];
  recipientState: RecipientState;
  onAddArea: () => void;
  onChoose: (result: LocationInput) => void;
}) {
  useLocale();
  // What this edit would change for the audiences that read the saved location today.
  const pending =
    editingId && selected && recipients.length ? pendingVisitorFields(selected, record.values) : [];
  const movesArea = Boolean(editingId && selected && record.values.areaId !== selected.area_id);
  return (
    <RecordForm
      record={record}
      submitLabel={m.locations_save_location()}
      pendingLabel={m.common_saving()}
      disabled={
        !record.values.areaId ||
        (record.values.shareAddress && !canShareAddress) ||
        (!editingId &&
          !record.values.displayName.trim() &&
          !record.values.addressLine1.trim() &&
          !record.values.locality.trim())
      }
    >
      {!areas.length && <p>{m.locations_create_an_area_first_your_location_draft_is_kept()}</p>}
      {!areas.length && (
        <Button type="button" className="secondary" onClick={onAddArea}>
          {m.common_add_area()}
        </Button>
      )}
      <record.form.Field
        name="areaId"
        validators={{
          onChange: requiredText(m.locations_choose_an_area),
          onSubmit: requiredText(m.locations_choose_an_area),
        }}
      >
        {(field) => (
          <SelectField field={field} label={m.common_area()}>
            <option value="">{m.locations_choose_an_area_option()}</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {areaName(area)}
              </option>
            ))}
          </SelectField>
        )}
      </record.form.Field>
      {areas.length > 0 && (
        <Button type="button" className="secondary compact" onClick={onAddArea}>
          {m.locations_add_new_area()}
        </Button>
      )}
      {!editingId && (
        <PlaceSearchField
          tripId={tripId}
          legend={m.locations_search_location()}
          inputLabel={m.locations_search_via_openstreetmap()}
          placeholder={m.locations_for_example_brussels_central_station()}
          help={m.locations_search_result_hint()}
          onSelect={onChoose}
        />
      )}
      {(editingId || suggestion) && (
        <>
          <MapTarget
            latitude={editingId ? selected?.latitude : suggestion?.latitude}
            longitude={editingId ? selected?.longitude : suggestion?.longitude}
          />
          <p className="help">{m.locations_address_edit_hint()}</p>
        </>
      )}
      <record.form.Field name="displayName">
        {(field) => (
          <TextField field={field} label={m.locations_own_name_label()} optional maxLength={500} />
        )}
      </record.form.Field>
      <record.form.Field name="label">
        {(field) => (
          <TextField
            field={field}
            label={m.locations_public_name_label()}
            optional
            maxLength={120}
          />
        )}
      </record.form.Field>
      <div className="field-row">
        <record.form.Field name="addressLine1">
          {(field) => (
            <TextField
              field={field}
              label={m.locations_address_first_line()}
              optional
              maxLength={160}
            />
          )}
        </record.form.Field>
        <record.form.Field name="addressLine2">
          {(field) => (
            <TextField
              field={field}
              label={m.locations_address_second_line()}
              optional
              maxLength={160}
            />
          )}
        </record.form.Field>
      </div>
      <div className="field-row">
        <record.form.Field name="postalCode">
          {(field) => (
            <TextField field={field} label={m.locations_postal_code()} optional maxLength={20} />
          )}
        </record.form.Field>
        <record.form.Field name="locality">
          {(field) => (
            <TextField field={field} label={m.locations_city()} optional maxLength={120} />
          )}
        </record.form.Field>
      </div>
      <div className="field-row">
        <record.form.Field name="adminArea">
          {(field) => (
            <TextField field={field} label={m.locations_region()} optional maxLength={120} />
          )}
        </record.form.Field>
        <record.form.Field name="countryCode">
          {(field) => (
            <TextField field={field} label={m.locations_country_code()} optional maxLength={2} />
          )}
        </record.form.Field>
      </div>
      <record.form.Field name="notes">
        {(field) => (
          <TextAreaField
            field={field}
            label={m.locations_private_notes_label()}
            optional
            maxLength={2000}
          />
        )}
      </record.form.Field>
      {editingId && (
        <>
          <record.form.Subscribe selector={(state) => state.values.shareAddress}>
            {(inUse) => (
              <AdvancedSection summary={m.sharing_advanced_location_summary()} inUse={inUse}>
                <record.form.Field name="shareAddress">
                  {(field) => (
                    <CheckboxField
                      field={field}
                      label={m.locations_address_sharing_option()}
                      disabled={!canShareAddress && !field.state.value}
                    />
                  )}
                </record.form.Field>
                <p className="help">
                  {canShareAddress
                    ? m.locations_exact_address_shown({
                        address: projectionText(addressPreview),
                      })
                    : m.locations_no_shareable_address_hint()}{" "}
                  {m.locations_country_code_detail()} {record.values.countryCode || "geen"}
                  {m.locations_public_name_inline()} {record.values.label || "geen"}
                  {m.locations_names_separate_suffix()}
                </p>
              </AdvancedSection>
            )}
          </record.form.Subscribe>
          <p className="help">
            <RecipientsText
              state={recipientState}
              recipients={recipients}
              reaches={(names) =>
                m.locations_current_recipients_hint({
                  audiences: names,
                })
              }
              reachesNobody={m.locations_no_recipients_hint}
            />
          </p>
          {pending.length > 0 && (
            <div className="help">
              <p className="m-0">{m.locations_visitor_change_preview()}</p>
              <ul className="m-0">
                {pending.map((field) => (
                  <li key={field}>
                    {m.locations_visitor_change_preview_item({
                      field: visitorFieldLabel(field),
                      audiences: recipients.join(", "),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {movesArea && <p className="help">{m.locations_visitor_change_area_preview()}</p>}
          <p className="help">{m.locations_edit_shared_use_warning()}</p>
        </>
      )}
    </RecordForm>
  );
}
