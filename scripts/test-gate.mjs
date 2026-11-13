#!/usr/bin/env node
/**
 * Gerbang "jangan hijau palsu" — membaca ringkasan JSON vitest.
 *
 * KENAPA JSON, BUKAN LOG TEKS (T-30): log teks dari `| tee` TIDAK bisa
 * diandalkan di CI. Vitest menulis progres ke TTY, dan pada runner GitHub
 * yang tertangkap pipe bisa kosong — gerbang saya lalu melaporkan "tidak ada
 * baris ringkasan" padahal 28 uji lulus. Gerbang yang salah merah lebih buruk
 * daripada tidak punya gerbang: ia mengajarkan orang mengabaikan merah.
 *
 * Pemakaian:
 *   test-gate.mjs <file.json> --expect-skipped <n>
 *   test-gate.mjs <file.json> --no-skipped
 */
import { readFileSync } from "node:fs";

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("::error::butuh path berkas JSON hasil vitest");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`::error::tidak bisa membaca hasil uji: ${err.message}`);
  console.error("Berkas JSON tidak ada atau rusak — berarti uji tidak berjalan.");
  process.exit(1);
}

const passed = Number(report.numPassedTests ?? report.numTotalTests ?? 0);
const failed = Number(report.numFailedTests ?? 0);
const pending = Number(report.numPendingTests ?? 0);
const total = Number(report.numTotalTests ?? 0);

console.log(`lulus=${passed} gagal=${failed} dilewati=${pending} total=${total}`);

if (total === 0) {
  console.error("::error::tidak ada uji yang berjalan sama sekali.");
  process.exit(1);
}
if (failed > 0) {
  console.error(`::error::${failed} uji gagal.`);
  process.exit(1);
}

const expectIdx = rest.indexOf("--expect-skipped");
if (expectIdx >= 0) {
  const expected = Number(rest[expectIdx + 1]);
  if (pending !== expected) {
    console.error(
      `::error::jumlah uji yang dilewati ${pending}, diharapkan ${expected}. ` +
      "Periksa apakah uji jaringan ikut dilewati atau ada uji baru yang tidak terdaftar.");
    process.exit(1);
  }
  console.log(`OK     dilewati ${pending} sesuai harapan.`);
  process.exit(0);
}

if (rest.includes("--no-skipped")) {
  if (pending > 0) {
    console.error(`::error::${pending} uji DILEWATI padahal database seharusnya tersedia.`);
    process.exit(1);
  }
  console.log("OK     tidak ada uji yang dilewati.");
  process.exit(0);
}

console.error("::error::butuh --expect-skipped <n> atau --no-skipped");
process.exit(1);
