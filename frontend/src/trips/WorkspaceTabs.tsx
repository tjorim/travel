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
      className="flex gap-1 overflow-x-auto border-b border-travel-divider scrollbar-thin"
      aria-label={m.owner_trip_sections()}
    >
      {WORKSPACE_SECTIONS.map(({ id, label, icon: Icon }) => (
        <Link
          className="-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-bold text-travel-muted no-underline hover:text-travel-ink aria-[current=page]:border-travel-forest aria-[current=page]:text-travel-forest"
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
