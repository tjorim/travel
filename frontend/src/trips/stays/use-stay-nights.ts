import { m } from "../../paraglide/messages.js";
import { errorNotice, textNotice, type ReportNotice } from "../../query/feedback";
import { addDays, formatDay } from "../../dates";
import type { Stay } from "../../api-types";
import { useStayMutations } from "./use-stay-mutations";

/** A quick change of a stay's length for one that is still a plan (see `canAdjustNights`): only the check-out moves. */
export function useStayNights(tripId: string, onNotice: ReportNotice) {
  const { save } = useStayMutations(tripId);

  async function adjust(stay: Stay, delta: -1 | 1) {
    const checkOut = addDays(stay.check_out_date, delta);
    try {
      await save.mutateAsync({ id: stay.id, payload: { check_out_date: checkOut } });
      onNotice(
        textNotice(() =>
          m.stays_stay_dates_changed({
            dates: `${formatDay(stay.check_in_date)} → ${formatDay(checkOut)}`,
          }),
        ),
      );
    } catch (error) {
      onNotice(errorNotice(error, m.stays_the_stay_could_not_be_saved));
    }
  }

  return { adjust, saving: save.isPending };
}
