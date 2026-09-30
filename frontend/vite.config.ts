import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// What Caddy sends for `/share/*` (Caddyfile.example): the capability route is never cached, indexed or sent on as a
// referrer. Vite's own HTML middleware would otherwise replace Cache-Control with `no-cache`.
const shareHeaders = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, noarchive",
};

function visitorRoutes(): Plugin {
  const rewrite = (request: { url?: string }, response: ServerResponse, next: () => void) => {
    const path = request.url?.split("?", 1)[0] ?? "";
    if (path === "/") request.url = "/admin/landing.html";
    if (/^\/trips(?:\/|$)/.test(path)) request.url = "/admin/public.html";
    if (/^\/share(?:\/|$)/.test(path)) {
      request.url = "/admin/share.html";
      const pinned = new Set(Object.keys(shareHeaders).map((name) => name.toLowerCase()));
      const setHeader = response.setHeader.bind(response);
      for (const [name, value] of Object.entries(shareHeaders)) setHeader(name, value);
      // Later middleware may not override these.
      response.setHeader = (name, value) => (pinned.has(name.toLowerCase()) ? response : setHeader(name, value));
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

// Local sign-in without Keycloak, kept out of the application code: with the
// same TRAVEL_DEV_AUTH_BYPASS_TOKEN the API runs with (development only), the
// dev proxy authenticates `/api` requests with it and the dev server seeds the
// owner PWA's browser session, as an OIDC sign-in would have left behind, before
// the app loads. Unset, `/admin/` signs in through Keycloak as in production.
const devBypassToken = process.env.TRAVEL_DEV_AUTH_BYPASS_TOKEN;

function devSession(): Plugin {
  // Mirrors auth.ts. The subject must match app/auth.py's DEV_BYPASS_SUBJECT so
  // the per-owner query cache is keyed like the API's owner.
  const seed = `
    const encode = (value) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    sessionStorage.setItem("travel-tracker-session", JSON.stringify({
      accessToken: encode({ alg: "none" }) + "." + encode({ sub: "dev-bypass-user" }) + ".",
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    }));`;
  return {
    name: "travel-dev-session",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler: (html, context) =>
        context.filename.endsWith("/frontend/index.html")
          ? html.replace("<head>", `<head><script>${seed}</script>`)
          : html,
    },
  };
}

export default defineConfig({
  base: "/admin/",
  test: { setupFiles: ["./src/test-setup.ts"] },
  plugins: [react(), tailwindcss(), visitorRoutes(), ...(devBypassToken ? [devSession()] : [])],
  // Mirrors Caddy's `/api/*` route so `pnpm dev` reaches a locally running API.
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        // The seeded session's token is unsigned; the API only accepts the bypass token itself.
        ...(devBypassToken ? { headers: { Authorization: `Bearer ${devBypassToken}` } } : {}),
      },
    },
  },
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
