import { useEffect, useRef, useState } from "react";

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

/**
 * The requests that open one editor's dialog on an existing record: the workspace's (an agenda row, the map) and
 * the block's own (a list entry), as the one `focusId` the editor takes. `open(id)` is the block's own request.
 */
export function useFocusRequest(external: DialogFocusRequest | null | undefined) {
  const [request, setRequest] = useState<DialogFocusRequest | null>(external ?? null);
  const own = useRef(0);
  useEffect(() => {
    if (external) setRequest(external);
  }, [external]);
  return {
    focusId: request,
    // A negative token never collides with the workspace's, which counts up.
    open: (id: string) => setRequest({ id, token: -(own.current += 1) }),
  };
}
