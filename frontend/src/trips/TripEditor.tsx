import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { textNotice, errorNotice, useFeedback } from "../query/feedback";
import { Button } from "@/ui/button";
import { useEffect, useState } from "react";

import { DateField } from "../forms/DateTimeFields";
import { RecordForm } from "../forms/fields";
import { LocalizedField } from "../forms/LocalizedField";
import { useRecordForm } from "../forms/useRecordForm";
import { ownerKeys } from "../query/keys";

import { useOwnerMutation, useRefreshTrip } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { interfaceLanguage } from "../content-language";
import { TripExport } from "./TripExport";
import { TripLanguage } from "./TripLanguage";
import type { Trip } from "../api-types";

type Values = {
  titleNl: string;
  titleEn: string;
  summaryNl: string;
  summaryEn: string;
  startsOn: string;
  endsOn: string;
};

const blank = (): Values => ({
  titleNl: "",
  titleEn: "",
  summaryNl: "",
  summaryEn: "",
  startsOn: "",
  endsOn: "",
});
const fromTrip = (trip: Trip): Values => ({
  titleNl: trip.title_nl ?? "",
  titleEn: trip.title_en ?? "",
  summaryNl: trip.summary_nl ?? "",
  summaryEn: trip.summary_en ?? "",
  startsOn: trip.starts_on ?? "",
  endsOn: trip.ends_on ?? "",
});
const serverFields = {
  title: "titleNl",
  title_nl: "titleNl",
  title_en: "titleEn",
  summary: "summaryNl",
  summary_nl: "summaryNl",
  summary_en: "summaryEn",
  starts_on: "startsOn",
  ends_on: "endsOn",
};

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
  // The details are held while the language change saves: it reloads them, which would drop what was typed meanwhile.
  const [changingLanguage, setChangingLanguage] = useState(false);
  // A new trip is written in the language the owner opened the dialog in; switching the interface language while
  // typing does not move what was typed to another version of the field.
  const [creationLanguage, setCreationLanguage] = useState(interfaceLanguage);
  useEffect(() => {
    if (open && !trip) setCreationLanguage(interfaceLanguage());
  }, [open, trip]);
  const save = useOwnerMutation<Values, Trip>({
    fallback: m.trips_the_trip_could_not_be_saved,
    request: (values) => {
      const details = {
        title_nl: values.titleNl.trim() || null,
        title_en: values.titleEn.trim() || null,
        summary_nl: values.summaryNl.trim() || null,
        summary_en: values.summaryEn.trim() || null,
        starts_on: values.startsOn || null,
        ends_on: values.endsOn || null,
      };
      return trip
        ? { path: `/api/trips/${encodeURIComponent(trip.id)}`, method: "PATCH", body: details }
        : {
            path: "/api/trips",
            method: "POST",
            // A new trip is written in the language the owner is using the app in.
            body: { ...details, content_language: creationLanguage },
          };
    },
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });
  const remove = useOwnerMutation<Trip>({
    fallback: m.trips_the_trip_could_not_be_deleted,
    request: (target) => ({
      path: `/api/trips/${encodeURIComponent(target.id)}`,
      method: "DELETE",
    }),
    invalidate: (subject) => [ownerKeys.trips(subject)],
  });

  const record = useRecordForm<Values, Trip>({
    defaultValues: trip ? fromTrip(trip) : blank(),
    fallback: m.trips_the_trip_could_not_be_saved,
    serverFields,
    submit: (values) => save.mutateAsync(values),
    onSuccess: (saved) => {
      close();
      onSaved(saved, !trip);
      onNotice(textNotice(() => (trip ? m.trips_trip_saved() : m.trips_private_trip_created())));
    },
  });
  const { form } = record;
  const language = trip?.content_language ?? creationLanguage;
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
        onNotice(textNotice(() => m.trips_trip_deleted()));
      },
      (error: unknown) => {
        setConfirmDelete(false);
        setDeleteError(errorNotice(error, m.trips_the_trip_could_not_be_deleted));
      },
    );
  }

  return (
    <RecordDialog
      open={open}
      title={trip ? m.trips_trip_details() : m.trips_new_trip()}
      dirty={open && record.dirty}
      error={deleteError}
      onDismiss={close}
    >
      {open && (
        <RecordForm
          record={{ ...record, pending: record.pending || changingLanguage }}
          submitLabel={trip ? m.trips_save_trip() : m.trips_create_trip()}
          pendingLabel={trip ? m.trips_saving_trip() : m.trips_creating_trip()}
          actions={
            trip && (
              <Button
                className="danger compact"
                type="button"
                onClick={() => setConfirmDelete(true)}
              >
                {m.trips_delete_trip()}
              </Button>
            )
          }
        >
          <LocalizedField
            form={form}
            name="title"
            label={m.common_title()}
            language={language}
            required
            requiredMessage={m.trips_give_the_trip_a_title}
            maxLength={160}
          />
          <LocalizedField
            form={form}
            name="summary"
            kind="markdown"
            label={m.common_summary()}
            language={language}
            optional
            maxLength={4000}
            rows={4}
          />
          <div className="field-row">
            <form.Field name="startsOn">
              {(field) => <DateField field={field} label={m.trips_first_travel_day()} optional />}
            </form.Field>
            <form.Field
              name="endsOn"
              validators={{
                onChangeListenTo: ["startsOn"],
                onChange: ({ value, fieldApi }) =>
                  value && value < fieldApi.form.getFieldValue("startsOn")
                    ? m.trips_the_last_travel_day_is_before_the_first()
                    : undefined,
                onSubmit: ({ value, fieldApi }) =>
                  value && value < fieldApi.form.getFieldValue("startsOn")
                    ? m.trips_the_last_travel_day_is_before_the_first()
                    : undefined,
              }}
            >
              {(field) => <DateField field={field} label={m.trips_last_travel_day()} optional />}
            </form.Field>
          </div>
        </RecordForm>
      )}
      {open && trip && (
        <TripLanguage
          trip={trip}
          dirty={record.dirty}
          onPending={setChangingLanguage}
          onChanged={(saved) => {
            record.load(fromTrip(saved));
            onSaved(saved, false);
            onNotice(textNotice(() => m.trips_content_language_changed()));
          }}
        />
      )}
      {open && trip && <TripExport tripId={trip.id} onNotice={onNotice} />}
      {open && confirmDelete && trip && (
        <DeleteConfirmation
          title={m.common_delete_confirm_title({ name: trip.title })}
          description={m.trips_delete_description()}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => deleteTrip(trip)}
        />
      )}
    </RecordDialog>
  );
}
