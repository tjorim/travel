import { useRef, useState } from "react";

import {
  useDialogFocus,
  useRecordDialog,
  type DialogFocusRequest,
} from "../../forms/useRecordDialog";
import { useRecordForm } from "../../forms/useRecordForm";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { errorNotice, textNotice, type ReportNotice } from "../../query/feedback";
import { useTripResource } from "../../query/owner-queries";
import { groupedIds } from "../alternatives/model";
import { DeleteConfirmation, RecordDialog } from "../../RecordDialog";
import { stayInPlan, stayLabel } from "../../records";
import { type Stay, type Trip } from "../../api-types";
import {
  blankStay,
  accommodationOf,
  stayFromPrefill,
  fromStay,
  locationLine,
  overlaps,
  placeChanged,
  PLACE_REQUIRED,
  stayFields,
  stayPlaceFields,
  type StayValues,
} from "./model";
import { useInPlaceCreate, type CreateRequestProps } from "../create-request";
import { StayDetails } from "./StayDetails";
import { StayForm } from "./StayForm";
import { useStayMutations } from "./use-stay-mutations";

const NONE: Stay[] = [];

/**
 * The stay dialog: details, form, delete confirmation and the calls behind them. It opens on a record when
 * `focusId` asks (an agenda row, a list entry) and on a new one when `createRequest` does, and reports what
 * happened through `onNotice` instead of showing a status line of its own.
 */
export function StayEditor({
  trip,
  focusId,
  createRequest,
  onCreateHandled,
  onNotice,
}: {
  trip: Trip;
  focusId?: DialogFocusRequest | null;
  onNotice: ReportNotice;
} & CreateRequestProps) {
  useLocale();
  const stays = useTripResource(trip.id, "stays").data ?? NONE;
  const groupsQuery = useTripResource(trip.id, "alternative-groups");
  const locationsQuery = useTripResource(trip.id, "locations");
  const documentsQuery = useTripResource(trip.id, "documents");
  const stayDialog = useRecordDialog(stays);
  useDialogFocus(focusId, stayDialog.inspect);
  const [deleteTarget, setDeleteTarget] = useState<Stay | null>(null);
  // A stay's place is only rewritten when one of its fields differs from what the editor opened with.
  const baseline = useRef<StayValues>(blankStay(trip));

  const { save: saveStay, remove: deleteStay } = useStayMutations(trip.id);
  const inPlace = useInPlaceCreate("stay", createRequest, onCreateHandled, (prefill) => {
    loadStay(stayFromPrefill(trip, prefill, locationsQuery.data ?? []));
    stayDialog.create();
    setPrefilledPlace(
      locationLine((locationsQuery.data ?? []).find((place) => place.id === prefill.locationId)),
    );
  });
  // The name of the saved location a new stay started from; the editor shows it as the linked accommodation.
  const [prefilledPlace, setPrefilledPlace] = useState("");

  async function cancelAlternatives(alternatives: Stay[]) {
    try {
      for (const alternative of alternatives)
        await saveStay.mutateAsync({ id: alternative.id, payload: { status: "cancelled" } });
      stayDialog.close();
      onNotice(textNotice(() => m.alternatives_cancelled_notice()));
    } catch (error) {
      stayDialog.setError(errorNotice(error, m.stays_the_stay_could_not_be_saved));
    }
  }
  const stayRecord = useRecordForm<StayValues>({
    defaultValues: blankStay(trip),
    fallback: m.stays_the_stay_could_not_be_saved,
    serverFields: stayFields,
    submit: async (values) => {
      const propertyName = values.propertyName.trim();
      const changed = placeChanged(values, baseline.current);
      const id = stayDialog.editingId ?? null;
      const saved = await saveStay.mutateAsync({
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
          document_asset_ids: values.documentAssetIds,
          share_date_precision: values.shareDatePrecision || null,
          ...(!id || changed ? stayPlaceFields(values) : {}),
        },
      });
      if (!id) inPlace.saved(saved.id);
    },
    onSuccess: () => {
      closeStay();
      onNotice(textNotice(() => m.stays_private_stay_saved()));
    },
  });
  // Only a new stay, or one whose place fields were edited, needs a place to send; the message sits on the Area field.
  // The area is required until an accommodation is chosen; an accommodation settles it itself.
  function areaRequired({ fieldApi }: { fieldApi: { form: { state: { values: StayValues } } } }) {
    const values = fieldApi.form.state.values;
    const changed = placeChanged(values, baseline.current);
    return (!stayDialog.editingId || changed) &&
      accommodationOf(values) === "none" &&
      !values.areaId
      ? PLACE_REQUIRED
      : undefined;
  }
  function loadStay(values: StayValues) {
    baseline.current = values;
    stayRecord.load(values);
  }
  function closeStay() {
    stayDialog.close();
    loadStay(blankStay(trip));
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
        onNotice(textNotice(() => m.stays_private_stay_deleted()));
      },
      (error: unknown) => {
        setDeleteTarget(null);
        stayDialog.setError(errorNotice(error, m.stays_the_stay_could_not_be_deleted));
      },
    );
  }

  const { selected: selectedStay, editing: editingStay, editingId: editingStayId } = stayDialog;
  // Once a stay is chosen, the ideas for its nights are the rejected alternatives.
  const alternatives =
    selectedStay &&
    stayInPlan(selectedStay) &&
    !groupedIds(groupsQuery.data ?? []).has(selectedStay.id)
      ? stays.filter(
          (other) =>
            other.status === "idea" &&
            overlaps(other, selectedStay.check_in_date, selectedStay.check_out_date),
        )
      : [];
  const currentPlace = editingStayId
    ? locationLine(stays.find((stay) => stay.id === editingStayId)?.location)
    : prefilledPlace;

  return (
    <>
      <RecordDialog
        open={editingStay || selectedStay !== null}
        title={
          editingStay ? (editingStayId ? m.stays_edit_stay() : m.stays_add_stay()) : m.common_stay()
        }
        dirty={editingStay && stayRecord.dirty}
        error={stayDialog.error}
        onDismiss={closeStay}
        returnFocus={inPlace.returnFocus}
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
            documents={documentsQuery.data ?? []}
            currentPlace={currentPlace}
            areaRequired={areaRequired}
          />
        )}
      </RecordDialog>
      {deleteTarget && (
        <DeleteConfirmation
          title={m.common_delete_confirm_title({ name: stayLabel(deleteTarget) })}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </>
  );
}
