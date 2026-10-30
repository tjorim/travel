import { flushSync } from "react-dom";
import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DeleteConfirmation } from "../RecordDialog";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { NavigationGuardContext, type EditState } from "./navigation-guard";

export function NavigationGuard({ children }: { children: ReactNode }) {
  useLocale();
  const edits = useRef(new Map<string, EditState>());
  const [state, setState] = useState<EditState>({ dirty: false, pending: false });
  const register = useCallback((id: string, next: EditState | null) => {
    if (next) edits.current.set(id, next);
    else edits.current.delete(id);
    const values = [...edits.current.values()];
    const dirty = values.some((value) => value.dirty);
    const pending = values.some((value) => value.pending);
    setState((previous) =>
      previous.dirty === dirty && previous.pending === pending ? previous : { dirty, pending },
    );
  }, []);
  const blocker = useBlocker({
    shouldBlockFn: () => [...edits.current.values()].some((edit) => edit.dirty || edit.pending),
    enableBeforeUnload: state.dirty || state.pending,
    withResolver: true,
  });
  // A request may finish while navigation is waiting. Require a fresh navigation
  // after success so an old Back action cannot race a save's own redirect.
  useEffect(() => {
    if (blocker.status === "blocked" && !state.dirty && !state.pending) blocker.reset();
  }, [blocker, state.dirty, state.pending]);
  return (
    <NavigationGuardContext.Provider value={register}>
      {children}
      {blocker.status === "blocked" && (
        <DeleteConfirmation
          title={state.pending ? m.owner_save_in_progress() : m.owner_discard_changes()}
          description={
            state.pending ? m.owner_wait_for_save() : m.owner_your_unsaved_changes_will_be_lost()
          }
          confirmLabel={m.owner_discard_changes_2()}
          cancelLabel={m.owner_continue_editing()}
          confirmDisabled={state.pending}
          onCancel={blocker.reset}
          onConfirm={() => {
            blocker.proceed();
            flushSync(() => {
              for (const edit of edits.current.values()) if (edit.dirty) edit.discard?.();
            });
          }}
        />
      )}
    </NavigationGuardContext.Provider>
  );
}
