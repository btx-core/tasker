/**
 * T-49 dengan PostgreSQL SUNGGUHAN: pool melayani request bersamaan.
 *
 * KENAPA perlu uji jaringan, padahal ada tiruan: tiruan membuktikan logika,
 * tetapi tidak membuktikan bahwa `pg.Pool` benar-benar membuat lebih dari satu
 * koneksi dan bahwa `withClient` mengembalikannya. Yang ingin dibantah adalah
 * klaim "satu koneksi per proses membuat request saling memblokir" — dan itu
 * hanya bisa diukur pada server nyata.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasRealPg, SKIP_REASON, REAL_PG_URL } from "@kelindan/testing";
import { createDbPool, type DbPool } from "./db-pool.js";
import { withClient } from "./http/routes.js";

describe.skipIf(!hasRealPg())(`T-49 pool pada PostgreSQL nyata${hasRealPg() ? "" : ` (${SKIP_REASON})`}`, () => {
  let pool: DbPool;
  let single: DbPool;

  beforeAll(() => {
    pool = createDbPool({ connectionString: REAL_PG_URL, max: 5 });
    single = createDbPool({ connectionString: REAL_PG_URL, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
    await single.end();
  });

  it("8 query bersamaan pada pool(max=5) selesai, bukan antre satu-satu", async () => {
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withClient(pool.deps, async (c) => {
          // pg_sleep 0,2 dtk: kalau SATU koneksi dipakai bergiliran, 8 query
          // butuh ~1,6 dtk. Dengan pool, ~0,4 dtk (5 paralel, lalu 3).
          const r = await c.query<{ ok: number }>(
            `SELECT 1 AS ok FROM (SELECT pg_sleep(0.2)) s`, [],
          );
          return r.rows.length + i * 0;
        }),
      ),
    );
    const elapsed = Date.now() - started;
    expect(results).toHaveLength(8);
    // Ambang longgar supaya tidak gagal di mesin lambat, tetapi tetap jauh di
    // bawah waktu serial (~1,6 dtk).
    expect(elapsed).toBeLessThan(1200);
  }, 20_000);

  it("pool(max=1) menyelesaikan pekerjaan yang sama JAUH lebih lambat", async () => {
    // Uji pembanding: inilah perilaku `Deps` lama (satu Client untuk semua).
    const started = Date.now();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withClient(single.deps, (c) => c.query(`SELECT 1 FROM (SELECT pg_sleep(0.2)) s`)),
      ),
    );
    expect(Date.now() - started).toBeGreaterThan(1200);
  }, 20_000);

  it("koneksi kembali ke pool: 50 query berurutan tidak menghabiskan pool(max=1)", async () => {
    // Kalau `release` terlewat SATU kali saja, query ke-2 akan gagal.
    for (let i = 0; i < 50; i++) {
      await withClient(single.deps, (c) => c.query("SELECT 1"));
    }
    expect(single.stats().total).toBeLessThanOrEqual(1);
  }, 20_000);

  it("galat di tengah transaksi tetap mengembalikan koneksi", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        withClient(single.deps, async (c) => {
          await c.query("BEGIN");
          throw new Error("409 konflik");
        }),
      ).rejects.toThrow("409 konflik");
    }
    // Koneksi tidak boleh bocor walau transaksinya ditinggalkan.
    expect(single.stats().total).toBeLessThanOrEqual(1);
    await withClient(single.deps, (c) => c.query("ROLLBACK"));
  }, 20_000);
});
