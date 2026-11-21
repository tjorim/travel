import { paraglideVitePlugin } from "@inlang/paraglide-js";
import react from "@vitejs/plugin-react";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// Tests compile their own Paraglide output and `@/paraglide` resolves there during tests. With coverage on, Vitest
// starts a second Vite server whose Paraglide plugin rewrote `src/paraglide` (the output `pnpm build`, `pnpm dev` and
// `tsc` use) with virtual-module imports while workers were reading it, so 20 files failed with "Cannot find package
// virtual:paraglide/...". A directory of their own keeps the two apart.
const paraglideTestDir = resolve(import.meta.dirname, ".vitest/paraglide");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/paraglide(\/|$)/, replacement: `${paraglideTestDir}$1` },
      { find: "@", replacement: resolve(import.meta.dirname, "src") },
    ],
  },
  plugins: [
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: paraglideTestDir,
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
      // Floors just below the measured totals (statements 82.87, branches 79.66, functions 82.48, lines 84.41), so
      // coverage cannot regress unnoticed. Raise them as tests are added; never lower them to land a change.
      thresholds: { statements: 82, branches: 79, functions: 82, lines: 84 },
    },
  },
});
