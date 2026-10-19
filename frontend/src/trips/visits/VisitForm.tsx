import { CheckboxField, SelectField, RecordForm, TextField } from "../../forms/fields";
import { DateField, TimeField } from "../../forms/DateTimeFields";
import { MarkdownField } from "../../forms/MarkdownField";
import type { useRecordForm } from "../../forms/useRecordForm";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { VISIT_KIND_LABELS, VISIT_STATUS_LABELS } from "../labels";
import { PlacePicker } from "../PlacePicker";
import { VisitRouteHint } from "../VisitRouteHint";
import { lastDay, type Values } from "./model";

const PRECISION_LABELS = {
  get day() {
    return m.owner_full_dates();
  },
  get month() {
    return m.owner_months_only();
  },
  get year() {
    return m.owner_year_only();
  },
} as const;

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
      submitLabel={editingId ? m.owner_save_visit() : m.owner_add_visit()}
      pendingLabel={m.owner_saving()}
    >
      <record.form.Field name="place">
        {(field) => (
          <PlacePicker
            tripId={tripId}
            label={m.owner_where()}
            value={field.state.value}
            onChange={(value) => field.handleChange(value)}
          />
        )}
      </record.form.Field>
      <record.form.Field name="title">
        {(field) => (
          <TextField
            field={field}
            label={m.owner_title()}
            optional
            maxLength={160}
            placeholder={m.owner_without_a_title_the_visit_uses_the_place_name()}
          />
        )}
      </record.form.Field>
      <div className="field-row">
        <record.form.Field name="startsOn">
          {(field) => <DateField field={field} label={m.owner_first_day()} optional />}
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
                  label={m.owner_last_day()}
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
                  label={m.owner_start_time()}
                  optional
                  disabled={!startsOn}
                />
              )}
            </record.form.Field>
            <record.form.Field name="endTime">
              {(field) => (
                <TimeField field={field} label={m.owner_end_time()} optional disabled={!startsOn} />
              )}
            </record.form.Field>
          </div>
        )}
      </record.form.Subscribe>
      <p className="help">
        {m.owner_times_are_local_to_the_visit_in_the_area_s_time_zone_visitors_at_home_al()}
      </p>
      <div className="field-row">
        <record.form.Field name="status">
          {(field) => (
            <SelectField field={field} label={m.owner_status()}>
              {Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
          )}
        </record.form.Field>
        <record.form.Field name="kind">
          {(field) => (
            <SelectField field={field} label={m.owner_day_type()} optional>
              <option value="">{m.owner_no_type()}</option>
              {Object.entries(VISIT_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
          )}
        </record.form.Field>
      </div>
      <p className="help">
        {m.owner_the_status_is_only_for_you_and_is_never_shared_put_idea_or_draft_here_ra()}
      </p>
      <record.form.Field name="notes">
        {(field) => (
          <MarkdownField
            field={field}
            label={m.owner_notes()}
            optional={m.owner_optional_always_private()}
            maxLength={4000}
            rows={3}
          />
        )}
      </record.form.Field>
      <record.form.Field name="summary">
        {(field) => (
          <MarkdownField
            field={field}
            label={m.owner_text_for_visitors()}
            optional
            maxLength={2000}
            rows={3}
            placeholder={m.owner_what_may_visitors_read_about_this_visit()}
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
      <div className="field-row">
        <record.form.Field name="shareDatePrecision">
          {(field) => (
            <SelectField field={field} label={m.owner_dates_for_visitors()}>
              {Object.entries(PRECISION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
          )}
        </record.form.Field>
        <record.form.Field name="shareTime">
          {(field) => (
            <CheckboxField
              field={field}
              label={
                <>
                  {m.owner_show_the_time_to_visitors()}{" "}
                  <small>{m.owner_only_with_full_dates()}</small>
                </>
              }
            />
          )}
        </record.form.Field>
      </div>
    </RecordForm>
  );
}
