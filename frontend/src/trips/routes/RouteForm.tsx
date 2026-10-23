import { Collapsible } from "@/ui/collapsible";

import { DateField, DateTimeField } from "../../forms/DateTimeFields";
import {
  RecordForm,
  SelectField,
  TextAreaField,
  TextField,
  TimeZoneField,
} from "../../forms/fields";
import { MarkdownField } from "../../forms/MarkdownField";
import type { useRecordForm } from "../../forms/useRecordForm";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import {
  ROUTE_MODE_LABELS,
  type Area,
  type DocumentAsset,
  type Location,
} from "../../tracker-model";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { ROUTE_STATUS_LABELS } from "../labels";
import { PlacePicker } from "../PlacePicker";
import { RouteGeometryEditor } from "../RouteGeometryEditor";
import {
  areaPoint,
  arrivalChosen,
  departureChosen,
  editableCoordinates,
  validCoordinates,
  type Values,
} from "./model";
import { IdeaNote } from "../IdeaNote";

/** The route editor's fields; the booking details disclosure and the line editor keep their own state. */
export function RouteForm({
  tripId,
  record,
  editingId,
  bookingOpen,
  onBookingOpenChange,
  areas,
  locations,
  documents,
}: {
  tripId: string;
  record: ReturnType<typeof useRecordForm<Values>>;
  editingId: string | null | undefined;
  bookingOpen: boolean;
  onBookingOpenChange: (open: boolean) => void;
  areas: Area[];
  locations: Location[];
  documents: DocumentAsset[];
}) {
  useLocale();
  return (
    <RecordForm
      record={record}
      submitLabel={editingId ? m.owner_save_route() : m.owner_add_route()}
      pendingLabel={m.owner_saving()}
    >
      <div className="field-row">
        <record.form.Field name="mode">
          {(input) => (
            <SelectField field={input} label={m.owner_transport()}>
              {Object.entries(ROUTE_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
          )}
        </record.form.Field>
        <record.form.Field name="status">
          {(input) => (
            <SelectField field={input} label={m.owner_status()}>
              {Object.entries(ROUTE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
          )}
        </record.form.Field>
      </div>
      <record.form.Subscribe selector={(state) => state.values.status}>
        {(status) => status === "idea" && <IdeaNote kind="route" />}
      </record.form.Subscribe>
      <record.form.Field name="label">
        {(input) => (
          <TextField
            field={input}
            label={m.owner_name()}
            optional
            maxLength={160}
            placeholder={m.owner_without_a_name_the_route_is_called_departure_arrival()}
          />
        )}
      </record.form.Field>
      <record.form.Field name="departure" validators={{ onSubmit: departureChosen }}>
        {(input) => (
          <PlacePicker
            tripId={tripId}
            label={m.owner_departure()}
            value={input.state.value}
            onChange={(value) => input.handleChange(value)}
            error={input.state.meta.errors
              .map((error) => (typeof error === "function" ? error() : error))
              .find((error) => typeof error === "string")}
          />
        )}
      </record.form.Field>
      <record.form.Field name="arrival" validators={{ onSubmit: arrivalChosen }}>
        {(input) => (
          <PlacePicker
            tripId={tripId}
            label={m.owner_arrival()}
            value={input.state.value}
            onChange={(value) => input.handleChange(value)}
            error={input.state.meta.errors
              .map((error) => (typeof error === "function" ? error() : error))
              .find((error) => typeof error === "string")}
          />
        )}
      </record.form.Field>
      <record.form.Field name="departsOn">
        {(input) => <DateField field={input} label={m.owner_departure_day()} optional />}
      </record.form.Field>
      <FieldSet className="grid gap-3">
        <FieldLegend>
          {m.owner_times()}{" "}
          <span className="font-medium text-travel-optional">
            {m.owner_optional_once_you_choose_a_connection()}
          </span>
        </FieldLegend>
        <div className="field-row">
          <record.form.Field name="departsAt">
            {(input) => (
              <DateTimeField field={input} label={m.owner_departure_time_local()} optional />
            )}
          </record.form.Field>
          <record.form.Field name="departureTimezone">
            {(input) => (
              <TimeZoneField
                field={input}
                label={m.owner_departure_time_zone()}
                optional
                maxLength={64}
                placeholder="Europe/Amsterdam"
              />
            )}
          </record.form.Field>
        </div>
        <div className="field-row">
          <record.form.Field name="arrivesAt">
            {(input) => (
              <DateTimeField field={input} label={m.owner_arrival_time_local()} optional />
            )}
          </record.form.Field>
          <record.form.Field name="arrivalTimezone">
            {(input) => (
              <TimeZoneField
                field={input}
                label={m.owner_arrival_time_zone()}
                optional
                maxLength={64}
                placeholder="Asia/Taipei"
              />
            )}
          </record.form.Field>
        </div>
      </FieldSet>
      <Collapsible.Root open={bookingOpen} onOpenChange={onBookingOpenChange}>
        <Collapsible.Trigger className="disclosure-trigger">
          {m.owner_booking_details_optional_private()}
        </Collapsible.Trigger>
        <Collapsible.Panel keepMounted className="mt-2.5 grid gap-3">
          <div className="field-row">
            <record.form.Field name="carrier">
              {(input) => (
                <TextField
                  field={input}
                  label={m.owner_carrier()}
                  optional
                  maxLength={160}
                  placeholder={m.owner_for_example_eva_air()}
                />
              )}
            </record.form.Field>
            <record.form.Field name="serviceReference">
              {(input) => (
                <TextField
                  field={input}
                  label={m.owner_flight_service_number()}
                  optional
                  maxLength={40}
                  placeholder="BR-087"
                />
              )}
            </record.form.Field>
          </div>
          <record.form.Field name="travelClass">
            {(input) => (
              <TextField
                field={input}
                label={m.owner_travel_class()}
                optional
                maxLength={80}
                placeholder={m.owner_for_example_premium_economy()}
              />
            )}
          </record.form.Field>
          <record.form.Field name="bookingReference">
            {(input) => (
              <TextField
                field={input}
                label={m.owner_booking_reference_3()}
                optional
                maxLength={255}
              />
            )}
          </record.form.Field>
          <record.form.Field name="notes">
            {(input) => (
              <MarkdownField
                field={input}
                label={m.owner_notes()}
                optional
                maxLength={4000}
                rows={3}
              />
            )}
          </record.form.Field>
          {documents.length > 0 && (
            <record.form.Field name="documentAssetIds">
              {(input) => (
                <FieldSet className="grid gap-2">
                  <FieldLegend>
                    {m.owner_linked_documents()}{" "}
                    <span className="font-medium text-travel-optional">{m.owner_optional()}</span>
                  </FieldLegend>
                  {documents.map((document) => (
                    <Field className="contents" key={document.id}>
                      <FieldLabel className="flex items-center gap-2 rounded-lg border border-travel-divider bg-travel-surface px-2.75 py-2.5 font-semibold">
                        <TravelCheckbox
                          checked={input.state.value.includes(document.id)}
                          onCheckedChange={() =>
                            input.handleChange(
                              input.state.value.includes(document.id)
                                ? input.state.value.filter((id) => id !== document.id)
                                : [...input.state.value, document.id],
                            )
                          }
                        />
                        {document.title}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldSet>
              )}
            </record.form.Field>
          )}
        </Collapsible.Panel>
      </Collapsible.Root>
      <record.form.Field
        name="coordinates"
        validators={{ onBlur: validCoordinates, onSubmit: validCoordinates }}
      >
        {(input) => (
          <FieldSet>
            <FieldLegend>
              {m.owner_line_on_the_map()}{" "}
              <span className="font-medium text-travel-optional">{m.owner_optional()}</span>
            </FieldLegend>
            <RouteGeometryEditor
              coordinates={editableCoordinates(input.state.value)}
              onChange={(coordinates) =>
                input.handleChange(coordinates.length ? JSON.stringify(coordinates) : "")
              }
              suggestions={[
                ...areaPoint(record.form.state.values.departure, areas, locations),
                ...areaPoint(record.form.state.values.arrival, areas, locations),
              ]}
            />
            <Collapsible.Root className="border-t border-travel-divider pt-2.5">
              <Collapsible.Trigger className="disclosure-trigger">
                {m.owner_advanced_paste_coordinates_as_json()}
              </Collapsible.Trigger>
              <Collapsible.Panel keepMounted className="mt-2.5">
                <TextAreaField
                  field={input}
                  label={m.owner_line_coordinates_json()}
                  optional
                  placeholder="[[121.5,25.0],[121.6,25.1]]"
                />
              </Collapsible.Panel>
            </Collapsible.Root>
          </FieldSet>
        )}
      </record.form.Field>
    </RecordForm>
  );
}
