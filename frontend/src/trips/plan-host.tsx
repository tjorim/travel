import type { DialogFocusAction, DialogFocusRequest } from "../forms/useRecordDialog";
import { useFeedback, type ReportNotice } from "../query/feedback";
import type { Trip } from "../api-types";
import type { AgendaRecordKind } from "./agenda-items";
import {
  useCreateRequest,
  type CreateKind,
  type CreateRequest,
  type CreateRequestProps,
} from "./create-request";
import { focusFor, useFocusRequest, type RecordFocus } from "./record-focus";
import { RouteEditor } from "./routes/RouteEditor";
import { StayEditor } from "./stays/StayEditor";
import { VisitEditor } from "./visits/VisitEditor";

/**
 * What the plan tab shares between the agenda and the three type blocks while both exist: the one dialog per kind of
 * record, how to open it (a record, or a new one) and the one status line the three dialogs report to.
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
  /** Starts a new record from a control that stays on screen: focus returns to it. */
  start: (kind: CreateKind, from: HTMLElement | null) => void;
  focus: Record<AgendaRecordKind, DialogFocusRequest | null>;
  create: Record<CreateKind, CreateRequestProps & { onCreateHandled: () => void }>;
};

/**
 * The requests that reach the plan's editors: the workspace's (the map, the overview, a day's Add menu) and the
 * agenda's own (a row, a block's New button). A request is handled by the one editor of its kind.
 */
export function usePlanHost(
  recordFocus: RecordFocus | null,
  createRequest: CreateRequest | null,
  onCreateHandled: () => void,
): PlanHost {
  const [message, report] = useFeedback<string | null>(null);
  const focus = {
    visit: useFocusRequest(focusFor(recordFocus, "visit")),
    stay: useFocusRequest(focusFor(recordFocus, "stay")),
    route: useFocusRequest(focusFor(recordFocus, "route")),
  };
  const create = {
    visit: useCreateRequest("visit", createRequest, onCreateHandled),
    stay: useCreateRequest("stay", createRequest, onCreateHandled),
    route: useCreateRequest("route", createRequest, onCreateHandled),
  };
  return {
    message,
    report,
    open: (kind, id, action, returnTo) => focus[kind].open(id, action, returnTo),
    start: (kind, from) => create[kind].start(from),
    focus: { visit: focus.visit.focusId, stay: focus.stay.focusId, route: focus.route.focusId },
    create,
  };
}

/** The three record dialogs of the plan, once for the whole tab; they have no visible block of their own. */
export function PlanEditors({ trip, host }: { trip: Trip; host: PlanHost }) {
  return (
    <>
      <VisitEditor
        trip={trip}
        focusId={host.focus.visit}
        createRequest={host.create.visit.createRequest}
        onCreateHandled={host.create.visit.onCreateHandled}
        onNotice={host.report}
      />
      <StayEditor
        trip={trip}
        focusId={host.focus.stay}
        createRequest={host.create.stay.createRequest}
        onCreateHandled={host.create.stay.onCreateHandled}
        onNotice={host.report}
      />
      <RouteEditor
        trip={trip}
        focusId={host.focus.route}
        createRequest={host.create.route.createRequest}
        onCreateHandled={host.create.route.onCreateHandled}
        onNotice={host.report}
      />
    </>
  );
}
