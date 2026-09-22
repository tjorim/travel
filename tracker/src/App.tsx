import { Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth-context";
import { Capture } from "./pages/Capture";
import { Callback } from "./pages/Callback";
import { Trips } from "./pages/Trips";
import { TrackerRoutes } from "./tracker-routes";

function Tracker() {
  return <TrackerRoutes Trips={Trips} Capture={Capture} />;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/auth/callback" element={<Callback />} />
        <Route path="*" element={<Tracker />} />
      </Routes>
    </AuthProvider>
  );
}
