import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { convert, reportToLines } from "./adf-to-markdown.mjs";

const dir = "./fixtures";
const outDir = "./out";
mkdirSync(outDir, { recursive: true });

const rows = [];
let totalNodes = 0, totalLossL4 = 0, totalL5 = 0;

// Teks harus selamat: ambil semua kata dari ADF, pastikan muncul di Markdown.
function allText(node, acc = []) {
  if (!node || typeof node !== "object") return acc;
  if (node.type === "text" && node.text) acc.push(node.text);
  if (Array.isArray(node.content)) node.content.forEach((c) => allText(c, acc));
  return acc;
}

for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const adf = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const t0 = performance.now();
  const { markdown, report, rejected } = convert(adf, { kind: "description" });
  const ms = performance.now() - t0;
  writeFileSync(`${outDir}/${f.replace(/\.json$/, ".md")}`, markdown + "\n");

  const r = reportToLines(report);
  totalNodes += r.totalNodes;
  totalLossL4 += r.losses.filter((l) => l.level === "L4").length;
  if (rejected) totalL5++;

  // Pemeriksaan "tidak ada teks hilang".
  // Dibandingkan pada aliran alfanumerik, bukan per-kata: memecah per kata
  // lalu membuang tanda baca membuat "config.yaml" -> "configyaml" dan
  // "on-call" -> "oncall", yang TIDAK muncul di Markdown karena tanda
  // bacanya memang sengaja dipertahankan. Itu false positive pada pemeriksa,
  // bukan teks yang hilang di konverter.
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const markdownNorm = norm(markdown);
  const words = allText(adf).join(" ").split(/\s+/);
  const missing = [];
  for (const w of words) {
    const clean = norm(w);
    if (clean.length < 4) continue;
    if (!markdownNorm.includes(clean)) missing.push(w);
  }

  rows.push({
    fixture: f,
    nodes: r.totalNodes,
    level: r.maxLevel,
    L4: r.losses.filter((l) => l.level === "L4").length,
    L5: rejected ? 1 : 0,
    bytes: Buffer.byteLength(markdown),
    ms: Number(ms.toFixed(2)),
    teksHilang: missing.length === 0 ? "0" : missing.slice(0, 5).join(","),
  });
}

console.log("| Fixture | Node | Level | L4 | L5 | Byte | ms | Teks hilang |");
console.log("| :--- | --: | :-- | --: | --: | --: | --: | :-- |");
for (const r of rows)
  console.log(`| ${r.fixture} | ${r.nodes} | ${r.level} | ${r.L4} | ${r.L5} | ${r.bytes} | ${r.ms} | ${r.teksHilang} |`);
console.log(`\nTOTAL node=${totalNodes}  L4(macro/media)=${totalLossL4}  L5(terlalu besar)=${totalL5}`);

// ---- Uji batas ukuran (L5) ----
// Fixture yang sama dikonversi sebagai KOMENTAR (batas 16 KB), bukan deskripsi.
const big = JSON.parse(readFileSync(`${dir}/F6_oversize.json`, "utf8"));
const asDesc = convert(big, { kind: "description" });
const asComment = convert(big, { kind: "comment" });
const descBytes = Buffer.byteLength(asDesc.markdown);
const comBytes = Buffer.byteLength(asComment.markdown);
console.log(`\nUji batas L5 (hasil konversi F6 = ${descBytes} byte):`);
console.log(`  sebagai deskripsi (batas 102.400 B): ${asDesc.rejected ? "DITOLAK" : "diterima (benar)"}`);
console.log(`  sebagai komentar  (batas  16.384 B): ${asComment.rejected ? "DITOLAK - " + asComment.rejected.reason + " (benar)" : "diterima = BUG"}`);
const small = convert(JSON.parse(readFileSync(`${dir}/F1_basic.json`, "utf8")), { kind: "comment" });
console.log(`  F1 sebagai komentar : ${small.rejected ? "DITOLAK" : "diterima (benar)"}`);
