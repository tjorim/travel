import { useState } from "react";

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
  return {
    selected: items.find((item) => item.id === selectedId) ?? null,
    editing: editingId !== undefined,
    editingId,
    confirmDelete,
    setConfirmDelete,
    create() { setSelectedId(null); setEditingId(null); setConfirmDelete(false); },
    edit(id: string) { setSelectedId(id); setEditingId(id); setConfirmDelete(false); },
    inspect(id: string) { setSelectedId(id); setEditingId(undefined); setConfirmDelete(false); },
    close() { setSelectedId(null); setEditingId(undefined); setConfirmDelete(false); },
  };
}
