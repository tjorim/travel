import { Button } from "@/ui/button";

import { type DialogFocusRequest } from "../forms/useRecordDialog";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorMessage } from "../query/api";
import { errorNotice, textNotice, useFeedback } from "../query/feedback";
import { useTripResource } from "../query/owner-queries";
import { AlternativesPanel } from "./alternatives/AlternativesPanel";
import { addDays, formatDay } from "../dates";
import { type Area, type Stay, type Trip } from "../api-types";
import { useCreateRequest, type CreateRequestProps } from "./create-request";
import { useFocusRequest } from "./record-focus";
import { StayEditor } from "./stays/StayEditor";
import { StayList } from "./stays/StayList";
import { useStayMutations } from "./stays/use-stay-mutations";

/** The stays block: its list and alternatives, with the editor that opens a record or starts a new one. */
export function StayManager({
  trip,
  focusId,
  createRequest,
  onCreateHandled,
}: {
  trip: Trip;
  areas?: Area[];
  focusId?: DialogFocusRequest | null;
} & CreateRequestProps) {
  useLocale();
  const staysQuery = useTripResource(trip.id, "stays");
  const stays = staysQuery.data ?? [];
  const documentsQuery = useTripResource(trip.id, "documents");
  const [message, setMessage] = useFeedback<string>(textNotice(() => m.stays_visibility_hint()));
  const focus = useFocusRequest(focusId);
  const create = useCreateRequest("stay", createRequest, onCreateHandled);
  const { save: saveStay } = useStayMutations(trip.id);

  /** A quick change of length for a private stay that is still a plan: only the check-out moves. */
  async function adjustNights(stay: Stay, delta: -1 | 1) {
    const checkOut = addDays(stay.check_out_date, delta);
    try {
      await saveStay.mutateAsync({ id: stay.id, payload: { check_out_date: checkOut } });
      setMessage(
        textNotice(() =>
          m.stays_stay_dates_changed({
            dates: `${formatDay(stay.check_in_date)} → ${formatDay(checkOut)}`,
          }),
        ),
      );
    } catch (error) {
      setMessage(errorNotice(error, m.stays_the_stay_could_not_be_saved));
    }
  }

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
          onClick={(event) => create.start(event.currentTarget)}
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
      <AlternativesPanel tripId={trip.id} kind="stay" records={stays} onOpen={focus.open} />
      {stays.length > 0 && (
        <StayList
          stays={stays}
          onInspect={focus.open}
          onAdjustNights={adjustNights}
          saving={saveStay.isPending}
        />
      )}
      <StayEditor
        trip={trip}
        focusId={focus.focusId}
        createRequest={create.createRequest}
        onCreateHandled={create.onCreateHandled}
        onNotice={setMessage}
      />
    </section>
  );
}
