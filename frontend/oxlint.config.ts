import { readFileSync } from "node:fs";

import { defineConfig } from "oxlint";

// Existing component classes still live in styles.css during the gradual migration.
// Allow only selectors that are actually defined there; new Tailwind classes must exist.
const legacyCss = readFileSync(new URL("./src/styles.css", import.meta.url), "utf8");
const legacyClasses = [...new Set([...legacyCss.matchAll(/\.([_a-zA-Z][\w-]*)/g)].map((match) => match[1]))];

export default defineConfig({
  jsPlugins: ["@shadcn/lint"],
  rules: {
    "shadcn/no-arbitrary-values": "error",
    "shadcn/no-raw-colors": "error",
    "shadcn/no-inline-styles": ["error", { allow: ["objectPosition", "left", "top"] }],
    "shadcn/no-unknown-classes": ["error", { allow: legacyClasses }],
  },
});
