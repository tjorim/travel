import { useLocation, useNavigate } from "@tanstack/react-router";

import { CaptureDialog } from "../trips/CaptureDialog";
import type { VisitCandidateIntent } from "../tracker-model";

/** The `/capture` deep link: the global "Vastleggen" entry with no trip context, and any
 * shared link into the same dialog the trip-header action opens over its workspace. */
export function Capture() {
  const location = useLocation();
  const navigate = useNavigate();
  const candidate = (location.state as { candidate?: VisitCandidateIntent } | undefined)?.candidate ?? null;

  function close() {
    void navigate({ to: "/trips" });
  }

  return <CaptureDialog open candidate={candidate} onCandidateConsumed={() => void navigate({ to: "/capture", replace: true, state: {} })} onDismiss={close} />;
}
