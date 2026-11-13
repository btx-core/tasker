#!/usr/bin/env node
/**
 * P4-08 / UX-B1: anggaran bundel.
 *
 * Angka ini SENGAJA kecil dan keras. Board harus terasa instan pada perangkat
 * kelas menengah dengan jaringan lambat; setiap KB adalah waktu tunggu yang
 * dialami pengguna berulang kali sepanjang hari.
 */
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const BUDGET_KB = 60; // gzip
const path = "apps/web/public/main.js";

let buf;
try {
  buf = readFileSync(path);
} catch {
  console.error(`GAGAL  ${path} belum ada. Jalankan \`npm run build:web\`.`);
  process.exit(1);
}

const gz = gzipSync(buf);
const kb = gz.length / 1024;
console.log(`bundel ${path}: ${(buf.length / 1024).toFixed(1)} KB mentah, ${kb.toFixed(1)} KB gzip`);
if (kb > BUDGET_KB) {
  console.error(`GAGAL  bundel ${kb.toFixed(1)} KB melebihi anggaran ${BUDGET_KB} KB (gzip).`);
  process.exit(1);
}
console.log(`OK     di bawah anggaran ${BUDGET_KB} KB (gzip).`);
