import { RouterProvider } from "@tanstack/react-router";

import { Capture } from "./pages/Capture";
import { Callback } from "./pages/Callback";
import { Library } from "./pages/Library";
import { OwnerHome } from "./pages/OwnerHome";
import { Trips } from "./pages/Trips";
import { TripDetail } from "./pages/TripDetail";
import { TripWorkspace } from "./pages/TripWorkspace";
import { Settings } from "./pages/Settings";
import { buildTrackerRouteTree, createTrackerRouter } from "./router";

const routeTree = buildTrackerRouteTree({ Callback, OwnerHome, Trips, TripWorkspace, TripDetail, Capture, Library, Settings });
const router = createTrackerRouter(routeTree, { basepath: "/admin" });

export function App() {
  return <RouterProvider router={router} />;
}
