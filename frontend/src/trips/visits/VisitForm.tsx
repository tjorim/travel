import { AdvancedSection } from "../../forms/AdvancedSection";
import { CheckboxField, SelectField, RecordForm, TextField } from "../../forms/fields";
import { DateField, TimeField } from "../../forms/DateTimeFields";
import { MarkdownField } from "../../forms/MarkdownField";
import type { useRecordForm } from "../../forms/useRecordForm";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { VISIT_KIND_LABELS, PLANNING_STATUS_LABELS } from "../labels";
import { PlacePicker } from "../PlacePicker";
import { recordPrecisionOptions } from "../record-precision";
import { VisitRouteHint } from "../VisitRouteHint";
import { lastDay, type Values } from "./model";

/** The visit editor's fields. */
export function VisitForm({
  tripId,
  record,
  editingId,
}: {
  tripId: string;
  record: ReturnType<typeof useRecordForm<Values>>;
  editingId: string | null | undefined;
}) {
  useLocale();
  return (
    <RecordForm
      record={record}
      submitLabel={editingId ? m.visits_save_visit() : m.visits_add_visit()}
      pendingLabel={m.common_saving()}
    >
      <record.form.Field name="place">
        {(field) => (
          <PlacePicker
            tripId={tripId}
            label={m.visits_where()}
            value={field.state.value}
            onChange={(value) => field.handleChange(value)}
          />
        )}
      </record.form.Field>
      <record.form.Field name="title">
        {(field) => (
          <TextField
            field={field}
            label={m.common_title()}
            optional
            maxLength={160}
            placeholder={m.visits_without_a_title_the_visit_uses_the_place_name()}
          />
        )}
      </record.form.Field>
      <div className="field-row">
        <record.form.Field name="startsOn">
          {(field) => <DateField field={field} label={m.visits_first_day()} optional />}
        </record.form.Field>
        <record.form.Subscribe selector={(state) => state.values.startsOn}>
          {(startsOn) => (
            <record.form.Field
              name="endsOn"
              validators={{
                onChangeListenTo: ["startsOn"],
                onChange: lastDay,
                onSubmit: lastDay,
              }}
            >
              {(field) => (
                <DateField
                  field={field}
                  label={m.visits_last_day()}
                  optional
                  min={startsOn || undefined}
                  disabled={!startsOn}
                />
              )}
            </record.form.Field>
          )}
        </record.form.Subscribe>
      </div>
      <record.form.Subscribe selector={(state) => state.values.startsOn}>
        {(startsOn) => (
          <div className="field-row">
            <record.form.Field name="startTime">
              {(field) => (
                <TimeField
                  field={field}
                  label={m.visits_start_time()}
                  optional
                  disabled={!startsOn}
                />
              )}
            </record.form.Field>
            <record.form.Field name="endTime">
              {(field) => (
                <TimeField
                  field={field}
                  label={m.visits_end_time()}
                  optional
                  disabled={!startsOn}
                />
              )}
            </record.form.Field>
          </div>
        )}
      </record.form.Subscribe>
      <p className="help">{m.visits_time_zone_hint()}</p>
      <div className="field-row">
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
        <record.form.Field name="kind">
          {(field) => (
            <SelectField field={field} label={m.visits_day_type()} optional>
              <option value="">{m.visits_no_type()}</option>
              {Object.entries(VISIT_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
          )}
        </record.form.Field>
      </div>
      <p className="help">{m.visits_status_private_hint()}</p>
      <record.form.Field name="notes">
        {(field) => (
          <MarkdownField
            field={field}
            label={m.common_notes()}
            optional={m.visits_optional_always_private()}
            maxLength={4000}
            rows={3}
          />
        )}
      </record.form.Field>
      <record.form.Field name="summary">
        {(field) => (
          <MarkdownField
            field={field}
            label={m.common_text_for_visitors()}
            optional
            maxLength={2000}
            rows={3}
            placeholder={m.visits_what_may_visitors_read_about_this_visit()}
          />
        )}
      </record.form.Field>
      <record.form.Subscribe
        selector={(state) => ({
          place: state.values.place,
          title: state.values.title,
          summary: state.values.summary,
          startsOn: state.values.startsOn,
          endsOn: state.values.endsOn,
        })}
      >
        {(draft) => <VisitRouteHint tripId={tripId} draft={draft} />}
      </record.form.Subscribe>
      <record.form.Subscribe
        selector={(state) => state.values.shareTime || state.values.shareDatePrecision !== ""}
      >
        {(inUse) => (
          <AdvancedSection summary={m.sharing_advanced_visit_summary()} inUse={inUse}>
            <div className="field-row">
              <record.form.Field name="shareDatePrecision">
                {(field) => (
                  <SelectField field={field} label={m.common_dates_for_visitors()}>
                    {recordPrecisionOptions()}
                  </SelectField>
                )}
              </record.form.Field>
              <record.form.Field name="shareTime">
                {(field) => (
                  <CheckboxField
                    field={field}
                    label={
                      <>
                        {m.visits_show_the_time_to_visitors()}{" "}
                        <small>{m.visits_only_with_full_dates()}</small>
                      </>
                    }
                  />
                )}
              </record.form.Field>
            </div>
            <p className="help">{m.precision_record_help()}</p>
          </AdvancedSection>
        )}
      </record.form.Subscribe>
    </RecordForm>
  );
}
