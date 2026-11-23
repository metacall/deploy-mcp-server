import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "demo", "docs"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  // Formatting is Prettier's (npm run format); this only switches off the rules
  // that would argue with it.
  prettierConfig,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 }
    },
    rules: {
      // The remaining anys are deliberate: CommonJS interop in protocol/client.ts
      // and the generic tool registry, whose handlers return arbitrary JSON.
      "@typescript-eslint/no-explicit-any": "warn"
    }
  },
  {
    files: ["src/test/**/*.ts"],
    languageOptions: { globals: globals.mocha }
  }
);
