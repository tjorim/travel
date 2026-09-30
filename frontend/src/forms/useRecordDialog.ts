import { useFeedback } from "../query/feedback";
import { useEffect, useState } from "react";

/** A request from elsewhere on the page to open a specific record's dialog; the token makes
 * repeat requests for the same id trigger again. */
export type DialogFocusRequest = { id: string; token: number };

/**
 * Which record a manager's dialog shows and whether it is being edited.
 * The record is looked up by id in the current list on every render, so the
 * dialog can never show a copy that is older than the last refetch.
 */
export function useRecordDialog<T extends { id: string }>(items: readonly T[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // undefined: not editing; null: a new record; a string: the record being edited.
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A failure that belongs to the open record, such as a refused delete; shown inside the dialog, not behind it.
  const [error, setError] = useFeedback<string | null>(null);
  return {
    selected: items.find((item) => item.id === selectedId) ?? null,
    editing: editingId !== undefined,
    editingId,
    confirmDelete,
    setConfirmDelete,
    error,
    setError,
    create() {
      setSelectedId(null);
      setEditingId(null);
      setConfirmDelete(false);
      setError(null);
    },
    edit(id: string) {
      setSelectedId(id);
      setEditingId(id);
      setConfirmDelete(false);
      setError(null);
    },
    inspect(id: string) {
      setSelectedId(id);
      setEditingId(undefined);
      setConfirmDelete(false);
      setError(null);
    },
    close() {
      setSelectedId(null);
      setEditingId(undefined);
      setConfirmDelete(false);
      setError(null);
    },
  };
}

/** Opens `inspect(id)` whenever another part of the page (the Agenda) asks to focus a record. */
export function useDialogFocus(request: DialogFocusRequest | null | undefined, inspect: (id: string) => void) {
  useEffect(() => {
    if (request) inspect(request.id);
    // `inspect` is a fresh closure every render, so it isn't a dependency: only a new `request` should retrigger this.
  }, [request]);
}
