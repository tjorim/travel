import { LocaleBoundary } from "@/i18n/locale";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "@/styles/app.css";
import "@/styles/tailwind.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/admin/service-worker.js"),
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleBoundary>
      <App />
    </LocaleBoundary>
  </StrictMode>,
);
