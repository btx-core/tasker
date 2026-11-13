/**
 * P4-06 / T-I18N3: tidak ada format tanggal/angka manual di komponen.
 * Merangkai `getDate()` + "/" adalah cara paling umum menghasilkan tanggal
 * yang salah di satu zona waktu.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const components = [
  "apps/web/src/components/board.ts",
  "apps/web/src/components/login.ts",
  "apps/web/src/components/task-panel.ts",
  "apps/web/src/main.ts",
];
const FORBIDDEN = [
  /\.getDate\(\)/, /\.getMonth\(\)/, /\.getFullYear\(\)/,
  /toLocaleDateString\(/, /toLocaleString\(/,
  /\+\s*"\/"\s*\+/, // merangkai tanggal dengan "/"
  /\.toFixed\(/,
];

describe("T-I18N3: format lewat modul format", () => {
  for (const f of components) {
    it(`${f} tidak memformat tanggal/angka sendiri`, () => {
      const src = readFileSync(f, "utf8");
      const hits = FORBIDDEN.filter((re) => re.test(src)).map((re) => String(re));
      expect(hits).toEqual([]);
    });
  }
});
