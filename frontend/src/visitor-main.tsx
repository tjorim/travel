import { LocaleBoundary, LocaleControl } from "./locale";
import { AppearanceControl } from "./appearance";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { VisitorRoutes } from "./visitor-routes";
import "./styles.css";
import "./tailwind.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleBoundary>
      <LocaleControl />
      <AppearanceControl />
      <VisitorRoutes />
    </LocaleBoundary>
  </StrictMode>,
);
