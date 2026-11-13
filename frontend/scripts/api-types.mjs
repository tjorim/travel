// The frontend's API types come from the backend's OpenAPI document.
//
//   node scripts/api-types.mjs generate   rewrite openapi.json from the backend (needs uv) and src/api-schema.ts
//   node scripts/api-types.mjs check      fail when src/api-schema.ts is not what openapi.json generates
//
// `check` needs no Python, so `pnpm typecheck` can run it anywhere. The backend tests fail when openapi.json
// no longer matches the application, so the two checks together catch a stale type in either place.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = join(root, "openapi.json");
const generated = join(root, "src", "api-schema.ts");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: root, ...options });
  if (result.status !== 0) {
    console.error(`${command} ${args.join(" ")} failed.`);
    process.exit(result.status ?? 1);
  }
}

// `--root-types` exports every schema by its own name next to `components`, so `StayResponse` is a type.
// A field with a default stays optional in a request body (a response model lists it as required itself).
const generate = (output) =>
  run("pnpm", [
    "exec",
    "openapi-typescript",
    snapshot,
    "--root-types",
    "--root-types-no-schema-prefix",
    "--default-non-nullable=false",
    "-o",
    output,
  ]);

const mode = process.argv[2];
if (mode === "generate") {
  run("uv", ["run", "--project", "../backend", "python", "-m", "app.openapi_export"]);
  generate(generated);
} else if (mode === "check") {
  const scratch = mkdtempSync(join(tmpdir(), "travel-api-types-"));
  try {
    const fresh = join(scratch, "api-schema.ts");
    generate(fresh);
    if (readFileSync(fresh, "utf8") !== readFileSync(generated, "utf8")) {
      console.error("src/api-schema.ts is stale: run `pnpm api:generate` and commit the result.");
      process.exit(1);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
} else {
  console.error("Usage: node scripts/api-types.mjs generate|check");
  process.exit(2);
}
