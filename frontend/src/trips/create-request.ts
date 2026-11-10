import { useEffect, useRef } from "react";

import { stayCoversNight, stayInPlan, type Location, type Stay } from "../tracker-model";

/** The record kinds the agenda and the map can start in place. */
export type CreateKind = "visit" | "stay" | "route";

/** What an in-place start already knows: the day, and the area or location it happens in. */
export type CreatePrefill = {
  /** A date-only day (YYYY-MM-DD): the visit's first day, the stay's check-in or the route's departure. */
  day?: string;
  areaId?: string;
  /** Set when the point is a location; its area is `areaId`. */
  locationId?: string;
};

/**
 * A request from the agenda or the map to open one of the existing record dialogs on a new record.
 * It is ordinary component state of the workspace, handled once by the matching manager and then cleared:
 * nothing is stored in the URL, in history or in the browser.
 */
export type CreateRequest = {
  kind: CreateKind;
  prefill: CreatePrefill;
  token: number;
  /** The control that asked, when it stays on screen: focus returns to it if nothing was created. */
  returnTo?: HTMLElement | null;
};

/** What the plan blocks receive: the pending request and the callback that reports it handled. */
export type CreateRequestProps = {
  createRequest?: CreateRequest | null;
  onCreateHandled?: () => void;
};

/** The attribute that lets a new record's agenda row be found once it appears. */
export const agendaRowAttribute = "data-agenda-record";
export const agendaRowId = (kind: string, id: string) => `${kind}:${id}`;
const agendaRow = (kind: string, id: string) =>
  document.querySelector<HTMLElement>(`[${agendaRowAttribute}="${agendaRowId(kind, id)}"]`);
/** The agenda block's own toggle: where the plan begins, and always on screen. */
const agendaToggle = () =>
  document.getElementById("agenda")?.getElementsByTagName("button")[0] ?? null;

/** The stay a day is spent at: the one that covers its night, else the one that checked out that morning. */
export function stayOnDay(stays: readonly Stay[], day: string): Stay | undefined {
  const inPlan = stays.filter(stayInPlan);
  return (
    inPlan.find((stay) => stayCoversNight(stay, day)) ??
    inPlan.find((stay) => stay.check_out_date === day)
  );
}

/** The area and location a map point or day stands for, as a prefill. */
export const prefillForLocation = (location: Pick<Location, "id" | "area_id">): CreatePrefill => ({
  areaId: location.area_id,
  locationId: location.id,
});

/** Moves focus to a new record's agenda row once it is on screen, if focus is still where the dialog left it. */
function focusRowWhenPresent(kind: string, id: string, left: HTMLElement | null, frames = 60) {
  const attempt = (remaining: number) => {
    const active = document.activeElement;
    // A dialog closing leaves focus on the body (or nowhere) for a moment, then on `left`.
    if (active && active !== document.body && active !== left) return;
    const row = agendaRow(kind, id);
    if (row?.isConnected) row.focus();
    else if (remaining > 0) requestAnimationFrame(() => attempt(remaining - 1));
  };
  requestAnimationFrame(() => attempt(frames));
}

/**
 * Opens a manager's new-record dialog when a request for its kind arrives, and gives focus back afterwards:
 * to the new record's agenda row once it was saved, else to the control that asked, else to the start of the
 * plan (a map point is gone once the workspace has moved to the plan).
 */
export function useInPlaceCreate(
  kind: CreateKind,
  request: CreateRequest | null | undefined,
  onHandled: (() => void) | undefined,
  start: (prefill: CreatePrefill) => void,
) {
  const started = useRef<{ returnTo: HTMLElement | null } | null>(null);
  const created = useRef<string | null>(null);
  const startRef = useRef(start);
  startRef.current = start;
  const handledRef = useRef(onHandled);
  handledRef.current = onHandled;

  useEffect(() => {
    if (request?.kind !== kind) return;
    started.current = { returnTo: request.returnTo ?? null };
    created.current = null;
    startRef.current(request.prefill);
    handledRef.current?.();
    // Only a new request (its token) starts a dialog.
  }, [request?.token, request?.kind, kind]);

  return {
    /** Called when the dialog saved a new record. */
    saved(id: string | undefined) {
      if (started.current && id) created.current = id;
    },
    /** For `RecordDialog`'s `returnFocus`: the element focus belongs on, or nothing for the dialog's own choice. */
    returnFocus(): HTMLElement | null {
      const origin = started.current;
      const id = created.current;
      started.current = null;
      created.current = null;
      if (!origin) return null;
      const row = id ? agendaRow(kind, id) : null;
      if (row?.isConnected) return row;
      // A controlled popup can recreate its trigger while keeping the same ID.
      // Resolve the live control rather than focusing a disconnected DOM snapshot.
      const currentOrigin = origin.returnTo?.isConnected
        ? origin.returnTo
        : origin.returnTo?.id
          ? document.getElementById(origin.returnTo.id)
          : null;
      const fallback = currentOrigin ?? agendaToggle();
      // The refreshed list can render a moment after the dialog closes: move on to the row once it appears,
      // unless the owner has already gone elsewhere.
      if (id) focusRowWhenPresent(kind, id, fallback);
      return fallback;
    },
  };
}
