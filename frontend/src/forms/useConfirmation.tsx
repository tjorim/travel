import { useState, type ReactNode } from "react";

import { DeleteConfirmation } from "../RecordDialog";

export type ConfirmationRequest = {
  title: string | (() => string);
  description?: string | (() => string);
  confirmLabel?: string | (() => string);
  onConfirm: () => void;
};

/**
 * An accessible in-app replacement for `window.confirm`. Call `ask` from an
 * event handler and render `dialog` once in the component; the action only runs
 * after the owner confirms, and dismissing returns focus to the opening control.
 */
export function useConfirmation(): { ask: (request: ConfirmationRequest) => void; dialog: ReactNode } {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const close = () => setRequest(null);
  return {
    ask: setRequest,
    dialog: request && (
      <DeleteConfirmation
        title={typeof request.title === "function" ? request.title() : request.title}
        description={typeof request.description === "function" ? request.description() : request.description}
        confirmLabel={typeof request.confirmLabel === "function" ? request.confirmLabel() : request.confirmLabel}
        onCancel={close}
        onConfirm={() => {
          close();
          request.onConfirm();
        }}
      />
    ),
  };
}
