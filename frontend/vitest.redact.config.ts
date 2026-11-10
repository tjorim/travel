import { redact } from "@tanstack/redact/vite";
import { defineConfig } from "vitest/config";
import base from "./vite.config";

export default defineConfig(async (env) => {
  const config = typeof base === "function" ? await base(env) : await base;
  return {
    ...config,
    plugins: [
      redact({
        preset: "full",
        features: { hydration: false, activity: false, fragmentRefs: false },
      }),
      ...(config.plugins ?? []),
    ],
    test: {
      ...config.test,
      projects: undefined,
      environment: "happy-dom",
      include: ["src/trips/useInPlaceCreate.test.tsx"],
      setupFiles: ["./tests/redact-runtime-setup.ts", "./src/test-setup.ts"],
      server: { deps: { inline: true } },
      alias: {
        "@testing-library/react": new URL(
          "./node_modules/@testing-library/react/dist/@testing-library/react.esm.js",
          import.meta.url,
        ).pathname,
        "lucide-react": new URL(
          "./node_modules/lucide-react/dist/esm/lucide-react.mjs",
          import.meta.url,
        ).pathname,
      },
    },
  };
});
