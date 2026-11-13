#!/usr/bin/env node
/**
 * Bangun semua paket + bundel UI, dengan penjaga `tsbuildinfo`.
 *
 * BUG YANG DICEGAH (T-28): `tsc -b` memakai `tsconfig.tsbuildinfo` sebagai bukti
 * "project sudah dibangun". Bila `dist/` dihapus tetapi `*.tsbuildinfo` masih
 * ada — yang SELALU terjadi setelah `git clean`, `git clone` + restore cache,
 * atau `rm -rf dist` — `tsc -b` melaporkan "up to date" dan **tidak
 * menghasilkan satu berkas .js pun**. Semuanya tampak berhasil (exit 0), lalu
 * `esbuild` dan `vitest` gagal dengan "Failed to resolve entry @kelindan/*".
 *
 * Itu persis yang mematikan CI pada run pertama: hijau di mesin penulis (yang
 * punya dist/), merah di mana pun yang mulai dari nol.
 *
 * PERBAIKAN: bangun paket lewat `--force` supaya `tsc -b` tidak pernah
 * mempercayai `tsbuildinfo`.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const run = (cmd, args) => {
  process.stdout.write(`\n$ ${cmd} ${args.join(" ")}\n`);
  execFileSync(cmd, args, { stdio: "inherit" });
};

run("npx", ["tsc", "-b", "--force", "--pretty", "false"]);

// Verifikasi hasil, bukan percaya exit code. `tsc -b` keluar 0 tanpa
// menghasilkan apa pun pada kasus di atas.
const must = [
  "packages/shared/dist/index.js",
  "packages/db/dist/index.js",
  "packages/server/dist/index.js",
];
const missing = must.filter((p) => !existsSync(p));
if (missing.length > 0) {
  console.error(`\nGAGAL: build tidak menghasilkan: ${missing.join(", ")}`);
  process.exit(1);
}

run("npx", [
  "esbuild", "apps/web/src/main.ts", "--bundle", "--format=esm",
  "--outfile=apps/web/public/main.js", "--target=es2022", "--minify",
]);
console.log("\nOK     paket + bundel UI siap.");
