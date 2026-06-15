import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "dist-test/**", "node_modules/**"],
  },
  {
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  },
);
