import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: ["src/paraglide/**", "src/api-schema/**"],
  jsPlugins: ["@shadcn/lint"],
  rules: {
    "shadcn/no-arbitrary-values": "error",
    "shadcn/no-raw-colors": "error",
    "shadcn/no-inline-styles": ["error", { allow: ["objectPosition", "left", "top"] }],
    "shadcn/no-unknown-classes": "error",
  },
});
