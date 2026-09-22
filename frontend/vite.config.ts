import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function visitorRoutes(): Plugin {
  const rewrite = (request: { url?: string }, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    const path = request.url?.split("?", 1)[0] ?? "";
    if (path === "/") request.url = "/admin/landing.html";
    if (/^\/trips(?:\/|$)/.test(path)) request.url = "/admin/public.html";
    if (/^\/share(?:\/|$)/.test(path)) {
      request.url = "/admin/share.html";
      response.setHeader("Cache-Control", "no-store, private");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Robots-Tag", "noindex, noarchive");
    }
    next();
  };
  return {
    name: "travel-visitor-routes",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

export default defineConfig({
  base: "/admin/",
  plugins: [react(), visitorRoutes()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        admin: new URL("./index.html", import.meta.url).pathname,
        landing: new URL("./landing.html", import.meta.url).pathname,
        public: new URL("./public.html", import.meta.url).pathname,
        share: new URL("./share.html", import.meta.url).pathname,
      },
    },
  },
});
