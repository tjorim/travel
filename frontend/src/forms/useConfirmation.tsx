import { useState, type ReactNode } from "react";

import { DeleteConfirmation, RecordDialog } from "../RecordDialog";

export type ConfirmationRequest = {
  title: string;
  description?: string;
  confirmLabel?: string;
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
      <RecordDialog open title="Bevestigen" onDismiss={close}>
        <DeleteConfirmation
          title={request.title}
          description={request.description}
          confirmLabel={request.confirmLabel}
          onCancel={close}
          onConfirm={() => {
            close();
            request.onConfirm();
          }}
        />
      </RecordDialog>
    ),
  };
}
