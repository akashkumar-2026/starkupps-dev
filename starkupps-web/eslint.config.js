import js from "@eslint/js";
import prettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "node_modules", "src/routeTree.gen.ts"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /* Unused code is already a type error (noUnusedLocals); avoid the duplicate. */
      "@typescript-eslint/no-unused-vars": "off",

      /* Prefer `type` imports where a value import would be elided anyway. */
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "off",

      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],

      /* Fast Refresh only matters for components; providers legitimately mix. */
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    /*
     * A context module legitimately exports its Provider and its `useX` hook.
     * Splitting them would only scatter a single concern across two files.
     */
    files: ["src/state/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    /*
     * shadcn/ui primitives export `cva` variant maps alongside their
     * component. That is how they are generated and what `shadcn add`
     * reproduces, so leave them alone.
     */
    files: ["src/components/ui/**/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    /* Tests may reach for console output and loose assertions. */
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
);
