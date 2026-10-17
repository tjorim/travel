import { Navigate, useParams } from "@tanstack/react-router";

import { Trips, type TripWorkspaceSection } from "./Trips";

const sections = new Set<TripWorkspaceSection>([
  "overview",
  "plan",
  "packing",
  "story",
  "media",
  "sharing",
]);

export function TripWorkspace() {
  const { tripId, section } = useParams({ strict: false });
  if (!tripId) return <Navigate to="/trips" replace />;
  if (section && !sections.has(section as TripWorkspaceSection))
    return <Navigate to={`/trips/${encodeURIComponent(tripId)}`} replace />;
  return (
    <Trips
      workspace={{ tripId, section: (section as TripWorkspaceSection | undefined) ?? "overview" }}
    />
  );
}
