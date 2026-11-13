#!/usr/bin/env node
/**
 * Uji NEGATIF aturan batas modul (repo-layout.md §3.2, tugas P0-03).
 *
 * Aturan batas modul hanya berarti bila ia BENAR-BENAR GAGAL pada impor
 * terlarang. Skrip ini menjalankan ESLint pada berkas fixture yang sengaja
 * melanggar, dan GAGAL bila ESLint tidak menemukan pelanggaran.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const cases = [
  { file: "apps/web/__lint_probe__/imports-db.ts", expect: "apps/web TIDAK BOLEH" },
  { file: "packages/shared/__lint_probe__/imports-pg.ts", expect: "packages/shared harus bebas" },
];

let failures = 0;

for (const c of cases) {
  try {
    await run("npx", ["eslint", "--no-ignore", "--no-warn-ignored", c.file], { cwd: process.cwd() });
    console.error(`GAGAL  ${c.file}: lint LOLOS padahal seharusnya menolak. Aturan batas modul tidak bekerja.`);
    failures++;
  } catch (err) {
    const out = String(err.stdout ?? "") + String(err.stderr ?? "");
    if (out.includes(c.expect)) {
      console.log(`OK     ${c.file} -> ditolak ("${c.expect}")`);
    } else {
      console.error(`GAGAL  ${c.file}: lint gagal tetapi bukan karena alasan yang diharapkan.\n${out}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} kasus batas modul TIDAK ditegakkan.`);
  process.exit(1);
}
console.log("\nAturan batas modul ditegakkan pada semua kasus.");
