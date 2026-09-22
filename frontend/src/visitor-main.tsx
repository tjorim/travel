import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { VisitorRoutes } from "./visitor-routes";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <VisitorRoutes />
    </BrowserRouter>
  </StrictMode>,
);
