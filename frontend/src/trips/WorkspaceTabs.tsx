import { cn } from "@/lib/utils";
import type { MouseEvent } from "react";
import { Link } from "@tanstack/react-router";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { sectionPath, WORKSPACE_SECTIONS, type TripWorkspaceSection } from "./workspace-sections";

/** The workspace's section links; the URL, not component state, decides which section is open. */
export function WorkspaceTabs({
  tripId,
  current,
  drawer = false,
  onSelect,
}: {
  tripId: string;
  current: TripWorkspaceSection;
  drawer?: boolean;
  onSelect?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  useLocale();
  return (
    <nav
      className={cn(
        "flex gap-1 overflow-x-auto border-b border-travel-divider scrollbar-thin trip-sidebar:flex-col trip-sidebar:overflow-x-visible trip-sidebar:border-b-0 trip-sidebar:p-1",
        drawer && "flex-col border-b-0 p-1",
      )}
      aria-label={m.owner_trip_sections()}
    >
      {WORKSPACE_SECTIONS.map(({ id, label, icon: Icon }) => (
        <Link
          className={cn(
            "-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-bold text-travel-muted no-underline hover:text-travel-ink aria-[current=page]:border-travel-forest aria-[current=page]:text-travel-forest trip-sidebar:mb-0 trip-sidebar:shrink trip-sidebar:rounded-travel-control trip-sidebar:border-b-0 trip-sidebar:border-l-2 trip-sidebar:py-2 trip-sidebar:aria-[current=page]:border-travel-forest trip-sidebar:aria-[current=page]:bg-travel-selected-bg",
            drawer &&
              "mb-0 shrink rounded-travel-control border-b-0 border-l-2 py-2 aria-[current=page]:bg-travel-selected-bg",
          )}
          onClick={onSelect}
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
