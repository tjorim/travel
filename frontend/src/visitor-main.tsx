import { LocaleBoundary } from "@/i18n/locale";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { VisitorRoutes } from "./visitor-routes";
import "@/styles/app.css";
import "@/styles/tailwind.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleBoundary>
      <VisitorRoutes />
    </LocaleBoundary>
  </StrictMode>,
);
