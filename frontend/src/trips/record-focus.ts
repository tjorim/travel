import type { DialogFocusRequest } from "../forms/useRecordDialog";

/** The record kinds whose dialog the workspace can open on arrival, from an Agenda row, the map or the overview. */
export const RECORD_KINDS = [
  "stay",
  "route",
  "visit",
  "area",
  "location",
  "task",
  "update",
  "document",
  "media",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** The kinds a map marker or line can open. */
export type MapRecordKind = Extract<RecordKind, "area" | "location" | "visit" | "route" | "update">;

export type RecordFocus = { kind: RecordKind } & DialogFocusRequest;

/** The request for one manager: only when it is addressed to that kind of record. */
export const focusFor = (focus: RecordFocus | null, kind: RecordKind): RecordFocus | null =>
  focus?.kind === kind ? focus : null;
