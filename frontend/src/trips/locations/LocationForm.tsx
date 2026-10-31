import { areaName } from "../../tracker-model";
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
import type { Area, Location, PlaceSearchResult } from "../../tracker-model";
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
  suggestion: PlaceSearchResult | null;
  areas: Area[];
  addressPreview: Record<string, string | null | undefined>;
  canShareAddress: boolean;
  recipients: string[];
  recipientState: RecipientState;
  onAddArea: () => void;
  onChoose: (result: PlaceSearchResult) => void;
}) {
  useLocale();
  // What this edit would change for the audiences that read the saved location today.
  const pending =
    editingId && selected && recipients.length ? pendingVisitorFields(selected, record.values) : [];
  const movesArea = Boolean(editingId && selected && record.values.areaId !== selected.area_id);
  return (
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
        <Button type="button" className="secondary" onClick={onAddArea}>
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
                {areaName(area)}
              </option>
            ))}
          </SelectField>
        )}
      </record.form.Field>
      {areas.length > 0 && (
        <Button type="button" className="secondary compact" onClick={onAddArea}>
          {m.owner_add_new_area()}
        </Button>
      )}
      {!editingId && (
        <PlaceSearchField
          tripId={tripId}
          legend={m.owner_search_location()}
          inputLabel={m.owner_search_via_openstreetmap()}
          placeholder={m.owner_for_example_brussels_central_station()}
          help={m.owner_a_result_only_fills_in_this_draft_save_creates_the_location()}
          onSelect={onChoose}
        />
      )}
      {(editingId || suggestion) && (
        <>
          <MapTarget
            latitude={editingId ? selected?.latitude : suggestion?.latitude}
            longitude={editingId ? selected?.longitude : suggestion?.longitude}
          />
          <p className="help">
            {m.owner_address_changes_do_not_move_the_saved_map_point_or_navigation_target_the()}
          </p>
        </>
      )}
      <record.form.Field name="displayName">
        {(field) => (
          <TextField field={field} label={m.owner_your_name_2()} optional maxLength={500} />
        )}
      </record.form.Field>
      <record.form.Field name="label">
        {(field) => (
          <TextField field={field} label={m.owner_public_name_2()} optional maxLength={120} />
        )}
      </record.form.Field>
      <div className="field-row">
        <record.form.Field name="addressLine1">
          {(field) => (
            <TextField field={field} label={m.owner_address_line_1()} optional maxLength={160} />
          )}
        </record.form.Field>
        <record.form.Field name="addressLine2">
          {(field) => (
            <TextField field={field} label={m.owner_address_line_2()} optional maxLength={160} />
          )}
        </record.form.Field>
      </div>
      <div className="field-row">
        <record.form.Field name="postalCode">
          {(field) => (
            <TextField field={field} label={m.owner_postal_code()} optional maxLength={20} />
          )}
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
          {(field) => (
            <TextField field={field} label={m.owner_country_code()} optional maxLength={2} />
          )}
        </record.form.Field>
      </div>
      <record.form.Field name="notes">
        {(field) => (
          <TextAreaField
            field={field}
            label={m.owner_private_notes_2()}
            optional
            maxLength={2000}
          />
        )}
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
            <RecipientsText
              state={recipientState}
              recipients={recipients}
              reaches={(names) =>
                m.owner_current_recipients_a_saved_address_change_appears_immediately_for_them_w({
                  p0: names,
                })
              }
              reachesNobody={
                m.owner_this_location_currently_reaches_no_visitors_address_sharing_alone_does_n
              }
            />
          </p>
          {pending.length > 0 && (
            <div className="help">
              <p className="m-0">{m.owner_visitor_change_preview()}</p>
              <ul className="m-0">
                {pending.map((field) => (
                  <li key={field}>
                    {m.owner_visitor_change_preview_item({
                      p0: visitorFieldLabel(field),
                      p1: recipients.join(", "),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {movesArea && <p className="help">{m.owner_visitor_change_area_preview()}</p>}
          <p className="help">
            {m.owner_changing_this_reusable_location_affects_all_linked_visits_stays_routes_a()}
          </p>
        </>
      )}
    </RecordForm>
  );
}
