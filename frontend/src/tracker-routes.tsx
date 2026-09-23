import type { ComponentType, ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { Boundary } from "./Boundary";

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card"><h2>{title}</h2><p>{children}</p></section>;
}

export function TrackerRoutes({ OwnerHome, Trips, TripDetail, TripWorkspace, Capture, Settings, Library }: { OwnerHome: ComponentType; Trips: ComponentType; TripDetail: ComponentType; TripWorkspace: ComponentType; Capture: ComponentType; Settings: ComponentType; Library: ComponentType }) {
  return (
    <Boundary>
      <Routes>
        <Route path="/" element={<OwnerHome />} />
        <Route path="/trips" element={<Trips />} />
        <Route path="/trips/:tripId" element={<TripWorkspace />} />
        <Route path="/trips/:tripId/:section" element={<TripWorkspace />} />
        <Route path="/trips/:tripId/details" element={<TripDetail />} />
        <Route path="/capture" element={<Capture />} />
        <Route path="/library" element={<Library />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Boundary>
  );
}
