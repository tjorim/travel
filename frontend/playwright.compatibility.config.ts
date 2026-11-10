import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";
const baseURL = "http://localhost:4192";
export default defineConfig({
  ...base,
  workers: 1,
  testMatch: ["**/create-in-place.spec.ts", "**/route-map.spec.ts"],
  use: { ...base.use, baseURL, launchOptions: {} },
  projects: ["firefox", "webkit"].map((browser) => ({
    name: browser,
    use: {
      ...devices[browser === "firefox" ? "Desktop Firefox" : "Desktop Safari"],
      ...(browser === "firefox" && process.env.REMOTE_FIREFOX_WS_ENDPOINT
        ? { connectOptions: { wsEndpoint: process.env.REMOTE_FIREFOX_WS_ENDPOINT } }
        : {}),
      ...(browser === "webkit" && process.env.REMOTE_WEBKIT_WS_ENDPOINT
        ? { connectOptions: { wsEndpoint: process.env.REMOTE_WEBKIT_WS_ENDPOINT } }
        : {}),
    },
  })),
  webServer: {
    command: `pnpm exec vite ${process.env.COMPATIBILITY_NATIVE_REACT ? "-c vite.compatibility.config.ts" : ""} --port 4192 --strictPort`,
    url: baseURL + "/admin/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
