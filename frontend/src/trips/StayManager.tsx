import { Button } from "@/ui/button";
import { useRef, useState } from "react";

import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorMessage } from "../query/api";
import { errorNotice, textNotice, useFeedback } from "../query/feedback";
import { useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import {
  addDays,
  formatDay,
  stayInPlan,
  stayLabel,
  type Area,
  type Stay,
  type Trip,
} from "../tracker-model";
import {
  blankStay,
  fromStay,
  locationLine,
  overlaps,
  placeChanged,
  PLACE_REQUIRED,
  stayFields,
  type StayValues,
} from "./stays/model";
import { StayDetails } from "./stays/StayDetails";
import { StayForm } from "./stays/StayForm";
import { StayList } from "./stays/StayList";
import { useStayMutations } from "./stays/use-stay-mutations";

export function StayManager({
  trip,
  focusId,
}: {
  trip: Trip;
  areas?: Area[];
  focusId?: DialogFocusRequest | null;
}) {
  useLocale();
  const staysQuery = useTripResource(trip.id, "stays");
  const stays = staysQuery.data ?? [];
  const stayDialog = useRecordDialog(stays);
  useDialogFocus(focusId, stayDialog.inspect);
  const [message, setMessage] = useFeedback<string>(
    textNotice(() =>
      m.owner_a_stay_is_private_if_you_share_it_visitors_only_see_the_city_or_area_and(),
    ),
  );
  const [deleteTarget, setDeleteTarget] = useState<Stay | null>(null);
  // A stay's place is only rewritten when one of its fields differs from what the editor opened with.
  const baseline = useRef<StayValues>(blankStay(trip));

  const { save: saveStay, remove: deleteStay } = useStayMutations(trip.id);

  async function cancelAlternatives(alternatives: Stay[]) {
    try {
      for (const alternative of alternatives)
        await saveStay.mutateAsync({ id: alternative.id, payload: { status: "cancelled" } });
      stayDialog.close();
      setMessage(textNotice(() => m.owner_stay_alternatives_cancelled()));
    } catch (error) {
      stayDialog.setError(errorNotice(error, m.owner_the_stay_could_not_be_saved));
    }
  }
  // A quick change of length for a stay that is still a plan: the check-out moves, nothing else is touched.
  async function adjustNights(stay: Stay, delta: -1 | 1) {
    const checkOut = addDays(stay.check_out_date, delta);
    try {
      await saveStay.mutateAsync({ id: stay.id, payload: { check_out_date: checkOut } });
      setMessage(
        textNotice(() =>
          m.owner_stay_dates_changed({
            dates: `${formatDay(stay.check_in_date)} → ${formatDay(checkOut)}`,
          }),
        ),
      );
    } catch (error) {
      setMessage(errorNotice(error, m.owner_the_stay_could_not_be_saved));
    }
  }
  const stayRecord = useRecordForm<StayValues>({
    defaultValues: blankStay(trip),
    fallback: m.owner_the_stay_could_not_be_saved,
    serverFields: stayFields,
    submit: async (values) => {
      const propertyName = values.propertyName.trim();
      const changed = placeChanged(values, baseline.current);
      const id = stayDialog.editingId ?? null;
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
          ...(!id || changed
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
      setMessage(textNotice(() => m.owner_private_stay_saved()));
    },
  });
  // Only a new stay, or one whose place fields were edited, needs a place to send; the message sits on the Plaats field.
  function placeRequired({ fieldApi }: { fieldApi: { form: { state: { values: StayValues } } } }) {
    const values = fieldApi.form.state.values;
    const hasPlace = Boolean(
      values.location?.existing_location_id ||
      values.propertyName.trim() ||
      values.address.trim() ||
      values.locality.trim(),
    );
    const changed = placeChanged(values, baseline.current);
    return (!stayDialog.editingId || changed) && !hasPlace ? PLACE_REQUIRED : undefined;
  }
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
  function confirmDelete() {
    if (!deleteTarget) return;
    deleteStay.mutateAsync(deleteTarget).then(
      () => {
        closeStay();
        setDeleteTarget(null);
        setMessage(textNotice(() => m.owner_private_stay_deleted()));
      },
      (error: unknown) => {
        setDeleteTarget(null);
        stayDialog.setError(errorNotice(error, m.owner_the_stay_could_not_be_deleted));
      },
    );
  }

  const { selected: selectedStay, editing: editingStay, editingId: editingStayId } = stayDialog;
  const readError = staysQuery.error;
  // Once a stay is chosen, the ideas for its nights are the rejected alternatives.
  const alternatives =
    selectedStay && stayInPlan(selectedStay)
      ? stays.filter(
          (other) =>
            other.status === "idea" &&
            overlaps(other, selectedStay.check_in_date, selectedStay.check_out_date),
        )
      : [];
  const currentPlace = locationLine(stays.find((stay) => stay.id === editingStayId)?.location);

  return (
    <section className="travel-card manager" aria-labelledby="stays-title">
      <div className="capture-heading">
        <div>
          <h3 id="stays-title">{m.owner_stays()}</h3>
          <p>{m.owner_a_stay_is_a_series_of_nights_check_in_during_the_afternoon_of_the_first()}</p>
        </div>
        <Button className="secondary compact" type="button" onClick={newStay}>
          {m.owner_new_stay()}
        </Button>
      </div>
      <p className="help" role="status">
        {readError
          ? errorMessage(readError, m.owner_your_stays_could_not_be_loaded)
          : staysQuery.isPending
            ? m.owner_loading_your_private_stays()
            : message}
      </p>
      {stays.length > 0 && (
        <StayList
          stays={stays}
          onInspect={stayDialog.inspect}
          onAdjustNights={adjustNights}
          saving={saveStay.isPending}
        />
      )}
      <RecordDialog
        open={editingStay || selectedStay !== null}
        title={
          editingStay ? (editingStayId ? m.owner_edit_stay() : m.owner_add_stay()) : m.owner_stay()
        }
        dirty={editingStay && stayRecord.dirty}
        error={stayDialog.error}
        onDismiss={closeStay}
      >
        {!editingStay && selectedStay && (
          <StayDetails
            tripId={trip.id}
            selected={selectedStay}
            alternatives={alternatives}
            saving={saveStay.isPending}
            onCancelAlternatives={cancelAlternatives}
            onEdit={editStay}
            onDelete={setDeleteTarget}
          />
        )}
        {editingStay && (
          <StayForm
            tripId={trip.id}
            record={stayRecord}
            editingId={editingStayId}
            stays={stays}
            currentPlace={currentPlace}
            placeRequired={placeRequired}
          />
        )}
      </RecordDialog>
      {deleteTarget && (
        <DeleteConfirmation
          title={m.owner_delete_2({ p0: stayLabel(deleteTarget) })}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </section>
  );
}
