import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";

/** Explains what the "idea" status of a route or stay means for the owner and for visitors. */
export function IdeaNote({ kind }: { kind: "route" | "stay" }) {
  useLocale();
  return (
    <p className="help">
      {kind === "route"
        ? m.owner_a_route_idea_is_a_candidate_it_covers_no_journey_does_not_count_towards_booking_and_is_never_shared()
        : m.owner_a_stay_idea_is_a_candidate_it_may_overlap_other_stays_covers_no_night_and_is_never_shared()}
    </p>
  );
}
