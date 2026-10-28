import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  { ignores: ["dist", "src/routeTree.gen.ts", "node_modules", ".codex-tmp/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["docs/verification/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", URL: "readonly", console: "readonly" } },
  },
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  jsxA11y.flatConfigs.recommended,
);
