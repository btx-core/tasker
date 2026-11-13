/**
 * P4-07 / T-I18N1: TIDAK ADA string UI di komponen.
 * Uji ini membaca berkas komponen dan mencari teks yang terlihat pengguna.
 * Ia sengaja bisa GAGAL — bukan sekadar dokumentasi aturan.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "apps/web/src/components/board.ts",
  "apps/web/src/components/login.ts",
  "apps/web/src/main.ts",
];

/** Literal string yang tampak seperti kalimat, bukan kunci teknis. */
const SUSPECT = /["'`]([A-Z][a-z]+ [a-z]+[^"'`]*)["'`]/g;

describe("T-I18N1: tidak ada string UI di komponen", () => {
  for (const f of files) {
    it(`${f} tidak memuat kalimat siap-tampil`, () => {
      const src = readFileSync(f, "utf8");
      const hits: string[] = [];
      for (const m of src.matchAll(SUSPECT)) {
        const text = m[1]!;
        // Abaikan komentar yang tidak mungkin tampil (pesan galat internal,
        // selector CSS, nama kelas).
        if (/^[\w-]+$/.test(text)) continue;
        hits.push(text);
      }
      expect(hits).toEqual([]);
    });
  }

  it("semua teks berasal dari modul strings", () => {
    const src = readFileSync("apps/web/src/components/board.ts", "utf8");
    expect(src).toContain('from "../i18n/strings.js"');
    // Tidak ada teks yang ditulis langsung di template.
    expect(src).not.toMatch(/<h2>[A-Za-z ]+<\/h2>/);
  });
});
