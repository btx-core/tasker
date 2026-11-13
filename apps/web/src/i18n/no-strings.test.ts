/**
 * P4-07 / T-I18N1: TIDAK ADA string UI di komponen.
 *
 * Berkas ini sudah dua kali salah dan keduanya lolos tanpa terlihat:
 *
 *  T-45 — berkas komponen didaftar manual, jadi komponen BARU otomatis
 *         tidak diperiksa. Kini dipindai (`scan.ts`).
 *  T-47 — pola pendeteksinya rusak: pembungkus penutup di dalam kelas karakter
 *         membuatnya hanya bisa mencocokkan SATU kata, sehingga `"Halo dunia"`
 *         tertangkap tetapi `"Judul Panjang Liar"` dan seluruh teks Title Case
 *         lolos. Selain itu, teks di dalam HTML (`<h2>Judul</h2>`) tidak pernah
 *         diperiksa sama sekali — padahal komponen di repo ini justru membangun
 *         HTML.
 *
 * Karena dua kegagalan itu, berkas ini sekarang memuat **uji mandiri**: pola
 * deteksi diuji dengan kasus positif DAN negatif. Penjaga yang tidak diuji
 * adalah dokumentasi, bukan penjaga.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIN_EXPECTED_FILES, componentFiles } from "./scan.js";

/** T-45: ditemukan dengan memindai, bukan didaftar manual. */
const files = componentFiles();

/**
 * Detektor 1 — literal kalimat polos: `"Judul Panjang Liar"`.
 *
 * `[A-Z][a-z]+` (huruf besar + sisa kata) lalu minimal satu kata lagi, lalu
 * pembungkus PENUTUP di luar kelas karakter. Itu perbaikan T-47.
 */
export const PLAIN_SENTENCE = /["'`]([A-Z][a-z]+(?: [A-Za-z][a-z]*)+)["'`]/g;

/**
 * Detektor 2 — teks di dalam HTML: `<h2>Judul Panjang Liar</h2>`.
 *
 * Komponen di repo ini membangun string HTML, jadi ini bentuk pelanggaran yang
 * PALING MUNGKIN terjadi — dan detektor 1 tidak bisa melihatnya karena tag
 * menghalangi pembungkus penutup.
 */
export const HTML_TEXT = />\s*([A-Z][A-Za-z]*(?: [A-Za-z]+){1,})\s*</g;

/**
 * Kunci teknis yang kebetulan berbentuk "dua kata". Ini bukan teks UI dan
 * membuat penjaga merah tanpa alasan — merah palsu juga merusak, karena
 * melatih orang mengabaikan merah.
 */
const TECHNICAL = new Set([
  "application json", "content type", "idempotency key", "set cookie",
  "retry after", "x trace", "no cache", "strict transport",
]);

function hitsIn(src: string): string[] {
  const found: string[] = [];
  for (const re of [PLAIN_SENTENCE, HTML_TEXT]) {
    for (const m of src.matchAll(re)) {
      const text = m[1]!.trim();
      if (TECHNICAL.has(text.toLowerCase())) continue;
      // Satu kata atau nama kelas tidak mungkin kalimat.
      if (!/ [A-Za-z]/.test(text)) continue;
      found.push(text);
    }
  }
  return found;
}

describe("T-I18N1: penjaga membuktikan dirinya bekerja", () => {
  it("menangkap kalimat Title Case yang dulu lolos", () => {
    expect(hitsIn(`const a = "Judul Panjang Liar";`)).toContain("Judul Panjang Liar");
    expect(hitsIn(`const a = "Simpan Perubahan Sekarang";`)).toContain("Simpan Perubahan Sekarang");
  });

  it("menangkap kalimat huruf kecil biasa", () => {
    expect(hitsIn(`const a = "Belum ada task di sini";`)).toContain("Belum ada task di sini");
  });

  it("menangkap teks di dalam HTML (bentuk yang paling mungkin terjadi)", () => {
    expect(hitsIn(`return \`<h2>Judul Panjang Liar</h2>\`;`)).toContain("Judul Panjang Liar");
    expect(hitsIn(`return "<p>Gagal memuat papan</p>";`)).toContain("Gagal memuat papan");
  });

  it("TIDAK menangkap kunci teknis, kelas CSS, atau selector", () => {
    const clean = [
      `"content-type"`, `"application/json"`, `{ id: "t1" }`,
      `class="card-title"`, `S.boardTitle`, `"data-task-id"`,
      `.card .title { line-height: 1.35; }`,
    ].join("\n");
    expect(hitsIn(clean)).toEqual([]);
  });
});

describe("T-I18N1: komponen", () => {
  it("penemuan berkas benar-benar menemukan komponen (bukan hijau palsu)", () => {
    expect(files.length).toBeGreaterThanOrEqual(MIN_EXPECTED_FILES);
    expect(files.some((f) => f.endsWith("board.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("task-panel.ts"))).toBe(true);
  });

  it("berkas uji TIDAK ikut diperiksa (uji boleh memuat kalimat fixture)", () => {
    expect(files.filter((f) => f.endsWith(".test.ts"))).toEqual([]);
  });

  for (const f of files) {
    it(`${f} tidak memuat kalimat siap-tampil`, () => {
      const src = readFileSync(f, "utf8");
      expect(hitsIn(src)).toEqual([]);
    });
  }
});

describe("T-I18N1: teks berasal dari modul strings", () => {
  it("board dan panel mengimpor S", () => {
    for (const f of files.filter((x) => !x.endsWith("main.ts"))) {
      expect(readFileSync(f, "utf8")).toContain('from "../i18n/strings.js"');
    }
  });
});
