import { useRef } from "react";

import {
  useDialogFocus,
  useRecordDialog,
  type DialogFocusRequest,
} from "../../forms/useRecordDialog";
import { useRecordForm } from "../../forms/useRecordForm";
import { useLocale } from "../../locale";
import { useOfflineCopies } from "../../offline/useOfflineCopies";
import { m } from "../../paraglide/messages.js";
import { errorNotice, FeedbackError, textNotice, type ReportNotice } from "../../query/feedback";
import { useTripResource } from "../../query/owner-queries";
import { RecordDialog } from "../../RecordDialog";
import type { Trip, Visit } from "../../api-types";
import { hasPlace, placeFields, samePlace } from "../PlacePicker";
import { useInPlaceCreate, type CreateRequestProps } from "../create-request";
import { blank, fromVisit, serverFields, visitFromPrefill, type Values } from "./model";
import { useVisitMutations } from "./use-visit-mutations";
import { VisitDetails } from "./VisitDetails";
import { VisitForm } from "./VisitForm";

const EMPTY: Visit[] = [];

/**
 * The visit dialog: details, form, delete confirmation and the calls behind them. It opens on a record when
 * `focusId` asks (an agenda row, a list entry, the map) and on a new one when `createRequest` does, and reports
 * what happened through `onNotice` instead of showing a status line of its own.
 */
export function VisitEditor({
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
  const offline = useOfflineCopies();
  // The server orders visits (by day, then time, then creation; undated last): every view keeps that order.
  const visits = useTripResource(trip.id, "visits").data ?? EMPTY;
  const stays = useTripResource(trip.id, "stays").data ?? [];
  const dialog = useRecordDialog(visits);
  useDialogFocus(focusId, dialog.inspect);
  const { selected, editing, editingId } = dialog;
  // A place is only rewritten when the editor changed it.
  const baseline = useRef<Values>(blank());
  const { save, remove } = useVisitMutations(trip.id);
  const inPlace = useInPlaceCreate("visit", createRequest, onCreateHandled, (prefill) => {
    load(visitFromPrefill(prefill));
    dialog.create();
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: m.visits_the_visit_could_not_be_saved,
    serverFields,
    submit: async (values) => {
      const id = dialog.editingId ?? null;
      if (!hasPlace(values.place))
        throw new FeedbackError(() => m.visits_choose_where_the_visit_is_an_area_or_location());
      if (values.startTime && !values.startsOn)
        throw new FeedbackError(() =>
          m.visits_a_time_belongs_to_a_day_choose_the_first_day_first(),
        );
      if (values.endTime && !values.startTime)
        throw new FeedbackError(() => m.visits_also_enter_a_start_time());
      const saved = await save.mutateAsync({
        id,
        payload: {
          title: values.title.trim() || null,
          kind: values.kind || null,
          status: values.status,
          starts_on: values.startsOn || null,
          ends_on: values.endsOn && values.endsOn !== values.startsOn ? values.endsOn : null,
          start_time: values.startTime || null,
          end_time: values.endTime || null,
          notes: values.notes.trim() || null,
          summary: values.summary.trim() || null,
          share_time: values.shareTime,
          share_date_precision: values.shareDatePrecision || null,
          ...(!id || !samePlace(values.place, baseline.current.place)
            ? placeFields(values.place)
            : {}),
        },
      });
      // A pinned copy holds the previous version of the visit.
      if (id) await offline.removeByResource("visit", id);
      else inPlace.saved(saved.id);
    },
    onSuccess: () => {
      close();
      onNotice(textNotice(() => m.visits_visit_saved()));
    },
  });

  function load(values: Values) {
    baseline.current = values;
    record.load(values);
  }
  function close() {
    dialog.close();
    load(blank());
  }
  function edit(visit: Visit) {
    load(fromVisit(visit));
    dialog.edit(visit.id);
  }
  function erase(visit: Visit) {
    remove.mutateAsync(visit).then(
      async () => {
        await offline.removeByResource("visit", visit.id);
        close();
        onNotice(textNotice(() => m.visits_visit_deleted()));
      },
      (error: unknown) => {
        dialog.setConfirmDelete(false);
        dialog.setError(errorNotice(error, m.visits_the_visit_could_not_be_deleted));
      },
    );
  }

  return (
    <RecordDialog
      open={editing || selected !== null}
      title={
        editing ? (editingId ? m.visits_edit_visit() : m.visits_add_visit()) : m.common_visit()
      }
      dirty={editing && record.dirty}
      error={dialog.error}
      onDismiss={close}
      returnFocus={inPlace.returnFocus}
    >
      {!editing && selected && (
        <VisitDetails
          trip={trip}
          selected={selected}
          stays={stays}
          confirmDelete={dialog.confirmDelete}
          onConfirmDelete={dialog.setConfirmDelete}
          onEdit={edit}
          onErase={erase}
        />
      )}
      {editing && <VisitForm tripId={trip.id} record={record} editingId={editingId} />}
    </RecordDialog>
  );
}
