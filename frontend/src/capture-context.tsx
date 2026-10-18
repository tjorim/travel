import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { lazyNamed } from "./lazy-view";
import type { TravelUpdateCandidateIntent } from "./tracker-model";

// The form is fetched the first time anyone captures, not with the shell.
const CaptureDialog = lazyNamed(() => import("./trips/CaptureDialog"), "CaptureDialog", {
  overlay: true,
});

export type CaptureRequest = {
  /** Lock the dialog to this trip; omit to let the owner choose. */
  tripId?: string | null;
  /** A possible travel update from the media review, to start the form from. */
  candidate?: TravelUpdateCandidateIntent | null;
};

const CaptureContext = createContext<(request?: CaptureRequest) => void>(() => undefined);

/** Opens the capture dialog from anywhere below `CaptureProvider`. */
export const useCapture = () => useContext(CaptureContext);

/** Owns the one capture dialog for the signed-in app, so every entry point opens the same form. */
export function CaptureProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<CaptureRequest>({});
  const [requested, setRequested] = useState(false);
  const [open, setOpen] = useState(false);
  const openCapture = useCallback((next: CaptureRequest = {}) => {
    setRequest(next);
    setRequested(true);
    setOpen(true);
  }, []);
  const value = useMemo(() => openCapture, [openCapture]);
  return (
    <CaptureContext.Provider value={value}>
      {children}
      {requested && (
        <CaptureDialog
          open={open}
          lockedTripId={request.tripId ?? null}
          candidate={request.candidate ?? null}
          onCandidateConsumed={() => setRequest((current) => ({ ...current, candidate: null }))}
          onDismiss={() => {
            setOpen(false);
            setRequest((current) => ({ ...current, candidate: null }));
          }}
        />
      )}
    </CaptureContext.Provider>
  );
}
