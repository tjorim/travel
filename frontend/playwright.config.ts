import { defineConfig, devices } from "@playwright/test";

// Another dev server may already hold the default port (for example from a second worktree).
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);

// Browser smoke checks against the Vite dev server with the API mocked in the page (see e2e/mock-api.ts), so no owner
// session, database or media is needed. Authenticated runs against a real Keycloak realm are out of scope.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    // The owner PWA registers a service worker; a cached one would hide the mocked routes.
    serviceWorkers: "block",
    // Layers fade and slide in for visitors who allow motion; the checks run without it so an axe pass never samples a
    // half-transparent dialog. e2e/motion.spec.ts opts back in.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    launchOptions: {
      // Lets a host with its own Chromium build skip `playwright install`; unset in CI.
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/admin/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
