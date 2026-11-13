/**
 * T-49: `RevocationWatcher.poll()` MENGEMBALIKAN koneksinya.
 *
 * KENAPA uji ini ada, dan kenapa tidak cukup dengan uji fungsional biasa:
 * `poll()` berjalan tiap detik. Dengan `pg.Pool`, koneksi yang tidak dilepas
 * akan menghabiskan pool dalam hitungan detik — dan kegagalannya muncul di
 * endpoint yang sama sekali tidak berhubungan (login mengembalikan 503).
 *
 * Uji ini meniru pool yang MENGHITUNG koneksi hidup. Tanpa `finally` di
 * `poll()`, hitungannya naik terus dan uji gagal — persis seperti kejadian
 * nyatanya saat `npm run dev` dijalankan dengan `DATABASE_URL`.
 */
import { describe, expect, it } from "vitest";
import { RevocationWatcher } from "./revocation.js";

/** Pool tiruan yang menolak bila terlalu banyak koneksi ditahan. */
function countingPool(max: number) {
  let held = 0;
  let leaks = 0;
  return {
    deps: {
      db: async () => {
        if (held >= max) { leaks++; throw new Error("timeout exceeded when trying to connect"); }
        held++;
        return {
          async query<R>() {
            return { rows: [{ team_id: "t1", user_id: "u1" }] as unknown as R[], rowCount: 1 };
          },
          release() { held--; },
        };
      },
    },
    stats: () => ({ held, leaks }),
  };
}

describe("T-49 RevocationWatcher.poll tidak membocorkan koneksi", () => {
  it("20 jajak berturut-turut tidak menghabiskan pool(max=2)", async () => {
    const pool = countingPool(2);
    const w = new RevocationWatcher(pool.deps as never);
    for (let i = 0; i < 20; i++) await w.poll();
    // Ini yang gagal sebelum perbaikan: `held` menjadi 20 dan pool habis.
    expect(pool.stats()).toEqual({ held: 0, leaks: 0 });
    w.stop();
  });

  it("jajak bersamaan yang SEUKURAN pool tidak menyisakan koneksi tertahan", async () => {
    // Sengaja 3 jajak pada pool(max=3) — bukan 6. Versi pertama uji ini memakai
    // 6 dan gagal; itu BUKAN bug produk melainkan batas pool yang wajar
    // (permintaan ke-4 memang harus menunggu). Yang diuji di sini adalah
    // kebocoran, bukan paralelisme.
    const pool = countingPool(3);
    const w = new RevocationWatcher(pool.deps as never);
    await Promise.all(Array.from({ length: 3 }, () => w.poll()));
    expect(pool.stats()).toEqual({ held: 0, leaks: 0 });
    w.stop();
  });

  it("koneksi tetap dilepas walaupun query gagal", async () => {
    let held = 0;
    const deps = {
      db: async () => {
        held++;
        return {
          async query() { throw new Error("galat query"); },
          release() { held--; },
        };
      },
    };
    const w = new RevocationWatcher(deps as never);
    await expect(w.poll()).rejects.toThrow("galat query");
    // Tanpa `finally`, satu koneksi bocor per galat — dan galat DB justru
    // terjadi saat sistem sedang bermasalah, ketika pool paling dibutuhkan.
    expect(held).toBe(0);
    w.stop();
  });
});
