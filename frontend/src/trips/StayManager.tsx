import { useRef, useState } from "react";

import { RecordForm, requiredText, SelectField, TextField } from "../forms/fields";
import { MarkdownField } from "../forms/MarkdownField";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { Markdown } from "../Markdown";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import {
  addDays,
  daysBetween,
  formatDay,
  stayLabel,
  type Area,
  type LocationInput,
  type PlaceSearchResult,
  type Stay,
  type Trip,
} from "../tracker-model";
import { PlaceSearchField } from "./PlaceSearchField";
import { VisibilityControl, visibilityLabel } from "./visibility";

const STATUS_LABELS: Record<Stay["status"], string> = {
  planned: "Gepland",
  booked: "Geboekt",
  confirmed: "Bevestigd",
  cancelled: "Geannuleerd",
};

/** The archive's hotel states: still choosing, proposed, booked. */
export function stayStateLabel(stay: Stay): string {
  if (stay.status === "planned") return stay.property_name ? "Voorgesteld" : "Nog kiezen";
  return STATUS_LABELS[stay.status];
}

type StayValues = {
  propertyName: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
  status: Stay["status"];
  websiteUrl: string;
  address: string;
  locality: string;
  countryCode: string;
  location: LocationInput | null;
  bookingReference: string;
  contactDetails: string;
  notes: string;
  shareDatePrecision: Stay["share_date_precision"];
};

const blankStay = (trip: Trip): StayValues => {
  const checkIn = trip.starts_on ?? new Date().toISOString().slice(0, 10);
  return {
    propertyName: "",
    checkInDate: checkIn,
    checkOutDate: addDays(checkIn, 1),
    checkInTime: "",
    checkOutTime: "",
    status: "planned",
    websiteUrl: "",
    address: "",
    locality: "",
    countryCode: "",
    location: null,
    bookingReference: "",
    contactDetails: "",
    notes: "",
    shareDatePrecision: "month",
  };
};
const locationInput = (place: Stay["location"]): LocationInput | null => {
  if (!place) return null;
  return { existing_location_id: place.id };
};
const fromStay = (stay: Stay): StayValues => ({
  propertyName: stay.property_name ?? "",
  checkInDate: stay.check_in_date,
  checkOutDate: stay.check_out_date,
  checkInTime: stay.check_in_time?.slice(0, 5) ?? "",
  checkOutTime: stay.check_out_time?.slice(0, 5) ?? "",
  status: stay.status,
  websiteUrl: stay.website_url ?? "",
  address: stay.location?.address_line1 ?? "",
  locality: stay.location?.locality ?? "",
  countryCode: stay.location?.country_code ?? "",
  location: locationInput(stay.location),
  bookingReference: stay.booking_reference ?? "",
  contactDetails: stay.contact_details ?? "",
  notes: stay.notes ?? "",
  shareDatePrecision: stay.share_date_precision,
});

const stayFields = {
  property_name: "propertyName",
  check_in_date: "checkInDate",
  check_out_date: "checkOutDate",
  check_in_time: "checkInTime",
  check_out_time: "checkOutTime",
  status: "status",
  website_url: "websiteUrl",
  booking_reference: "bookingReference",
  contact_details: "contactDetails",
  notes: "notes",
  share_date_precision: "shareDatePrecision",
};
const PLACE_FIELDS = ["propertyName", "address", "locality", "countryCode", "location"] as const;

const checkOutAfterCheckIn = ({
  value,
  fieldApi,
}: {
  value: string;
  fieldApi: { form: { getFieldValue: (name: never) => unknown } };
}) =>
  value && value <= String(fieldApi.form.getFieldValue("checkInDate" as never) ?? "")
    ? "Uitchecken gebeurt ten vroegste de ochtend na de eerste nacht."
    : undefined;
const httpsOnly = ({ value }: { value: string }) =>
  value.trim() && !value.trim().startsWith("https://") ? "Gebruik een https-adres." : undefined;

export function StayManager({ trip, focusId }: { trip: Trip; areas?: Area[]; focusId?: DialogFocusRequest | null }) {
  const staysQuery = useTripResource(trip.id, "stays");
  const stays = staysQuery.data ?? [];
  const stayDialog = useRecordDialog(stays);
  useDialogFocus(focusId, stayDialog.inspect);
  const [message, setMessage] = useState(
    "Een verblijf is privé. Deel je het, dan zien bezoekers alleen de stad of het gebied en de nachten — nooit de accommodatie.",
  );
  const [deleteTarget, setDeleteTarget] = useState<Stay | null>(null);
  // A stay's place is only rewritten when one of its fields differs from what the editor opened with.
  const baseline = useRef<StayValues>(blankStay(trip));

  const saveStay = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, Stay>({
    fallback: "Het verblijf kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({
      path: id ? `${tripPath(trip.id, "stays")}/${id}` : tripPath(trip.id, "stays"),
      method: id ? "PATCH" : "POST",
      body: payload,
    }),
    // Saving a hotel can create or reuse both a location and its derived area.
    invalidate: (subject) => [
      ownerKeys.tripResource(subject, trip.id, "stays"),
      ownerKeys.tripResource(subject, trip.id, "locations"),
      ownerKeys.tripResource(subject, trip.id, "areas"),
    ],
  });
  const deleteStay = useOwnerMutation<Stay>({
    fallback: "Het verblijf kon niet worden verwijderd.",
    request: (stay) => ({ path: `${tripPath(trip.id, "stays")}/${stay.id}`, method: "DELETE" }),
    invalidate: (subject) => [
      ownerKeys.tripResource(subject, trip.id, "stays"),
      ownerKeys.tripResource(subject, trip.id, "locations"),
      ownerKeys.tripResource(subject, trip.id, "areas"),
    ],
  });
  const stayRecord = useRecordForm<StayValues>({
    defaultValues: blankStay(trip),
    fallback: "Het verblijf kon niet worden opgeslagen.",
    serverFields: stayFields,
    submit: async (values) => {
      const propertyName = values.propertyName.trim();
      const hasPlace = Boolean(
        values.location?.existing_location_id || propertyName || values.address.trim() || values.locality.trim(),
      );
      const placeChanged = PLACE_FIELDS.some((name) => values[name] !== baseline.current[name]);
      const id = stayDialog.editingId ?? null;
      if ((!id || placeChanged) && !hasPlace)
        throw new Error("Kies waar je verblijft: zoek een locatie, of vul een adres of plaats in.");
      await saveStay.mutateAsync({
        id,
        payload: {
          property_name: propertyName || null,
          check_in_date: values.checkInDate,
          check_out_date: values.checkOutDate,
          check_in_time: values.checkInTime || null,
          check_out_time: values.checkOutTime || null,
          status: values.status,
          website_url: values.websiteUrl.trim() || null,
          booking_reference: values.bookingReference.trim() || null,
          contact_details: values.contactDetails.trim() || null,
          notes: values.notes.trim() || null,
          share_date_precision: values.shareDatePrecision,
          ...(!id || placeChanged
            ? {
                location: values.location?.existing_location_id
                  ? { existing_location_id: values.location.existing_location_id }
                  : {
                      ...values.location,
                      display_name: propertyName || null,
                      address_line1: values.address.trim() || null,
                      locality: values.locality.trim() || null,
                      country_code: values.countryCode.trim().toUpperCase() || null,
                    },
              }
            : {}),
        },
      });
    },
    onSuccess: () => {
      closeStay();
      setMessage("Privéverblijf opgeslagen.");
    },
  });
  function loadStay(values: StayValues) {
    baseline.current = values;
    stayRecord.load(values);
  }
  function closeStay() {
    stayDialog.close();
    loadStay(blankStay(trip));
  }
  function newStay() {
    loadStay(blankStay(trip));
    stayDialog.create();
  }
  function editStay(stay: Stay) {
    loadStay(fromStay(stay));
    stayDialog.edit(stay.id);
  }
  function usePlaceResult(result: PlaceSearchResult, existingPlace?: Stay["location"]) {
    const place = existingPlace ?? result;
    stayRecord.form.setFieldValue("propertyName", place.display_name ?? "");
    stayRecord.form.setFieldValue("address", place.address_line1 ?? "");
    stayRecord.form.setFieldValue("locality", place.locality ?? "");
    stayRecord.form.setFieldValue("countryCode", place.country_code ?? "");
    stayRecord.form.setFieldValue("location", result);
  }
  function confirmDelete() {
    if (!deleteTarget) return;
    deleteStay.mutateAsync(deleteTarget).then(
      () => {
        closeStay();
        setDeleteTarget(null);
        setMessage("Privéverblijf verwijderd.");
      },
      (error: unknown) => {
        setDeleteTarget(null);
        setMessage(errorMessage(error, "Het verblijf kon niet worden verwijderd."));
      },
    );
  }

  const { selected: selectedStay, editing: editingStay, editingId: editingStayId } = stayDialog;
  const readError = staysQuery.error;

  return (
    <section className="card manager" id="stays" aria-labelledby="stays-title">
      <div className="capture-heading">
        <div>
          <h3 id="stays-title">Verblijven</h3>
          <p>
            Een verblijf is een reeks nachten: inchecken de namiddag van de eerste nacht, uitchecken de ochtend erna.
            Adressen, boekingen en contactgegevens zijn uitsluitend privé.
          </p>
        </div>
        <button className="secondary compact" type="button" onClick={newStay}>
          Nieuw verblijf
        </button>
      </div>
      <p className="help" role="status">
        {readError
          ? errorMessage(readError, "Je verblijven konden niet worden geladen.")
          : staysQuery.isPending
            ? "Laad je private verblijven…"
            : message}
      </p>
      {stays.length > 0 && (
        <div className="saved-records manager-list">
          {stays.map((stay) => {
            const nights = daysBetween(stay.check_in_date, stay.check_out_date);
            return (
              <article className="excerpt-row" key={stay.id}>
                <button className="document-select" type="button" onClick={() => stayDialog.inspect(stay.id)}>
                  <strong>{stayLabel(stay)}</strong>
                  <span>
                    {[
                      stay.area?.label,
                      `${formatDay(stay.check_in_date)} → ${formatDay(stay.check_out_date)}`,
                      `${nights} ${nights === 1 ? "nacht" : "nachten"}`,
                      stayStateLabel(stay),
                      visibilityLabel(stay.visibility),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
                <button className="danger compact" type="button" onClick={() => setDeleteTarget(stay)}>
                  Verwijderen
                </button>
              </article>
            );
          })}
        </div>
      )}
      <RecordDialog
        open={editingStay || selectedStay !== null}
        title={editingStay ? (editingStayId ? "Verblijf bewerken" : "Verblijf toevoegen") : "Verblijf"}
        dirty={editingStay && stayRecord.dirty}
        onDismiss={closeStay}
      >
        {!editingStay && selectedStay && (
          <div className="stack-form">
            <div>
              <h3>{stayLabel(selectedStay)}</h3>
              <p>
                {selectedStay.location?.address_line1}
                {selectedStay.location?.locality ? ` · ${selectedStay.location.locality}` : ""}
              </p>
              <p>
                {selectedStay.booking_reference
                  ? `Boekingsreferentie: ${selectedStay.booking_reference}`
                  : "Geen boekingsreferentie"}
              </p>
              {selectedStay.contact_details && (
                <>
                  <p className="markdown-label">Contact</p>
                  <Markdown html={selectedStay.contact_details_html} text={selectedStay.contact_details} />
                </>
              )}
              <Markdown html={selectedStay.notes_html} text={selectedStay.notes} />
            </div>
            <VisibilityControl
              tripId={trip.id}
              kind="stay"
              id={selectedStay.id}
              value={selectedStay.visibility}
              name={stayLabel(selectedStay)}
            />
            <div className="button-row">
              <button type="button" onClick={() => editStay(selectedStay)}>
                Bewerken
              </button>
              <button className="danger" type="button" onClick={() => setDeleteTarget(selectedStay)}>
                Verwijderen
              </button>
            </div>
          </div>
        )}
        {editingStay && (
          <RecordForm
            record={stayRecord}
            submitLabel={editingStayId ? "Verblijf opslaan" : "Verblijf toevoegen"}
            pendingLabel="Opslaan…"
          >
            <stayRecord.form.Field name="status">
              {(field) => (
                <SelectField field={field} label="Status">
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectField>
              )}
            </stayRecord.form.Field>
            <stayRecord.form.Field name="shareDatePrecision">
              {(field) => (
                <SelectField field={field} label="Datums voor bezoekers">
                  <option value="day">Volledige datums</option>
                  <option value="month">Alleen maanden</option>
                  <option value="year">Alleen het jaar</option>
                </SelectField>
              )}
            </stayRecord.form.Field>
            <stayRecord.form.Field name="propertyName">
              {(field) => (
                <TextField field={field} label="Accommodatie" optional="(leeg zolang je nog kiest)" maxLength={160} />
              )}
            </stayRecord.form.Field>
            <PlaceSearchField
              tripId={trip.id}
              legend="Verblijf zoeken"
              inputLabel="Zoek verblijf of adres"
              placeholder="Bijvoorbeeld: Central Station Hotel"
              help="Een verblijf heeft altijd een locatie: zoek er een, of vul hieronder een adres of plaats in. De locatie bepaalt automatisch het gebied en blijft privé, ook als je het verblijf deelt."
              onSelect={usePlaceResult}
              allowExisting
            />
            <div className="field-row">
              <stayRecord.form.Field
                name="checkInDate"
                validators={{
                  onChange: requiredText("Kies de eerste nacht."),
                  onSubmit: requiredText("Kies de eerste nacht."),
                }}
                listeners={{
                  onChange: ({ value }) => {
                    if (value && String(stayRecord.form.getFieldValue("checkOutDate")) <= value)
                      stayRecord.form.setFieldValue("checkOutDate", addDays(value, 1));
                  },
                }}
              >
                {(field) => <TextField field={field} label="Eerste nacht (inchecken)" required type="date" />}
              </stayRecord.form.Field>
              <stayRecord.form.Field
                name="checkOutDate"
                validators={{
                  onChangeListenTo: ["checkInDate"],
                  onChange: checkOutAfterCheckIn,
                  onSubmit: checkOutAfterCheckIn,
                }}
              >
                {(field) => <TextField field={field} label="Uitchecken (ochtend)" required type="date" />}
              </stayRecord.form.Field>
            </div>
            <stayRecord.form.Subscribe
              selector={(state) => [state.values.checkInDate, state.values.checkOutDate] as const}
            >
              {([checkIn, checkOut]) => {
                const nights = checkIn && checkOut ? daysBetween(checkIn, checkOut) : 0;
                return (
                  <p className="help">
                    {nights > 0
                      ? `${nights} ${nights === 1 ? "nacht" : "nachten"}`
                      : "Kies een uitcheckdatum na de eerste nacht."}{" "}
                    · lokale datums bij het verblijf
                  </p>
                );
              }}
            </stayRecord.form.Subscribe>
            <div className="field-row">
              <stayRecord.form.Field name="checkInTime">
                {(field) => <TextField field={field} label="Inchecktijd" optional type="time" />}
              </stayRecord.form.Field>
              <stayRecord.form.Field name="checkOutTime">
                {(field) => <TextField field={field} label="Uitchecktijd" optional type="time" />}
              </stayRecord.form.Field>
            </div>
            <div className="field-row">
              <stayRecord.form.Field name="address">
                {(field) => <TextField field={field} label="Adres" optional maxLength={160} />}
              </stayRecord.form.Field>
              <stayRecord.form.Field name="locality">
                {(field) => <TextField field={field} label="Plaats" optional maxLength={120} />}
              </stayRecord.form.Field>
            </div>
            <div className="field-row">
              <stayRecord.form.Field name="countryCode">
                {(field) => <TextField field={field} label="Landcode" optional maxLength={2} placeholder="TW" />}
              </stayRecord.form.Field>
              <stayRecord.form.Field name="websiteUrl" validators={{ onBlur: httpsOnly, onSubmit: httpsOnly }}>
                {(field) => (
                  <TextField
                    field={field}
                    label="Website"
                    optional="(optioneel, https)"
                    type="url"
                    maxLength={2048}
                    placeholder="https://"
                  />
                )}
              </stayRecord.form.Field>
            </div>
            <stayRecord.form.Field name="bookingReference">
              {(field) => <TextField field={field} label="Boekingsreferentie" optional maxLength={255} />}
            </stayRecord.form.Field>
            <stayRecord.form.Field name="contactDetails">
              {(field) => (
                <MarkdownField
                  field={field}
                  format="contact"
                  label="Contactgegevens"
                  optional
                  maxLength={2000}
                  rows={3}
                />
              )}
            </stayRecord.form.Field>
            <stayRecord.form.Field name="notes">
              {(field) => <MarkdownField field={field} label="Notities" optional maxLength={4000} rows={3} />}
            </stayRecord.form.Field>
          </RecordForm>
        )}
      </RecordDialog>
      {deleteTarget && (
        <RecordDialog open title="Verwijderen bevestigen" onDismiss={() => setDeleteTarget(null)}>
          <DeleteConfirmation
            title={`“${stayLabel(deleteTarget)}” verwijderen?`}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={confirmDelete}
          />
        </RecordDialog>
      )}
    </section>
  );
}
