import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4174);
export default defineConfig({
  timeout: 60_000,
  outputDir: "./test-results-offline",
  testDir: "./e2e-production",
  fullyParallel: true,
  use: {
    baseURL: `http://localhost:${port}`,
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/admin/`,
    reuseExistingServer: false,
  },
});
