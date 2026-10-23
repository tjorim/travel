import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useFeedback, textNotice, errorNotice } from "../query/feedback";
import { Button } from "@/ui/button";

import { DateTimeField } from "../forms/DateTimeFields";
import { RecordForm, requiredText, SelectField, TextField } from "../forms/fields";
import { MarkdownField } from "../forms/MarkdownField";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";

import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation } from "../query/owner-queries";
import { Markdown } from "../Markdown";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import {
  localDateTime,
  locationName,
  updateDateLabel,
  type Area,
  type LocationInput,
  type PlaceSearchResult,
  type TravelUpdate,
  type Trip,
  type Visibility,
} from "../tracker-model";
import { VISIBILITY_LABELS, VisibilityControl, visibilityLabel } from "./visibility";
import { PlaceSearchField } from "./PlaceSearchField";

type Values = {
  title: string;
  body: string;
  privateNotes: string;
  occurredAt: string;
  datePrecision: TravelUpdate["date_precision"];
  areaId: string;
  location: LocationInput | null;
  visibility: Visibility;
};
const blank = (): Values => ({
  title: "",
  body: "",
  privateNotes: "",
  occurredAt: localDateTime(),
  datePrecision: "day",
  areaId: "",
  location: null,
  visibility: "private",
});
const fromUpdate = (update: TravelUpdate): Values => ({
  title: update.title,
  body: update.body,
  privateNotes: update.private_notes ?? "",
  occurredAt: localDateTime(new Date(update.occurred_at)),
  datePrecision: update.date_precision,
  areaId: update.location ? "" : (update.area_id ?? ""),
  location: update.location ? { existing_location_id: update.location.id } : null,
  visibility: update.visibility,
});
const serverFields = {
  title: "title",
  body: "body",
  private_notes: "privateNotes",
  occurred_at: "occurredAt",
  date_precision: "datePrecision",
  area_id: "areaId",
  visibility: "visibility",
};

/** Something shared has to have text written for visitors; the private notes are never that text. */
const bodyToShare = ({
  value,
  fieldApi,
}: {
  value: string;
  fieldApi: { form: { getFieldValue: (name: never) => unknown } };
}) =>
  fieldApi.form.getFieldValue("visibility" as never) !== "private" && !value.trim()
    ? m.owner_write_the_text_for_visitors_first_or_choose_private()
    : undefined;

/** Travel updates are embedded in the trip, so every write refreshes the trip list. */
export function TravelUpdateManager({
  trip,
  areas,
  focusId,
}: {
  trip: Trip;
  areas: Area[];
  focusId?: DialogFocusRequest | null;
}) {
  useLocale();
  const dialog = useRecordDialog(trip.travel_updates);
  useDialogFocus(focusId, dialog.inspect);
  const [message, setMessage] = useFeedback<string>(
    textNotice(() => m.owner_a_travel_update_stays_private_until_you_choose_who_may_see_it()),
  );
  const path = tripPath(trip.id, "travel-updates");
  // An update may add a reusable location and its derived area as well as changing the trip's embedded update list.
  const invalidate = (subject: string) => [
    ownerKeys.trips(subject),
    ownerKeys.tripResource(subject, trip.id, "locations"),
    ownerKeys.tripResource(subject, trip.id, "areas"),
  ];

  const save = useOwnerMutation<
    { id: string | null; payload: Record<string, unknown> },
    TravelUpdate
  >({
    fallback: m.owner_the_travel_update_could_not_be_saved,
    request: ({ id, payload }) => ({
      path: id ? `${path}/${id}` : path,
      method: id ? "PATCH" : "POST",
      body: payload,
    }),
    invalidate,
  });
  const remove = useOwnerMutation<TravelUpdate>({
    fallback: m.owner_the_travel_update_could_not_be_deleted,
    request: (item) => ({ path: `${path}/${item.id}`, method: "DELETE" }),
    invalidate,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: m.owner_the_travel_update_could_not_be_saved,
    serverFields,
    submit: async (values) => {
      await save.mutateAsync({
        id: dialog.editingId ?? null,
        payload: {
          occurred_at: new Date(values.occurredAt).toISOString(),
          date_precision: values.datePrecision,
          area_id: values.location ? null : values.areaId || null,
          location: values.location,
          title: values.title.trim(),
          body: values.body.trim(),
          private_notes: values.privateNotes.trim() || null,
          visibility: values.visibility,
        },
      });
    },
    onSuccess: () => {
      close();
      setMessage(textNotice(() => m.owner_travel_update_saved()));
    },
  });

  function close() {
    dialog.close();
    record.load(blank());
  }
  function create() {
    record.load(blank());
    dialog.create();
  }
  function edit(item: TravelUpdate) {
    record.load(fromUpdate(item));
    dialog.edit(item.id);
  }
  function usePlaceResult(result: PlaceSearchResult) {
    record.form.setFieldValue("location", result);
    record.form.setFieldValue("areaId", "");
  }
  function erase(item: TravelUpdate) {
    remove.mutateAsync(item).then(
      () => {
        close();
        setMessage(textNotice(() => m.owner_travel_update_deleted()));
      },
      (error: unknown) => {
        dialog.setConfirmDelete(false);
        dialog.setError(errorNotice(error, m.owner_the_travel_update_could_not_be_deleted));
      },
    );
  }
  const { selected, editing, editingId } = dialog;

  return (
    <section className="travel-card manager" aria-labelledby="updates-title">
      <div className="capture-heading">
        <div>
          <h3 id="updates-title">{m.owner_travel_updates()}</h3>
          <p>
            {m.owner_what_happened_with_a_private_and_a_shared_part_your_notes_location_and_p()}
          </p>
        </div>
        <Button className="secondary compact" type="button" onClick={create}>
          {m.owner_new_update()}
        </Button>
      </div>
      <p className="help" role="status">
        {message}
      </p>
      {trip.travel_updates.length > 0 && (
        <div className="saved-records mt-0.5">
          {trip.travel_updates.map((item) => (
            <article className="excerpt-row" key={item.id}>
              <Button
                className="document-select"
                type="button"
                onClick={() => dialog.inspect(item.id)}
                aria-label={m.owner_view_travel_update({ p0: item.title })}
              >
                <strong>{item.title}</strong>
                <span>
                  {updateDateLabel(item.occurred_at, item.date_precision)} ·{" "}
                  {visibilityLabel(item.visibility)} · {item.area?.label ?? m.owner_no_place()}
                </span>
              </Button>
            </article>
          ))}
        </div>
      )}
      <RecordDialog
        open={editing || selected !== null}
        title={
          editing
            ? editingId
              ? m.owner_edit_travel_update()
              : m.owner_create_travel_update()
            : m.owner_travel_update()
        }
        dirty={editing && record.dirty}
        error={dialog.error}
        onDismiss={close}
      >
        {!editing && selected && (
          <div className="stack-form">
            <div>
              <h3>{selected.title}</h3>
              {selected.body ? (
                <Markdown html={selected.body_html} text={selected.body} />
              ) : (
                <p className="help">{m.owner_no_text_for_visitors_yet()}</p>
              )}
            </div>
            <div>
              <h4>{m.owner_only_for_you()}</h4>
              {selected.private_notes ? (
                <Markdown html={selected.private_notes_html} text={selected.private_notes} />
              ) : (
                <p className="help">{m.owner_no_private_note()}</p>
              )}
              <p className="help">
                {[
                  selected.location
                    ? m.owner_location_2({
                        p0:
                          selected.location.display_name ??
                          selected.location.locality ??
                          m.owner_unnamed_location(),
                      })
                    : null,
                  m.owner_linked_media_count({ count: selected.media_asset_ids.length }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <VisibilityControl
              tripId={trip.id}
              kind="travel_update"
              id={selected.id}
              value={selected.visibility}
              name={selected.title}
            />
            <div className="button-row">
              <Button type="button" onClick={() => edit(selected)}>
                {m.owner_edit()}
              </Button>
              <Button
                className="danger"
                type="button"
                onClick={() => dialog.setConfirmDelete(true)}
              >
                {m.owner_delete()}
              </Button>
            </div>
            {dialog.confirmDelete && (
              <DeleteConfirmation
                title={m.owner_delete_travel_update({ p0: selected.title })}
                onCancel={() => dialog.setConfirmDelete(false)}
                onConfirm={() => erase(selected)}
              />
            )}
          </div>
        )}
        {editing && (
          <RecordForm
            record={record}
            submitLabel={editingId ? m.owner_save_travel_update() : m.owner_create_travel_update()}
            pendingLabel={m.owner_saving()}
          >
            <record.form.Field
              name="title"
              validators={{
                onChange: requiredText(m.owner_give_the_travel_update_a_title),
                onSubmit: requiredText(m.owner_give_the_travel_update_a_title),
              }}
            >
              {(field) => (
                <TextField field={field} label={m.owner_title()} required maxLength={160} />
              )}
            </record.form.Field>
            <record.form.Field
              name="body"
              validators={{
                onChangeListenTo: ["visibility"],
                onChange: bodyToShare,
                onSubmit: bodyToShare,
              }}
            >
              {(field) => (
                <MarkdownField
                  field={field}
                  label={m.owner_text_for_visitors()}
                  optional={m.owner_empty_until_shared()}
                  maxLength={10000}
                  rows={5}
                />
              )}
            </record.form.Field>
            <div className="field-row">
              <record.form.Field
                name="occurredAt"
                validators={{
                  onChange: requiredText(m.owner_enter_the_date_and_time),
                  onSubmit: requiredText(m.owner_enter_the_date_and_time),
                }}
              >
                {(field) => (
                  <DateTimeField field={field} label={m.owner_date_and_time()} required />
                )}
              </record.form.Field>
              <record.form.Field name="datePrecision">
                {(field) => (
                  <SelectField field={field} label={m.owner_date_for_visitors()}>
                    <option value="day">{m.owner_full_date()}</option>
                    <option value="month">{m.owner_month_only()}</option>
                    <option value="year">{m.owner_year_only()}</option>
                  </SelectField>
                )}
              </record.form.Field>
            </div>
            <record.form.Subscribe selector={(state) => state.values.location}>
              {(place) => (
                <>
                  <PlaceSearchField
                    tripId={trip.id}
                    legend={m.owner_location_private()}
                    inputLabel={m.owner_search_for_this_update_s_location()}
                    placeholder={m.owner_for_example_beitou_hot_spring()}
                    help={m.owner_the_location_automatically_determines_the_area_it_stays_private_unless_y()}
                    onSelect={usePlaceResult}
                    allowExisting
                  />
                  {place && (
                    <p className="help">
                      {m.owner_selected_location()} {locationName(place)}{" "}
                      <Button
                        className="compact secondary"
                        type="button"
                        onClick={() => record.form.setFieldValue("location", null)}
                      >
                        {m.owner_clear_location()}
                      </Button>
                    </p>
                  )}
                </>
              )}
            </record.form.Subscribe>
            <div className="field-row">
              <record.form.Field name="areaId">
                {(field) => (
                  <SelectField
                    field={field}
                    label={m.owner_area_without_a_specific_location()}
                    optional
                    disabled={Boolean(record.form.getFieldValue("location"))}
                  >
                    <option value="">{m.owner_no_area()}</option>
                    {areas.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.label}
                      </option>
                    ))}
                  </SelectField>
                )}
              </record.form.Field>
              <record.form.Field name="visibility">
                {(field) => (
                  <SelectField field={field} label={m.owner_visibility()}>
                    {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectField>
                )}
              </record.form.Field>
            </div>
            <record.form.Field name="privateNotes">
              {(field) => (
                <MarkdownField
                  field={field}
                  label={m.owner_private_note()}
                  optional={m.owner_never_shared()}
                  maxLength={10000}
                  rows={4}
                />
              )}
            </record.form.Field>
          </RecordForm>
        )}
      </RecordDialog>
    </section>
  );
}
