import { Button } from "@/ui/button";

import { type DialogFocusRequest } from "../forms/useRecordDialog";
import { useLocale } from "../locale";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { m } from "../paraglide/messages.js";
import { errorMessage, type ErrorFallback } from "../query/api";
import { errorNotice, textNotice, useFeedback } from "../query/feedback";
import { useTripResource } from "../query/owner-queries";
import { visitTitle } from "../records";
import { type Trip, type Visit } from "../api-types";
import { AlternativesPanel } from "./alternatives/AlternativesPanel";
import { useCreateRequest, type CreateRequestProps } from "./create-request";
import { useFocusRequest } from "./record-focus";
import { VisitEditor } from "./visits/VisitEditor";
import { VisitList } from "./visits/VisitList";

const EMPTY: Visit[] = [];

/** The visits block: its list and alternatives, with the editor that opens a record or starts a new one. */
export function VisitManager({
  trip,
  onShowOnMap,
  focusId,
  createRequest,
  onCreateHandled,
}: {
  trip: Trip;
  onShowOnMap?: (pointId: string) => void;
  focusId?: DialogFocusRequest | null;
} & CreateRequestProps) {
  useLocale();
  const offline = useOfflineCopies();
  const visitsQuery = useTripResource(trip.id, "visits");
  const staysQuery = useTripResource(trip.id, "stays");
  // The server orders visits (by day, then time, then creation; undated last): every view keeps that order.
  const visits = visitsQuery.data ?? EMPTY;
  const stays = staysQuery.data ?? [];
  const [message, setMessage] = useFeedback<string>(textNotice(() => m.visits_intro()));
  const focus = useFocusRequest(focusId);
  const create = useCreateRequest("visit", createRequest, onCreateHandled);

  const fail = (fallback: ErrorFallback) => (error: unknown) =>
    setMessage(errorNotice(error, fallback));

  /** The map point for a visit: its location when that has a point, else its area. */
  const mapPointFor = (visit: Visit): string =>
    visit.location?.latitude != null ? visit.location.id : visit.area.id;

  async function toggleOffline(visit: Visit) {
    if (offline.isPinned("visit", visit.id)) {
      await offline.removeByResource("visit", visit.id);
      setMessage(
        textNotice(() => m.common_is_no_longer_available_offline({ title: visitTitle(visit) })),
      );
      return;
    }
    await offline.pin({
      resourceKind: "visit",
      contentMetadata: visit,
      resourceId: visit.id,
      metadataUrl: `/api/trips/${trip.id}/visits/${visit.id}`,
      title: visitTitle(visit),
      contentType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(visit)).buffer as ArrayBuffer,
    });
    setMessage(
      textNotice(() => m.common_is_saved_offline_on_this_device({ title: visitTitle(visit) })),
    );
  }

  const readError = visitsQuery.error ?? staysQuery.error;

  return (
    <section className="travel-card manager" aria-labelledby="visits-title">
      <div className="capture-heading">
        <div>
          <h3 id="visits-title">{m.common_visits()}</h3>
          <p>{m.visits_sharing_intro()}</p>
        </div>
        <Button
          className="secondary compact"
          type="button"
          onClick={(event) => create.start(event.currentTarget)}
        >
          {m.visits_new_visit()}
        </Button>
      </div>
      <p className="help" role="status">
        {readError
          ? errorMessage(readError, m.visits_your_visits_could_not_be_loaded)
          : visitsQuery.isPending
            ? m.visits_loading_your_visits()
            : message}
      </p>
      <AlternativesPanel tripId={trip.id} kind="visit" records={visits} onOpen={focus.open} />
      {visits.length > 0 && (
        <VisitList
          visits={visits}
          stays={stays}
          trip={trip}
          pinned={(visit) => offline.isPinned("visit", visit.id)}
          onInspect={focus.open}
          onShowOnMap={onShowOnMap && ((visit) => onShowOnMap(mapPointFor(visit)))}
          onToggleOffline={(visit) =>
            void toggleOffline(visit).catch(fail(m.visits_the_visit_could_not_be_saved_offline))
          }
        />
      )}
      {!visitsQuery.isPending && !visitsQuery.error && visits.length === 0 && (
        <p>{m.visits_no_visits_yet_add_one_to_organise_your_trip()}</p>
      )}
      <VisitEditor
        trip={trip}
        focusId={focus.focusId}
        createRequest={create.createRequest}
        onCreateHandled={create.onCreateHandled}
        onNotice={setMessage}
      />
    </section>
  );
}
