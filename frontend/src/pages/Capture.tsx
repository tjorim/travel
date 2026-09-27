import { useLocation, useNavigate } from "react-router-dom";

import { CaptureDialog } from "../trips/CaptureDialog";
import type { VisitCandidateIntent } from "../tracker-model";

/** The `/capture` deep link: the global "Vastleggen" entry with no trip context, and any
 * shared link into the same dialog the trip-header action opens over its workspace. */
export function Capture() {
  const location = useLocation();
  const navigate = useNavigate();
  const candidate = (location.state as { candidate?: VisitCandidateIntent } | null)?.candidate ?? null;

  function close() {
    navigate("/trips");
  }

  return <CaptureDialog open candidate={candidate} onCandidateConsumed={() => navigate("/capture", { replace: true, state: null })} onDismiss={close} />;
}
