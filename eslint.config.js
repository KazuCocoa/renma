import js from "@eslint/js";
import { defineConfig } from "eslint/config";

export default defineConfig(
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
  {
    rules: {
      "no-unexpected-multiline": "off",
    },
  },
);
