import { Button } from "@/ui/button";

import { type DialogFocusRequest } from "../forms/useRecordDialog";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorMessage } from "../query/api";
import { textNotice, useFeedback } from "../query/feedback";
import { useTripResource } from "../query/owner-queries";
import { type Trip, type Visit } from "../api-types";
import { AlternativesPanel } from "./alternatives/AlternativesPanel";
import { useCreateRequest, type CreateRequestProps } from "./create-request";
import type { PlanHost } from "./plan-host";
import { useFocusRequest } from "./record-focus";
import { VisitEditor } from "./visits/VisitEditor";
import { mapPointFor } from "./visits/model";
import { useVisitOffline } from "./visits/use-visit-offline";
import { VisitList } from "./visits/VisitList";

const EMPTY: Visit[] = [];

/**
 * The visits block: its list and alternatives, with the editor that opens a record or starts a new one. Inside the
 * plan tab (`host`) the agenda owns the editor, the alternatives and the status line, and the block only asks it.
 */
export function VisitManager({
  trip,
  onShowOnMap,
  focusId,
  createRequest,
  onCreateHandled,
  host,
}: {
  trip: Trip;
  onShowOnMap?: (pointId: string) => void;
  focusId?: DialogFocusRequest | null;
  host?: PlanHost;
} & CreateRequestProps) {
  useLocale();
  const visitsQuery = useTripResource(trip.id, "visits");
  const staysQuery = useTripResource(trip.id, "stays");
  // The server orders visits (by day, then time, then creation; undated last): every view keeps that order.
  const visits = visitsQuery.data ?? EMPTY;
  const stays = staysQuery.data ?? [];
  const [message, setMessage] = useFeedback<string>(textNotice(() => m.visits_intro()));
  const focus = useFocusRequest(focusId);
  const create = useCreateRequest("visit", createRequest, onCreateHandled);

  const offline = useVisitOffline(trip.id, setMessage);
  const open = host ? (id: string) => host.open("visit", id) : focus.open;

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
          onClick={(event) =>
            host ? host.start("visit", event.currentTarget) : create.start(event.currentTarget)
          }
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
      {!host && (
        <AlternativesPanel tripId={trip.id} kind="visit" records={visits} onOpen={focus.open} />
      )}
      {visits.length > 0 && (
        <VisitList
          visits={visits}
          stays={stays}
          trip={trip}
          pinned={offline.isPinned}
          onInspect={open}
          onShowOnMap={onShowOnMap && ((visit) => onShowOnMap(mapPointFor(visit)))}
          onToggleOffline={offline.toggle}
        />
      )}
      {!visitsQuery.isPending && !visitsQuery.error && visits.length === 0 && (
        <p>{m.visits_no_visits_yet_add_one_to_organise_your_trip()}</p>
      )}
      {!host && (
        <VisitEditor
          trip={trip}
          focusId={focus.focusId}
          createRequest={create.createRequest}
          onCreateHandled={create.onCreateHandled}
          onNotice={setMessage}
        />
      )}
    </section>
  );
}
