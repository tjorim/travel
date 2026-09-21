import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import "./styles.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/tracker/service-worker.js"));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/tracker">
      <App />
    </BrowserRouter>
  </StrictMode>,
);
