import { Button } from "@/ui/button";
import { useMemo, useRef } from "react";

import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useLocale } from "../locale";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { m } from "../paraglide/messages.js";
import { errorMessage } from "../query/api";
import { errorNotice, FeedbackError, textNotice, useFeedback } from "../query/feedback";
import { useTripResource } from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import { visitTitle, type Trip, type Visit } from "../tracker-model";
import { hasPlace, placeFields, samePlace } from "./PlacePicker";
import { blank, fromVisit, serverFields, type Values } from "./visits/model";
import { useVisitMutations } from "./visits/use-visit-mutations";
import { VisitDetails } from "./visits/VisitDetails";
import { VisitForm } from "./visits/VisitForm";
import { VisitList } from "./visits/VisitList";

export function VisitManager({
  trip,
  onShowOnMap,
  focusId,
}: {
  trip: Trip;
  onShowOnMap?: (pointId: string) => void;
  focusId?: DialogFocusRequest | null;
}) {
  useLocale();
  const offline = useOfflineCopies();
  const visitsQuery = useTripResource(trip.id, "visits");
  const staysQuery = useTripResource(trip.id, "stays");
  const visits = useMemo(
    () => (visitsQuery.data ?? []).slice().sort((left, right) => left.position - right.position),
    [visitsQuery.data],
  );
  const stays = staysQuery.data ?? [];
  const dialog = useRecordDialog(visits);
  useDialogFocus(focusId, dialog.inspect);
  const { selected, editing, editingId } = dialog;
  const [message, setMessage] = useFeedback<string>(
    textNotice(() =>
      m.owner_a_visit_is_a_stop_on_your_trip_an_area_or_location_and_when_it_stays_pri(),
    ),
  );
  // A place is only rewritten when the editor changed it.
  const baseline = useRef<Values>(blank());
  const { save, move, remove } = useVisitMutations(trip.id);

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: m.owner_the_visit_could_not_be_saved,
    serverFields,
    submit: async (values) => {
      const id = dialog.editingId ?? null;
      if (!hasPlace(values.place))
        throw new FeedbackError(() => m.owner_choose_where_the_visit_is_an_area_or_location());
      if (values.startTime && !values.startsOn)
        throw new FeedbackError(() => m.owner_a_time_belongs_to_a_day_choose_the_first_day_first());
      if (values.endTime && !values.startTime)
        throw new FeedbackError(() => m.owner_also_enter_a_start_time());
      await save.mutateAsync({
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
          share_date_precision: values.shareDatePrecision,
          ...(!id || !samePlace(values.place, baseline.current.place)
            ? placeFields(values.place)
            : {}),
          ...(id ? {} : { position: visits.length }),
        },
      });
      // A pinned copy holds the previous version of the visit.
      if (id) await offline.removeByResource("visit", id);
    },
    onSuccess: () => {
      close();
      setMessage(textNotice(() => m.owner_visit_saved()));
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
  function create() {
    load(blank());
    dialog.create();
  }
  function edit(visit: Visit) {
    load(fromVisit(visit));
    dialog.edit(visit.id);
  }
  const fail = (fallback: import("../query/api").ErrorFallback) => (error: unknown) =>
    setMessage(errorNotice(error, fallback));
  const failInDialog = (fallback: import("../query/api").ErrorFallback) => (error: unknown) => {
    dialog.setConfirmDelete(false);
    dialog.setError(errorNotice(error, fallback));
  };

  /** The map point for a visit: its location when that has a point, else its area. */
  const mapPointFor = (visit: Visit): string =>
    visit.location?.latitude != null ? visit.location.id : visit.area.id;

  function shift(visit: Visit, direction: -1 | 1) {
    const position = visit.position + direction;
    if (position < 0 || position >= visits.length) return;
    move
      .mutateAsync({ visit, position })
      .then(
        () => setMessage(textNotice(() => m.owner_visit_order_saved())),
        fail(m.owner_the_visit_could_not_be_moved),
      );
  }

  function erase(visit: Visit) {
    remove.mutateAsync(visit).then(async () => {
      await offline.removeByResource("visit", visit.id);
      close();
      setMessage(textNotice(() => m.owner_visit_deleted()));
    }, failInDialog(m.owner_the_visit_could_not_be_deleted));
  }

  async function toggleOffline(visit: Visit) {
    if (offline.isPinned("visit", visit.id)) {
      await offline.removeByResource("visit", visit.id);
      setMessage(
        textNotice(() => m.owner_is_no_longer_available_offline({ p0: visitTitle(visit) })),
      );
      return;
    }
    await offline.pin({
      resourceKind: "visit",
      resourceId: visit.id,
      metadataUrl: `/api/trips/${trip.id}/visits/${visit.id}`,
      title: visitTitle(visit),
      contentType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(visit)).buffer as ArrayBuffer,
    });
    setMessage(
      textNotice(() => m.owner_is_saved_offline_on_this_device({ p0: visitTitle(visit) })),
    );
  }

  const readError = visitsQuery.error ?? staysQuery.error;

  return (
    <section className="travel-card manager" aria-labelledby="visits-title">
      <div className="capture-heading">
        <div>
          <h3 id="visits-title">{m.owner_visits()}</h3>
          <p>
            {m.owner_stops_on_your_trip_an_area_or_location_and_when_you_are_there_share_them()}
          </p>
        </div>
        <Button className="secondary compact" type="button" onClick={create}>
          {m.owner_new_visit()}
        </Button>
      </div>
      <p className="help" role="status">
        {readError
          ? errorMessage(readError, m.owner_your_visits_could_not_be_loaded)
          : visitsQuery.isPending
            ? m.owner_loading_your_visits()
            : message}
      </p>
      {visits.length > 0 && (
        <VisitList
          visits={visits}
          stays={stays}
          trip={trip}
          pinned={(visit) => offline.isPinned("visit", visit.id)}
          onInspect={dialog.inspect}
          onShowOnMap={onShowOnMap && ((visit) => onShowOnMap(mapPointFor(visit)))}
          onToggleOffline={(visit) =>
            void toggleOffline(visit).catch(fail(m.owner_the_visit_could_not_be_saved_offline))
          }
          onShift={shift}
        />
      )}
      {!visitsQuery.isPending && !visitsQuery.error && visits.length === 0 && (
        <p>{m.owner_no_visits_yet_add_one_to_organise_your_trip()}</p>
      )}
      <RecordDialog
        open={editing || selected !== null}
        title={editing ? (editingId ? m.owner_edit_visit() : m.owner_add_visit()) : m.owner_visit()}
        dirty={editing && record.dirty}
        error={dialog.error}
        onDismiss={close}
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
    </section>
  );
}
