import { Preferences } from "./Preferences";
import { useLocale } from "./locale";
import { m } from "./paraglide/messages.js";

/** Plain links also work outside either router, including error states and the callback. */
export function VisitorTopBar({ detail = false }: { detail?: boolean }) {
  useLocale();
  return (
    <nav
      aria-label={m.visitor_navigation()}
      className="mb-3 flex flex-wrap items-center gap-3 text-sm"
    >
      <a href="/" className="font-bold text-travel-forest no-underline">
        Travel
      </a>
      {detail && (
        <a href="/trips" className="text-travel-forest underline underline-offset-3">
          {m.all_public_trips()}
        </a>
      )}
      <div className="ml-auto">
        <Preferences />
      </div>
    </nav>
  );
}
