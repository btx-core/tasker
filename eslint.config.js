// Aturan batas modul (repo-layout.md §3) — DITEGAKKAN, bukan diharapkan.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/out/**", "examples/**", "**/*.test.ts", "**/__lint_probe__/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@kelindan/db", "@kelindan/db/*", "pg"],
            message: "apps/web TIDAK BOLEH menyentuh database: satu jalur otorisasi (ADR-003, repo-layout.md §3.1)." },
          { group: ["@kelindan/server", "@kelindan/server/*", "../../server/*"],
            message: "apps/web TIDAK BOLEH mengimpor server: akses data lewat HTTP/WS (repo-layout.md §3.1)." },
        ],
      }],
    },
  },
  {
    files: ["packages/db/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["@kelindan/server", "fastify"],
          message: "packages/db TIDAK BOLEH tahu HTTP (repo-layout.md §3.1)." }],
      }],
    },
  },
  {
    files: ["packages/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["@kelindan/db", "@kelindan/server", "pg", "fastify"],
          message: "packages/shared harus bebas dari dependensi aplikasi (repo-layout.md §3.1)." }],
      }],
    },
  },
);
