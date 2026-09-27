import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { VisitorRoutes } from "./visitor-routes";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VisitorRoutes />
  </StrictMode>,
);
