import { createContext, useContext, useEffect, useId, useRef } from "react";

export type EditState = { dirty: boolean; pending: boolean; discard?: () => void };
export const NavigationGuardContext = createContext<
  ((id: string, state: EditState | null) => void) | null
>(null);
export const PendingEditContext = createContext<((pending: boolean) => void) | null>(null);

/** One shared router blocker, with independently registered editors (including inline forms). */
export function useEditGuard(dirty: boolean, pending = false, discard?: () => void) {
  const register = useContext(NavigationGuardContext);
  const id = useId();
  const discardRef = useRef(discard);
  discardRef.current = discard;
  useEffect(() => {
    register?.(id, { dirty, pending, discard: () => discardRef.current?.() });
    return () => register?.(id, null);
  }, [register, id, dirty, pending]);
}
