import { Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth-context";
import { Capture } from "./pages/Capture";
import { Callback } from "./pages/Callback";
import { Library } from "./pages/Library";
import { OwnerHome } from "./pages/OwnerHome";
import { Trips } from "./pages/Trips";
import { TripDetail } from "./pages/TripDetail";
import { Settings } from "./pages/Settings";
import { TrackerRoutes } from "./tracker-routes";

function Tracker() {
  return <TrackerRoutes OwnerHome={OwnerHome} Trips={Trips} TripDetail={TripDetail} Capture={Capture} Settings={Settings} Library={Library} />;
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
