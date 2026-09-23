import { Navigate, useParams } from "react-router-dom";

import { Trips, type TripWorkspaceSection } from "./Trips";

const sections = new Set<TripWorkspaceSection>(["overview", "plan", "story", "media", "sharing"]);

export function TripWorkspace() {
  const { tripId, section } = useParams();
  if (!tripId) return <Navigate to="/trips" replace />;
  if (section && !sections.has(section as TripWorkspaceSection)) return <Navigate to={`/trips/${encodeURIComponent(tripId)}`} replace />;
  return <Trips workspace={{ tripId, section: (section as TripWorkspaceSection | undefined) ?? "overview" }} />;
}
