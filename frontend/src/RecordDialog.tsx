import { PendingEditContext, useEditGuard } from "./forms/navigation-guard";
import { m } from "./paraglide/messages.js";
import { LocaleControl, useLocale } from "./locale";
import { Button } from "@/ui/button";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { useEffect, useRef, useState, type ReactNode } from "react";

type RecordDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  className?: string;
  dirty?: boolean;
  /** A failure to report inside the dialog, where the owner is looking, such as a refused delete. */
  error?: string | null;
  onDismiss: () => void;
  onAfterClose?: () => void;
};

const backdrop = "fixed inset-0 bg-travel-backdrop/50 travel-backdrop-motion";
const viewport =
  "fixed inset-0 z-50 flex items-center justify-center overflow-y-auto max-[620px]:items-end";
const popup =
  "box-border mx-4 max-h-dvh w-full max-w-170 overflow-y-auto rounded-2xl border border-travel-border bg-travel-surface p-5.5 text-travel-ink shadow-2xl travel-popup-motion max-[620px]:mb-0 max-[620px]:max-w-none max-[620px]:rounded-b-none max-[620px]:p-4.5";
const confirmation =
  "grid gap-3 rounded-xl border-2 border-travel-warning bg-travel-warning-surface p-4";
const compactButton = "cursor-pointer rounded-lg px-3 py-2 text-sm font-bold";
const secondaryButton = "border border-travel-control-border bg-transparent text-travel-forest";
const dangerButton = "border-0 bg-travel-danger text-travel-on-action";
const buttonRow = "flex flex-wrap gap-2";

const ROW = "li, article, tr, [data-record-row]";
const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled])";

/** Remembers where a trigger sits in its list, to pick a surviving neighbour once a deletion removes it. */
function rememberPosition(origin: HTMLElement | null) {
  const row = origin?.closest<HTMLElement>(ROW) ?? null;
  const list = row?.parentElement ?? null;
  return {
    list,
    index: row && list ? Array.from(list.children).indexOf(row) : -1,
    section: origin?.closest<HTMLElement>("section") ?? null,
  };
}

/** The next record's control, else the previous one's, else the section's first control (New). */
function survivingTarget(position: ReturnType<typeof rememberPosition>): HTMLElement | null {
  const { list, index, section } = position;
  if (list?.isConnected) {
    const rows = Array.from(list.children);
    for (const row of [rows[index], rows[index - 1]]) {
      const target = row?.matches(ROW) ? row.querySelector<HTMLElement>(FOCUSABLE) : null;
      if (target) return target;
    }
  }
  return section?.isConnected ? section.querySelector<HTMLElement>(FOCUSABLE) : null;
}

/** Shared owner editor with guarded dismissal and focus return. */
export function RecordDialog({
  open,
  title,
  children,
  className,
  dirty = false,
  error,
  onDismiss,
  onAfterClose,
}: RecordDialogProps) {
  useLocale();
  const [pending, setPending] = useState(false);
  useEditGuard(open && dirty, open && pending, onDismiss);
  const origin = useRef<HTMLElement | null>(null);
  const scrollPosition = useRef({ x: 0, y: 0 });
  const position = useRef<ReturnType<typeof rememberPosition> | null>(null);
  const wasOpen = useRef(false);
  const continueEditing = useRef<HTMLButtonElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Controlled dialogs can open without a Base UI Trigger.
  if (open && !wasOpen.current && typeof document !== "undefined") {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    position.current = rememberPosition(origin.current);
    scrollPosition.current = { x: window.scrollX, y: window.scrollY };
  }
  wasOpen.current = open;

  useEffect(() => {
    if (!open) setConfirmDiscard(false);
  }, [open]);

  function dismiss() {
    if (pending || confirmDiscard) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onDismiss();
  }

  return (
    <PendingEditContext.Provider value={setPending}>
      <Dialog.Root
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) dismiss();
        }}
        onOpenChangeComplete={(nextOpen) => {
          if (!nextOpen) {
            if (scrollPosition.current.x || scrollPosition.current.y)
              window.scrollTo(scrollPosition.current.x, scrollPosition.current.y);
            onAfterClose?.();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={backdrop} />
          <Dialog.Viewport className={viewport}>
            <Dialog.Popup
              className={cn(popup, className)}
              finalFocus={() => {
                const trigger = origin.current;
                const where = position.current;
                if (!where) return trigger;
                if (trigger?.isConnected) {
                  // A deletion may remove the trigger after the dialog closes; move focus to a neighbour then.
                  const parent = where.list ?? trigger.parentElement;
                  if (parent) {
                    const observer = new MutationObserver(() => {
                      if (trigger.isConnected) return;
                      observer.disconnect();
                      const active = document.activeElement;
                      if (!active || active === document.body) survivingTarget(where)?.focus();
                    });
                    observer.observe(parent, { childList: true, subtree: true });
                    window.setTimeout(() => observer.disconnect(), 5000);
                  }
                  return trigger;
                }
                return survivingTarget(where) ?? trigger;
              }}
              aria-label={title}
            >
              <div className="mb-4.5 flex items-start justify-between gap-4">
                <Dialog.Title className="m-0">{title}</Dialog.Title>
                <Dialog.Close
                  className={cn(compactButton, secondaryButton)}
                  disabled={pending}
                  aria-label={m.owner_close({ p0: title })}
                >
                  {m.owner_close_2()}
                </Dialog.Close>
              </div>
              <div className="mb-4">
                <LocaleControl />
              </div>
              {error && (
                <p className="form-error mb-4" role="alert">
                  {error}
                </p>
              )}
              {children}
              <AlertDialog.Root
                open={confirmDiscard}
                onOpenChange={(nextOpen) => {
                  if (!nextOpen) setConfirmDiscard(false);
                }}
              >
                <AlertDialog.Portal>
                  <AlertDialog.Backdrop className={backdrop} />
                  <AlertDialog.Viewport className={viewport}>
                    <AlertDialog.Popup
                      className={cn(popup, confirmation, "max-w-md")}
                      initialFocus={continueEditing}
                    >
                      <AlertDialog.Title className="m-0">
                        {m.owner_discard_changes()}
                      </AlertDialog.Title>
                      <AlertDialog.Description className="m-0">
                        {m.owner_your_unsaved_changes_will_be_lost()}
                      </AlertDialog.Description>
                      <div className={buttonRow}>
                        <Button
                          className={cn(compactButton, dangerButton)}
                          type="button"
                          onClick={() => {
                            setConfirmDiscard(false);
                            onDismiss();
                          }}
                        >
                          {m.owner_discard_changes_2()}
                        </Button>
                        <AlertDialog.Close
                          className={cn(compactButton, secondaryButton)}
                          ref={continueEditing}
                        >
                          {m.owner_continue_editing()}
                        </AlertDialog.Close>
                      </div>
                    </AlertDialog.Popup>
                  </AlertDialog.Viewport>
                </AlertDialog.Portal>
              </AlertDialog.Root>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </PendingEditContext.Provider>
  );
}

type DeleteConfirmationProps = {
  title: string;
  description?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  /** Detail to review between the description and the buttons, such as what a change will alter. */
  children?: ReactNode;
};

export function DeleteConfirmation({
  title,
  description = m.owner_this_action_cannot_be_undone(),
  confirmLabel = m.owner_delete(),
  onCancel,
  onConfirm,
  cancelLabel = m.cancel(),
  confirmDisabled = false,
  children,
}: DeleteConfirmationProps) {
  useLocale();
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root open onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdrop} />
        <AlertDialog.Viewport className={viewport}>
          <AlertDialog.Popup className={cn(popup, confirmation, "max-w-md")} initialFocus={cancel}>
            <AlertDialog.Title className="m-0">{title}</AlertDialog.Title>
            <AlertDialog.Description className="m-0">{description}</AlertDialog.Description>
            {children}
            <div className={buttonRow}>
              <Button
                className={cn(compactButton, dangerButton)}
                type="button"
                disabled={confirmDisabled}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
              <AlertDialog.Close className={cn(compactButton, secondaryButton)} ref={cancel}>
                {cancelLabel}
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
