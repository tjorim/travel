import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { checkVisitorImports } from "./visitor-imports.mjs";

test("visitor entry and routes depend only on visitor and shared source", () => {
  checkVisitorImports(resolve(import.meta.dirname, ".."));
});

test("visitor boundary rejects a lazy import reached through a shared re-export", (t) => {
  const root = mkdtempSync(join(tmpdir(), "travel-visitor-imports-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sources = {
    "src/visitor-main.tsx": "",
    "src/features/visitor/route.tsx": 'import "@/components/renderer";',
    "src/components/renderer.ts": 'export { load } from "./loader";',
    "src/components/loader.ts": 'export const load = () => import("@/lib/api/owner-api");',
    "src/lib/api/owner-api.ts": "",
  };
  for (const [file, source] of Object.entries(sources)) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }

  assert.throws(() => checkVisitorImports(root), {
    message:
      "Visitor imports owner-only code: src/features/visitor/route.tsx -> " +
      "src/components/renderer.ts -> src/components/loader.ts -> src/lib/api/owner-api.ts",
  });
});
