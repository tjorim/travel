import { m } from "../paraglide/messages.js";
import { formatDayRange } from "../dates";
import {
  type DocumentAsset,
  type MediaAsset,
  type PlanningStatus,
  type Visit,
  type VisitKind,
} from "../api-types";

// Label tables and formatters that read-only views share with the editors. They live apart from the managers so a
// view-only page does not pull an editor's dialog and form graph into its chunk.

export const DOCUMENT_KIND_LABELS: Record<DocumentAsset["document_kind"], string> = {
  get booking() {
    return m.library_booking();
  },
  get itinerary() {
    return m.library_itinerary();
  },
  get receipt() {
    return m.library_receipt();
  },
  get other() {
    return m.common_other();
  },
};

export const MEDIA_KIND_LABELS: Record<MediaAsset["media_kind"], string> = {
  get photo() {
    return m.media_photo();
  },
  get video() {
    return m.media_video();
  },
};

export const PLANNING_STATUS_LABELS: Record<PlanningStatus, string> = {
  get idea() {
    return m.trips_idea();
  },
  get planned() {
    return m.trips_planned();
  },
  get confirmed() {
    return m.trips_confirmed();
  },
  get cancelled() {
    return m.trips_cancelled();
  },
};

export const VISIT_KIND_LABELS: Record<VisitKind, string> = {
  get free() {
    return m.trips_leisure();
  },
  get work() {
    return m.trips_work();
  },
};

export const clock = (time: string | null): string => (time ? time.slice(0, 5) : "");

/** "21 nov – 22 nov · 18:30–21:00", or "Nog geen dag". */
export function visitWhen(
  visit: Pick<Visit, "starts_on" | "ends_on" | "start_time" | "end_time">,
): string {
  if (!visit.starts_on) return m.common_no_day_yet();
  const times = visit.start_time
    ? ` · ${clock(visit.start_time)}${visit.end_time ? `–${clock(visit.end_time)}` : ""}`
    : "";
  return `${formatDayRange(visit.starts_on, visit.ends_on)}${times}`;
}
