import {
  BackpackIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  LayoutDashboardIcon,
  Share2Icon,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import { lazyView } from "../lazy-view";
import { m } from "../paraglide/messages.js";
import type { Area, TravelUpdateCandidateIntent, Trip } from "../tracker-model";
import type { AgendaRecordKind } from "./AgendaView";
import type { MapRecordKind, RecordFocus, RecordKind } from "./record-focus";
import { WorkspaceOverview } from "./WorkspaceOverview";

/** What every section receives from the workspace; a section uses the parts it needs. */
export type SectionProps = {
  trip: Trip;
  areas: Area[];
  recordFocus: RecordFocus | null;
  mapFocus: { id: string; request: number } | null;
  onOpenMapRecord: (kind: MapRecordKind, id: string) => void;
  onOpenAgendaRecord: (kind: AgendaRecordKind, id: string) => void;
  onShowOnMap: (pointId: string) => void;
  onStartCaptureFromCandidate: (candidate: TravelUpdateCandidateIntent) => void;
};

/** A block inside a tab: a collapsible card that the jump search and `#id` links can open. */
type Part = {
  /** The element id and URL hash that address this block. */
  id: string;
  label: () => string;
  /** The record kinds whose editor is in this block: opening one of their dialogs expands it. */
  records: readonly RecordKind[];
};

type Section = {
  id: string;
  label: () => string;
  icon: LucideIcon;
  component: ComponentType<SectionProps>;
  /** The blocks of a tab that has several. */
  parts?: readonly Part[];
  /** Earlier addresses of this section: a link to one redirects here, so old bookmarks keep working. */
  aliases?: readonly string[];
};

/**
 * The trip workspace's sections, in tab order. The tab bar, the route, the content, the jump search and all
 * "open this record" links read this list. To add a tab, add an entry and a message; to add or move a block, edit
 * the section component that renders it and its `parts`. The overview opens first, so it loads with the workspace;
 * every other section's editors load when it is first opened.
 */
export const WORKSPACE_SECTIONS = [
  {
    id: "overview",
    label: () => m.owner_overview(),
    icon: LayoutDashboardIcon,
    component: WorkspaceOverview,
  },
  {
    id: "plan",
    label: () => m.owner_plan(),
    icon: CalendarDaysIcon,
    component: lazyView<SectionProps>(() => import("./PlanSection")),
    parts: [
      { id: "agenda", label: () => m.owner_agenda(), records: [] },
      { id: "areas", label: () => m.owner_areas_and_locations(), records: ["area", "location"] },
      { id: "visits", label: () => m.owner_visits(), records: ["visit"] },
      { id: "stays", label: () => m.owner_stays(), records: ["stay"] },
      { id: "routes", label: () => m.owner_routes(), records: ["route"] },
    ],
  },
  {
    id: "prepare",
    label: () => m.owner_prepare(),
    icon: ClipboardCheckIcon,
    component: lazyView<SectionProps>(() => import("./PrepareSection")),
    parts: [
      { id: "tasks", label: () => m.owner_things_to_arrange(), records: ["task"] },
      { id: "documents", label: () => m.assets_documents(), records: ["document"] },
    ],
  },
  {
    id: "packing",
    label: () => m.owner_packing(),
    icon: BackpackIcon,
    component: lazyView<SectionProps>(() => import("./PackingSection")),
  },
  {
    id: "story",
    label: () => m.owner_story(),
    icon: BookOpenIcon,
    component: lazyView<SectionProps>(() => import("./StorySection")),
    parts: [
      { id: "updates", label: () => m.owner_travel_updates(), records: ["update"] },
      { id: "media", label: () => m.assets_media_library(), records: ["media"] },
    ],
    // The media library used to have a tab of its own.
    aliases: ["media"],
  },
  {
    id: "sharing",
    label: () => m.owner_sharing(),
    icon: Share2Icon,
    component: lazyView<SectionProps>(() => import("./SharingSection")),
  },
] as const satisfies readonly Section[];

export type TripWorkspaceSection = (typeof WORKSPACE_SECTIONS)[number]["id"];

export const DEFAULT_SECTION: TripWorkspaceSection = "overview";

export const isWorkspaceSection = (value: string): value is TripWorkspaceSection =>
  WORKSPACE_SECTIONS.some((section) => section.id === value);

/** The section a URL segment means: its id, or the section an earlier id was merged into. */
export const resolveSection = (value: string): TripWorkspaceSection | null =>
  WORKSPACE_SECTIONS.find(
    (section) => section.id === value || ((section as Section).aliases ?? []).includes(value),
  )?.id ?? null;

export const sectionById = (id: TripWorkspaceSection): Section =>
  WORKSPACE_SECTIONS.find((section) => section.id === id)!;

export const partsOf = (id: TripWorkspaceSection): readonly Part[] => sectionById(id).parts ?? [];

/** The tab and block whose editor opens a record's dialog. */
export const locateRecord = (kind: RecordKind) => {
  for (const section of WORKSPACE_SECTIONS)
    for (const part of (section as Section).parts ?? [])
      if (part.records.includes(kind)) return { section, part };
  return null;
};

/** Which section opens a record's dialog. */
export const sectionForRecord = (kind: RecordKind): TripWorkspaceSection =>
  locateRecord(kind)?.section.id ?? DEFAULT_SECTION;

/** `/trips/:id` for the overview, `/trips/:id/:section` for the rest. */
export const sectionPath = (tripId: string, section: TripWorkspaceSection) =>
  `/trips/${encodeURIComponent(tripId)}${section === DEFAULT_SECTION ? "" : `/${section}`}`;
