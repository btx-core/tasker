/**
 * P4-06 / T-I18N3: tidak ada format tanggal/angka manual di komponen.
 * Merangkai `getDate()` + "/" adalah cara paling umum menghasilkan tanggal
 * yang salah di satu zona waktu.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIN_EXPECTED_FILES, componentFiles } from "./scan.js";

/** T-45: dipindai, bukan didaftar manual — lihat catatan di `scan.ts`. */
const components = componentFiles();
const FORBIDDEN = [
  /\.getDate\(\)/, /\.getMonth\(\)/, /\.getFullYear\(\)/,
  /toLocaleDateString\(/, /toLocaleString\(/,
  /\+\s*"\/"\s*\+/, // merangkai tanggal dengan "/"
  /\.toFixed\(/,
];

describe("T-I18N3: format lewat modul format", () => {
  it("penemuan berkas menemukan komponen (bukan hijau palsu)", () => {
    expect(components.length).toBeGreaterThanOrEqual(MIN_EXPECTED_FILES);
  });

  for (const f of components) {
    it(`${f} tidak memformat tanggal/angka sendiri`, () => {
      const src = readFileSync(f, "utf8");
      const hits = FORBIDDEN.filter((re) => re.test(src)).map((re) => String(re));
      expect(hits).toEqual([]);
    });
  }
});
