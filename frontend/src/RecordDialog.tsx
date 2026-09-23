import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type RecordDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  dirty?: boolean;
  onDismiss: () => void;
  onAfterClose?: () => void;
};

/** A bounded owner-only record editor. Native dialogs provide the focus trap and
 * return focus to the control that opened them; the CSS turns it into a sheet
 * on narrow screens. */
export function RecordDialog({ open, title, children, dirty = false, onDismiss, onAfterClose }: RecordDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const scrollPosition = useRef({ x: 0, y: 0 });
  const headingId = useId();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      scrollPosition.current = { x: window.scrollX, y: window.scrollY };
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    }
    if (!open && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
      origin.current?.focus({ preventScroll: true });
      if (scrollPosition.current.x || scrollPosition.current.y) window.scrollTo(scrollPosition.current.x, scrollPosition.current.y);
    }
  }, [open]);

  function dismiss() {
    if (dirty) { setConfirmDiscard(true); return; }
    onDismiss();
  }

  return <dialog ref={dialog} className="record-dialog" aria-labelledby={headingId} onCancel={(event) => { event.preventDefault(); dismiss(); }} onClose={() => { if (open) onDismiss(); onAfterClose?.(); }}>
    <div className="record-dialog-header">
      <h2 id={headingId}>{title}</h2>
      <button className="secondary compact" type="button" aria-label={`${title} sluiten`} onClick={dismiss}>Sluiten</button>
    </div>
    {children}
    {confirmDiscard && <div className="record-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${headingId}-discard`}>
      <h3 id={`${headingId}-discard`}>Wijzigingen verwerpen?</h3>
      <p>Je niet-opgeslagen wijzigingen gaan verloren.</p>
      <div className="button-row"><button className="danger compact" type="button" onClick={() => { setConfirmDiscard(false); onDismiss(); }}>Wijzigingen verwerpen</button><button className="secondary compact" type="button" autoFocus onClick={() => setConfirmDiscard(false)}>Verder bewerken</button></div>
    </div>}
  </dialog>;
}

export function DeleteConfirmation({ title, onCancel, onConfirm }: { title: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="record-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-record-title">
    <h3 id="delete-record-title">{title}</h3>
    <p>Deze actie kan niet ongedaan worden gemaakt.</p>
    <div className="button-row"><button className="danger compact" type="button" autoFocus onClick={onConfirm}>Verwijderen</button><button className="secondary compact" type="button" onClick={onCancel}>Annuleren</button></div>
  </div>;
}
