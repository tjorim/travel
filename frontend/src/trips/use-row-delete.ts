import { useRef, useState } from "react";

import {
  focusReturnTarget,
  liveElement,
  rememberPosition,
  type TriggerPosition,
} from "../RecordDialog";

type Origin = { trigger: HTMLElement | null; where: TriggerPosition };

/**
 * The record a delete confirmation asks about. It is asked from a record's own dialog (`ask`, which keeps that
 * dialog's focus handling) or straight from an agenda row's menu with no dialog open (`askFromRow`): once the
 * question is answered, focus returns to the row's menu button, or to the next row when the deleted record has left
 * the list.
 */
export function useRowDelete<T>() {
  const [target, setTarget] = useState<T | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  return {
    target,
    ask: (item: T) => setTarget(item),
    /** `from` is the row's menu button, which focus returns to. */
    askFromRow(item: T, from: HTMLElement | null) {
      // A menu's button can be recreated while its menu closes: look for the one on screen now.
      const trigger = liveElement(from);
      setOrigin({ trigger, where: rememberPosition(trigger) });
      setTarget(item);
    },
    clear() {
      setTarget(null);
      setOrigin(null);
      // The question is a dialog that unmounts as it is answered, which hands focus back to nothing in particular.
      if (origin)
        requestAnimationFrame(() => focusReturnTarget(origin.trigger, origin.where)?.focus());
    },
  };
}

/**
 * The agenda row's menu button that opened a record's dialog, so focus goes back to it on closing: a menu hands
 * focus around while it closes, so the dialog's own guess of where it was opened from can be the wrong element.
 */
export function useReturnTarget() {
  const target = useRef<HTMLElement | null>(null);
  return {
    remember(element: HTMLElement | null | undefined) {
      target.current = element ?? null;
    },
    /**
     * For `RecordDialog`'s `returnFocus`: the button while it is still on screen, else the dialog's own choice. It may
     * be asked more than once while the dialog closes; the next request replaces it.
     */
    take(): HTMLElement | null {
      return liveElement(target.current);
    },
  };
}
