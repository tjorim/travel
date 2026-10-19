import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { RecipientState } from "./model";

/** Who a location currently reaches, or that this is still loading or could not be checked; the wording around the names is the caller's. */
export function RecipientsText({
  state,
  recipients,
  reaches,
  reachesNobody,
}: {
  state: RecipientState;
  recipients: string[];
  reaches: (names: string) => string;
  reachesNobody: () => string;
}) {
  useLocale();
  return state === "loading"
    ? m.owner_loading_recipients()
    : state === "failed"
      ? m.owner_recipients_could_not_be_checked()
      : recipients.length
        ? reaches(recipients.join(", "))
        : reachesNobody();
}
