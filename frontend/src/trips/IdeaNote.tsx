import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";

/** Explains what the "idea" status of a route or stay means for the owner and for visitors. */
export function IdeaNote({ kind }: { kind: "route" | "stay" }) {
  useLocale();
  return (
    <p className="help">
      {kind === "route" ? m.updates_route_idea_hint() : m.updates_stay_idea_hint()}
    </p>
  );
}
