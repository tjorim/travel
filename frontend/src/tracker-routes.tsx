import type { ComponentType, ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { Boundary } from "./Boundary";

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card"><h2>{title}</h2><p>{children}</p></section>;
}

export function TrackerRoutes({ Trips, Capture, Settings }: { Trips: ComponentType; Capture: ComponentType; Settings: ComponentType }) {
  return (
    <Boundary>
      <Routes>
        <Route path="/" element={<EmptyState title="Nog geen actieve reis">Maak straks een private reis aan en kies later bewust wat je deelt.</EmptyState>} />
        <Route path="/trips" element={<Trips />} />
        <Route path="/capture" element={<Capture />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Boundary>
  );
}
