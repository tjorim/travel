import { Preferences } from "./Preferences";
import { useLocale } from "./locale";
import { m } from "./paraglide/messages.js";

/** Plain links also work outside either router, including error states and the callback. */
export function VisitorTopBar({
  detail = false,
  back,
}: {
  detail?: boolean;
  /** A trip page inside a collection link goes back to that collection, not to the public trips. */
  back?: { href: string; label: string };
}) {
  useLocale();
  return (
    <nav
      aria-label={m.visitor_navigation()}
      className="mb-3 flex flex-wrap items-center gap-3 text-sm"
    >
      <a href="/" className="font-bold text-travel-forest no-underline">
        Travel
      </a>
      {back && (
        <a
          href={back.href}
          referrerPolicy="no-referrer"
          className="text-travel-forest underline underline-offset-3"
        >
          {back.label}
        </a>
      )}
      {detail && !back && (
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
