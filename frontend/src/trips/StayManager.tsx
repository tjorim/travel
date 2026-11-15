import { Button } from "@/ui/button";

import { type DialogFocusRequest } from "../forms/useRecordDialog";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorMessage } from "../query/api";
import { textNotice, useFeedback } from "../query/feedback";
import { useTripResource } from "../query/owner-queries";
import { AlternativesPanel } from "./alternatives/AlternativesPanel";
import { type Area, type Trip } from "../api-types";
import { useCreateRequest, type CreateRequestProps } from "./create-request";
import type { PlanHost } from "./plan-host";
import { useFocusRequest } from "./record-focus";
import { StayEditor } from "./stays/StayEditor";
import { StayList } from "./stays/StayList";
import { useStayNights } from "./stays/use-stay-nights";

/**
 * The stays block: its list and alternatives, with the editor that opens a record or starts a new one. Inside the
 * plan tab (`host`) the agenda owns the editor, the alternatives and the status line, and the block only asks it.
 */
export function StayManager({
  trip,
  focusId,
  createRequest,
  onCreateHandled,
  host,
}: {
  trip: Trip;
  areas?: Area[];
  focusId?: DialogFocusRequest | null;
  host?: PlanHost;
} & CreateRequestProps) {
  useLocale();
  const staysQuery = useTripResource(trip.id, "stays");
  const stays = staysQuery.data ?? [];
  const documentsQuery = useTripResource(trip.id, "documents");
  const [message, setMessage] = useFeedback<string>(textNotice(() => m.stays_visibility_hint()));
  const focus = useFocusRequest(focusId);
  const create = useCreateRequest("stay", createRequest, onCreateHandled);
  const nights = useStayNights(trip.id, setMessage);
  const open = host ? (id: string) => host.open("stay", id) : focus.open;

  const readError = staysQuery.error ?? documentsQuery.error;

  return (
    <section className="travel-card manager" aria-labelledby="stays-title">
      <div className="capture-heading">
        <div>
          <h3 id="stays-title">{m.common_stays()}</h3>
          <p>{m.stays_intro()}</p>
        </div>
        <Button
          className="secondary compact"
          type="button"
          onClick={(event) =>
            host ? host.start("stay", event.currentTarget) : create.start(event.currentTarget)
          }
        >
          {m.stays_new_stay()}
        </Button>
      </div>
      <p className="help" role="status">
        {readError
          ? errorMessage(readError, m.stays_your_stays_could_not_be_loaded)
          : staysQuery.isPending
            ? m.stays_loading_your_private_stays()
            : message}
      </p>
      {!host && (
        <AlternativesPanel tripId={trip.id} kind="stay" records={stays} onOpen={focus.open} />
      )}
      {stays.length > 0 && (
        <StayList
          stays={stays}
          onInspect={open}
          onAdjustNights={nights.adjust}
          saving={nights.saving}
        />
      )}
      {!host && (
        <StayEditor
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
