import type { DialogFocusAction, DialogFocusRequest } from "@/hooks/useRecordDialog";
import { useFeedback, type ReportNotice } from "@/lib/api/feedback";
import type { Trip } from "../api-types";
import type { AgendaRecordKind } from "./agenda-items";
import { type CreateRequest } from "./create-request";
import { focusFor, useFocusRequest, type RecordFocus } from "./record-focus";
import { RouteEditor } from "@/features/trips/routes/RouteEditor";
import { StayEditor } from "@/features/trips/stays/StayEditor";
import { VisitEditor } from "@/features/trips/visits/VisitEditor";

/**
 * What the plan tab shares between the agenda and the three record dialogs: the one dialog per kind of record, how to
 * open it (a record, or a new one) and the one status line the three dialogs report to.
 */
export type PlanHost = {
  /** The status line of the agenda block: what the last save, delete or other row action reported. */
  message: string | null;
  report: ReportNotice;
  /** Opens a record's dialog: shown, opened for editing, or asking to delete it. */
  open: (
    kind: AgendaRecordKind,
    id: string,
    action?: DialogFocusAction,
    returnTo?: HTMLElement | null,
  ) => void;
  focus: Record<AgendaRecordKind, DialogFocusRequest | null>;
  /** The workspace's pending request to start a record (the map, the overview, a day's Add menu, the New menu). */
  createRequest: CreateRequest | null;
  onCreateHandled: () => void;
};

/**
 * The requests that reach the plan's editors: opening a record (an agenda row, the map) and starting one (the map, the
 * overview, a day's Add menu, the block's
 * New menu. A request is handled by the one editor of its kind.
 */
export function usePlanHost(
  recordFocus: RecordFocus | null,
  createRequest: CreateRequest | null,
  onCreateHandled: () => void,
  /** Called whenever a dialog reports, so the status line that shows it can be put in view. */
  onReported?: () => void,
): PlanHost {
  const [message, setMessage] = useFeedback<string | null>(null);
  const report: ReportNotice = (notice) => {
    setMessage(notice);
    onReported?.();
  };
  const focus = {
    visit: useFocusRequest(focusFor(recordFocus, "visit")),
    stay: useFocusRequest(focusFor(recordFocus, "stay")),
    route: useFocusRequest(focusFor(recordFocus, "route")),
  };
  return {
    message,
    report,
    open: (kind, id, action, returnTo) => focus[kind].open(id, action, returnTo),
    focus: { visit: focus.visit.focusId, stay: focus.stay.focusId, route: focus.route.focusId },
    createRequest,
    onCreateHandled,
  };
}

/** The three record dialogs of the plan, once for the whole tab; they have no visible block of their own. */
export function PlanEditors({ trip, host }: { trip: Trip; host: PlanHost }) {
  return (
    <>
      <VisitEditor
        trip={trip}
        focusId={host.focus.visit}
        createRequest={host.createRequest}
        onCreateHandled={host.onCreateHandled}
        onNotice={host.report}
      />
      <StayEditor
        trip={trip}
        focusId={host.focus.stay}
        createRequest={host.createRequest}
        onCreateHandled={host.onCreateHandled}
        onNotice={host.report}
      />
      <RouteEditor
        trip={trip}
        focusId={host.focus.route}
        createRequest={host.createRequest}
        onCreateHandled={host.onCreateHandled}
        onNotice={host.report}
      />
    </>
  );
}
