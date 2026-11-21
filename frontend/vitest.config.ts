import { paraglideVitePlugin } from "@inlang/paraglide-js";
import react from "@vitejs/plugin-react";
import { availableParallelism } from "node:os";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  plugins: [
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      strategy: ["custom-travel", "baseLocale"],
      emitTsDeclarations: true,
      // Group messages like `pnpm dev` so a cold test worker does not load thousands of modules.
      outputStructure: "message-modules",
      messageModuleSize: 100,
    }),
    react(),
  ],
  test: {
    // Suites that need a DOM opt in with a `// @vitest-environment happy-dom` docblock; the rest run in Node.
    // Playwright specs in e2e/ run with `pnpm test:e2e`, not under Vitest.
    exclude: [...configDefaults.exclude, "e2e/**", "e2e-production/**"],
    setupFiles: ["./tests/setup.ts"],
    // The DOM suites render whole Base UI + TanStack form trees, and each file pays its own cold import of that
    // graph (isolation re-evaluates ~200 modules per file). Alone a test takes under 2 s, but on a busy host the same
    // test measured 5 to 30 s, so Vitest's 5 s default only reports load, not defects. A project-wide ceiling replaces
    // per-test overrides; a genuine hang still fails, just later. Keep it above testing-library's 5 s asyncUtilTimeout
    // in tests/setup.ts so a missing element reports its own error before the test times out.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Vitest sizes the pool to the host (39-41 workers observed), and every worker boots its own DOM environment and module
    // graph. On a machine that is already busy that oversubscribes CPU and memory, so cap the pool; small hosts stay
    // at Vitest's own default of one worker per core minus one.
    maxWorkers: Math.min(Math.max(availableParallelism() - 1, 1), 8),
    // `isolate: false` was evaluated and rejected. On a 4-core host it saved CPU time (user time about 3m20s to 1m25s)
    // but not wall time (66 s either way), and 4 files / 13 tests failed on its first run, with different tests failing
    // on the next, because files that each clean up only for their own isolation now shared a worker.
    // Revisit it per file group, not globally.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/paraglide/**", "src/main.tsx", "src/assets/**"],
      reporter: ["text", "lcov"],
    },
  },
});
