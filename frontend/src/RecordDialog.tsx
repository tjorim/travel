import { m } from "./paraglide/messages.js";
import { LocaleControl, useLocale } from "./locale";
import { Button } from "@base-ui/react/button";
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

const backdrop = "fixed inset-0 bg-travel-backdrop/50";
const viewport =
  "fixed inset-0 z-50 flex items-center justify-center overflow-y-auto max-[620px]:items-end";
const popup =
  "box-border mx-4 max-h-dvh w-full max-w-170 overflow-y-auto rounded-2xl border border-travel-border bg-travel-surface p-5.5 text-travel-ink shadow-2xl max-[620px]:mb-0 max-[620px]:max-w-none max-[620px]:rounded-b-none max-[620px]:p-4.5";
const confirmation =
  "grid gap-3 rounded-xl border-2 border-travel-warning bg-travel-warning-surface p-4";
const compactButton = "cursor-pointer rounded-lg px-3 py-2 text-sm font-bold";
const secondaryButton = "border border-travel-control-border bg-transparent text-travel-forest";
const dangerButton = "border-0 bg-travel-danger text-travel-on-action";
const buttonRow = "flex flex-wrap gap-2";

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
  const origin = useRef<HTMLElement | null>(null);
  const scrollPosition = useRef({ x: 0, y: 0 });
  const wasOpen = useRef(false);
  const continueEditing = useRef<HTMLButtonElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Controlled dialogs can open without a Base UI Trigger.
  if (open && !wasOpen.current && typeof document !== "undefined") {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    scrollPosition.current = { x: window.scrollX, y: window.scrollY };
  }
  wasOpen.current = open;

  useEffect(() => {
    if (!open) setConfirmDiscard(false);
  }, [open]);

  function dismiss() {
    if (confirmDiscard) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onDismiss();
  }

  return (
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
            finalFocus={() => origin.current}
            aria-label={title}
          >
            <div className="mb-4.5 flex items-start justify-between gap-4">
              <Dialog.Title className="m-0">{title}</Dialog.Title>
              <Dialog.Close
                className={cn(compactButton, secondaryButton)}
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
  );
}

type DeleteConfirmationProps = {
  title: string;
  description?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteConfirmation({
  title,
  description = m.owner_this_action_cannot_be_undone(),
  confirmLabel = m.owner_delete(),
  onCancel,
  onConfirm,
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
            <div className={buttonRow}>
              <Button className={cn(compactButton, dangerButton)} type="button" onClick={onConfirm}>
                {confirmLabel}
              </Button>
              <AlertDialog.Close className={cn(compactButton, secondaryButton)} ref={cancel}>
                {m.cancel()}
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
