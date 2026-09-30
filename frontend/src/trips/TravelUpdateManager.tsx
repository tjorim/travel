import { errorNotice } from "../query/feedback";
import { Button } from "@base-ui/react/button";
import { useState } from "react";

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
    ? "Schrijf eerst de tekst voor bezoekers, of kies “Privé”."
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
  const dialog = useRecordDialog(trip.travel_updates);
  useDialogFocus(focusId, dialog.inspect);
  const [message, setMessage] = useState("Een reisupdate blijft privé totdat je kiest wie hem mag zien.");
  const path = tripPath(trip.id, "travel-updates");
  // An update may add a reusable location and its derived area as well as changing the trip's embedded update list.
  const invalidate = (subject: string) => [
    ownerKeys.trips(subject),
    ownerKeys.tripResource(subject, trip.id, "locations"),
    ownerKeys.tripResource(subject, trip.id, "areas"),
  ];

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, TravelUpdate>({
    fallback: "De reisupdate kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${path}/${id}` : path, method: id ? "PATCH" : "POST", body: payload }),
    invalidate,
  });
  const remove = useOwnerMutation<TravelUpdate>({
    fallback: "De reisupdate kon niet worden verwijderd.",
    request: (item) => ({ path: `${path}/${item.id}`, method: "DELETE" }),
    invalidate,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "De reisupdate kon niet worden opgeslagen.",
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
      setMessage("Reisupdate opgeslagen.");
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
        setMessage("Reisupdate verwijderd.");
      },
      (error: unknown) => {
        dialog.setConfirmDelete(false);
        dialog.setError(errorNotice(error, "De reisupdate kon niet worden verwijderd."));
      },
    );
  }
  const { selected, editing, editingId } = dialog;

  return (
    <section className="travel-card manager" aria-labelledby="updates-title">
      <div className="capture-heading">
        <div>
          <h3 id="updates-title">Reisupdates</h3>
          <p>
            Wat er gebeurde, met een privé- en een gedeeld deel. Je notities, locatie en foto’s blijven altijd privé; de
            titel en de tekst voor bezoekers deel je alleen als je dat kiest.
          </p>
        </div>
        <Button className="secondary compact" type="button" onClick={create}>
          Nieuwe update
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
                aria-label={`Reisupdate ${item.title} bekijken`}
              >
                <strong>{item.title}</strong>
                <span>
                  {updateDateLabel(item.occurred_at, item.date_precision)} · {visibilityLabel(item.visibility)} ·{" "}
                  {item.area?.label ?? "geen plaats"}
                </span>
              </Button>
            </article>
          ))}
        </div>
      )}
      <RecordDialog
        open={editing || selected !== null}
        title={editing ? (editingId ? "Reisupdate bewerken" : "Reisupdate maken") : "Reisupdate"}
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
                <p className="help">Nog geen tekst voor bezoekers.</p>
              )}
            </div>
            <div>
              <h4>Alleen voor jou</h4>
              {selected.private_notes ? (
                <Markdown html={selected.private_notes_html} text={selected.private_notes} />
              ) : (
                <p className="help">Geen privénotitie.</p>
              )}
              <p className="help">
                {[
                  selected.location
                    ? `Locatie: ${selected.location.display_name ?? selected.location.locality ?? "naamloos"}`
                    : null,
                  `${selected.media_asset_ids.length} gekoppelde ${selected.media_asset_ids.length === 1 ? "foto" : "foto’s"}`,
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
                Bewerken
              </Button>
              <Button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>
                Verwijderen
              </Button>
            </div>
            {dialog.confirmDelete && (
              <DeleteConfirmation
                title={`Reisupdate “${selected.title}” verwijderen?`}
                onCancel={() => dialog.setConfirmDelete(false)}
                onConfirm={() => erase(selected)}
              />
            )}
          </div>
        )}
        {editing && (
          <RecordForm
            record={record}
            submitLabel={editingId ? "Reisupdate opslaan" : "Reisupdate maken"}
            pendingLabel="Opslaan…"
          >
            <record.form.Field
              name="title"
              validators={{
                onChange: requiredText("Geef de reisupdate een titel."),
                onSubmit: requiredText("Geef de reisupdate een titel."),
              }}
            >
              {(field) => <TextField field={field} label="Titel" required maxLength={160} />}
            </record.form.Field>
            <record.form.Field
              name="body"
              validators={{ onChangeListenTo: ["visibility"], onChange: bodyToShare, onSubmit: bodyToShare }}
            >
              {(field) => (
                <MarkdownField
                  field={field}
                  label="Tekst voor bezoekers"
                  optional="(leeg zolang je niets deelt)"
                  maxLength={10000}
                  rows={5}
                />
              )}
            </record.form.Field>
            <div className="field-row">
              <record.form.Field
                name="occurredAt"
                validators={{
                  onChange: requiredText("Geef de datum en tijd op."),
                  onSubmit: requiredText("Geef de datum en tijd op."),
                }}
              >
                {(field) => <TextField field={field} label="Datum en tijd" required type="datetime-local" />}
              </record.form.Field>
              <record.form.Field name="datePrecision">
                {(field) => (
                  <SelectField field={field} label="Datum voor bezoekers">
                    <option value="day">Volledige datum</option>
                    <option value="month">Alleen de maand</option>
                    <option value="year">Alleen het jaar</option>
                  </SelectField>
                )}
              </record.form.Field>
            </div>
            <record.form.Subscribe selector={(state) => state.values.location}>
              {(place) => (
                <>
                  <PlaceSearchField
                    tripId={trip.id}
                    legend="Locatie (privé)"
                    inputLabel="Zoek locatie van deze update"
                    placeholder="Bijvoorbeeld: Beitou Hot Spring"
                    help="De locatie bepaalt automatisch het gebied. Hij blijft privé tenzij je hem apart deelt."
                    onSelect={usePlaceResult}
                    allowExisting
                  />
                  {place && (
                    <p className="help">
                      Gekozen locatie: {locationName(place)}{" "}
                      <Button
                        className="compact secondary"
                        type="button"
                        onClick={() => record.form.setFieldValue("location", null)}
                      >
                        Locatie wissen
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
                    label="Gebied zonder specifieke locatie"
                    optional
                    disabled={Boolean(record.form.getFieldValue("location"))}
                  >
                    <option value="">Geen gebied</option>
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
                  <SelectField field={field} label="Zichtbaarheid">
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
                  label="Privénotitie"
                  optional="(nooit gedeeld)"
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
