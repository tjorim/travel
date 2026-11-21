import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["react"],
  ignorePatterns: [
    "dist/**",
    "build/**",
    "coverage/**",
    "node_modules/**",
    "src/paraglide/**",
    "src/api-schema/**",
  ],
  jsPlugins: ["@shadcn/lint"],
  rules: {
    "no-console": ["error", { allow: ["error", "warn"] }],
    "shadcn/no-arbitrary-values": "error",
    "shadcn/no-raw-colors": "error",
    "shadcn/no-inline-styles": ["error", { allow: ["objectPosition", "left", "top"] }],
    "shadcn/no-unknown-classes": "error",
  },
});
