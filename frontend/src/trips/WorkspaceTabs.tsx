import { Link } from "@tanstack/react-router";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { sectionPath, WORKSPACE_SECTIONS, type TripWorkspaceSection } from "./workspace-sections";

/** The workspace's section links; the URL, not component state, decides which section is open. */
export function WorkspaceTabs({
  tripId,
  current,
}: {
  tripId: string;
  current: TripWorkspaceSection;
}) {
  useLocale();
  return (
    <nav
      className="flex gap-1.5 overflow-x-auto border-b border-travel-divider pb-0.5 scrollbar-thin"
      aria-label={m.owner_trip_sections()}
    >
      {WORKSPACE_SECTIONS.map(({ id, label, icon: Icon }) => (
        <Link
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 text-sm font-bold text-travel-muted no-underline aria-[current=page]:bg-travel-selected-bg aria-[current=page]:text-travel-forest"
          key={id}
          to={sectionPath(tripId, id)}
          activeOptions={{ exact: id === "overview" }}
          aria-current={current === id ? "page" : undefined}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label()}
        </Link>
      ))}
    </nav>
  );
}
