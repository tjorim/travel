import { useState } from "react";

import type { AgendaRecordKind, AgendaStatusGroup } from "./agenda-items";

/** The agenda's two filters: which kinds and which statuses to show. Nothing chosen in a group means all of them. */
export type AgendaFilter = {
  kinds: AgendaRecordKind[];
  statuses: AgendaStatusGroup[];
};

export const NO_FILTER: AgendaFilter = { kinds: [], statuses: [] };

export const AGENDA_KINDS: readonly AgendaRecordKind[] = ["visit", "stay", "route"];
export const AGENDA_STATUSES: readonly AgendaStatusGroup[] = ["plan", "idea", "cancelled"];

export const isFiltered = (filter: AgendaFilter): boolean =>
  filter.kinds.length > 0 || filter.statuses.length > 0;

/** One key per trip: a convenience of this browser, never part of the address, history or the API. */
export const agendaFilterKey = (tripId: string) => `travel-agenda-filter:${tripId}`;

const only = <T extends string>(value: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(value)
    ? allowed.filter((candidate) => (value as unknown[]).includes(candidate))
    : [];

/** The saved filter of a trip, or none when nothing valid is stored or storage is unavailable. */
export function readAgendaFilter(tripId: string): AgendaFilter {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(agendaFilterKey(tripId)) ?? "null");
    if (typeof stored !== "object" || stored === null) return NO_FILTER;
    const { kinds, statuses } = stored as Record<string, unknown>;
    return { kinds: only(kinds, AGENDA_KINDS), statuses: only(statuses, AGENDA_STATUSES) };
  } catch {
    return NO_FILTER;
  }
}

/** Remembers the filter; the agenda keeps working in memory when storage is denied or full. */
export function writeAgendaFilter(tripId: string, filter: AgendaFilter): void {
  try {
    if (isFiltered(filter)) localStorage.setItem(agendaFilterKey(tripId), JSON.stringify(filter));
    else localStorage.removeItem(agendaFilterKey(tripId));
  } catch {
    // The filter still applies for this visit.
  }
}

/** The agenda's filter for one trip, restored from this browser and saved whenever it changes. */
export function useAgendaFilter(tripId: string) {
  const [filter, setFilter] = useState(() => readAgendaFilter(tripId));
  return {
    filter,
    setFilter(next: AgendaFilter) {
      setFilter(next);
      writeAgendaFilter(tripId, next);
    },
  };
}
