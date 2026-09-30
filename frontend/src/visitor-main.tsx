import { LocaleBoundary } from "./locale";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { VisitorRoutes } from "./visitor-routes";
import "./styles.css";
import "./tailwind.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleBoundary>
      <VisitorRoutes />
    </LocaleBoundary>
  </StrictMode>,
);
