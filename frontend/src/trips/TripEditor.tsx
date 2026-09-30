import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { textNotice, errorNotice, useFeedback } from "../query/feedback";
import { Button } from "@base-ui/react/button";
import { useState } from "react";

import { DateField } from "../forms/DateTimeFields";
import { RecordForm, requiredText, TextField } from "../forms/fields";
import { MarkdownField } from "../forms/MarkdownField";
import { useRecordForm } from "../forms/useRecordForm";
import { ownerKeys } from "../query/keys";

import { useOwnerMutation, useRefreshTrip } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import type { Trip } from "../tracker-model";

type Values = { title: string; summary: string; startsOn: string; endsOn: string };

const blank = (): Values => ({ title: "", summary: "", startsOn: "", endsOn: "" });
const fromTrip = (trip: Trip): Values => ({
  title: trip.title,
  summary: trip.summary ?? "",
  startsOn: trip.starts_on ?? "",
  endsOn: trip.ends_on ?? "",
});
const serverFields = { title: "title", summary: "summary", starts_on: "startsOn", ends_on: "endsOn" };

/**
 * Creates or edits one trip in a dialog. Mount it with `key={trip?.id ?? "new"}`:
 * the form starts from that record and treats the last saved values as clean.
 */
export function TripEditor({
  trip,
  open,
  onClose,
  onSaved,
  onDeleted,
  onNotice,
}: {
  trip: Trip | null;
  open: boolean;
  onClose: () => void;
  onSaved: (saved: Trip, created: boolean) => void;
  onDeleted: () => void;
  onNotice: (message: string | import("../query/feedback").MessageNotice) => void;
}) {
  useLocale();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useFeedback<string | null>(null);
  const refresh = useRefreshTrip();
  const save = useOwnerMutation<Values, Trip>({
    fallback: m.owner_the_trip_could_not_be_saved,
    request: (values) => {
      const details = {
        title: values.title.trim(),
        summary: values.summary.trim() || null,
        starts_on: values.startsOn || null,
        ends_on: values.endsOn || null,
      };
      return trip
        ? { path: `/api/trips/${encodeURIComponent(trip.id)}`, method: "PATCH", body: details }
        : { path: "/api/trips", method: "POST", body: details };
    },
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });
  const remove = useOwnerMutation<Trip>({
    fallback: m.owner_the_trip_could_not_be_deleted,
    request: (target) => ({ path: `/api/trips/${encodeURIComponent(target.id)}`, method: "DELETE" }),
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });

  const record = useRecordForm<Values, Trip>({
    defaultValues: trip ? fromTrip(trip) : blank(),
    fallback: m.owner_the_trip_could_not_be_saved,
    serverFields,
    submit: (values) => save.mutateAsync(values),
    onSuccess: (saved) => {
      close();
      onSaved(saved, !trip);
      onNotice(textNotice(() => (trip ? m.owner_trip_saved() : m.owner_private_trip_created())));
    },
  });
  const { form } = record;
  function close() {
    setConfirmDelete(false);
    setDeleteError(null);
    record.load(trip ? fromTrip(trip) : blank());
    onClose();
  }

  function deleteTrip(target: Trip) {
    remove.mutateAsync(target).then(
      () => {
        refresh.forget(target.id);
        close();
        onDeleted();
        onNotice(textNotice(() => m.owner_trip_deleted()));
      },
      (error: unknown) => {
        setConfirmDelete(false);
        setDeleteError(errorNotice(error, m.owner_the_trip_could_not_be_deleted));
      },
    );
  }

  return (
    <RecordDialog
      open={open}
      title={trip ? m.owner_trip_details() : m.owner_new_trip()}
      dirty={open && record.dirty}
      error={deleteError}
      onDismiss={close}
    >
      {open && (
        <RecordForm
          record={record}
          submitLabel={trip ? m.owner_save_trip() : m.owner_create_trip()}
          pendingLabel={trip ? m.owner_saving_trip() : m.owner_creating_trip()}
          actions={
            trip && (
              <Button className="danger compact" type="button" onClick={() => setConfirmDelete(true)}>
                {m.owner_delete_trip()}
              </Button>
            )
          }
        >
          <form.Field
            name="title"
            validators={{
              onChange: requiredText(m.owner_give_the_trip_a_title),
              onSubmit: requiredText(m.owner_give_the_trip_a_title),
            }}
          >
            {(field) => <TextField field={field} label={m.owner_title()} required maxLength={160} />}
          </form.Field>
          <form.Field name="summary">
            {(field) => <MarkdownField field={field} label={m.owner_summary()} optional maxLength={4000} rows={4} />}
          </form.Field>
          <div className="field-row">
            <form.Field name="startsOn">
              {(field) => <DateField field={field} label={m.owner_first_travel_day()} optional />}
            </form.Field>
            <form.Field
              name="endsOn"
              validators={{
                onChangeListenTo: ["startsOn"],
                onChange: ({ value, fieldApi }) =>
                  value && value < fieldApi.form.getFieldValue("startsOn")
                    ? m.owner_the_last_travel_day_is_before_the_first()
                    : undefined,
                onSubmit: ({ value, fieldApi }) =>
                  value && value < fieldApi.form.getFieldValue("startsOn")
                    ? m.owner_the_last_travel_day_is_before_the_first()
                    : undefined,
              }}
            >
              {(field) => <DateField field={field} label={m.owner_last_travel_day()} optional />}
            </form.Field>
          </div>
        </RecordForm>
      )}
      {open && confirmDelete && trip && (
        <DeleteConfirmation
          title={m.owner_delete_2({ p0: trip.title })}
          description={m.owner_all_private_content_of_this_trip_will_be_deleted_this_action_cannot_be_u()}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => deleteTrip(trip)}
        />
      )}
    </RecordDialog>
  );
}
