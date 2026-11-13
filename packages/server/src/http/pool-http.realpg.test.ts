/**
 * T-49 END-TO-END: HTTP -> `Pool` -> PostgreSQL sungguhan.
 *
 * KENAPA uji ini ada, padahal `pool.test.ts` dan `db-pool.realpg.test.ts` sudah
 * membuktikan bagian-bagiannya: keduanya tidak membuktikan bahwa RUTE benar-
 * benar memakai `withClient` dan koneksinya kembali. Kebocoran satu baris di
 * satu rute hanya akan terlihat di sini — dan itulah bentuk kegagalan yang
 * sebenarnya: bukan galat, melainkan pool yang perlahan habis.
 *
 * Uji terakhir (503 `server.busy`) membuktikan jalur yang sebelumnya TIDAK
 * PERNAH berjalan sama sekali: kehabisan koneksi dulu tampil sebagai 500
 * `internal.error`, membuat klien menyerah padahal mencoba lagi akan berhasil.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7, TEAM_ROLE } from "@kelindan/shared";
import { hasRealPg, SKIP_REASON, REAL_PG_URL, applyMigrations, freshSchema, type FreshSchema } from "@kelindan/testing";
import { createApp, type App } from "../app.js";
import { createDbPool, type DbPool } from "../db-pool.js";
import type { Client } from "pg";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const WS = "0190f000-0000-7000-8000-0000000000f1";
const TEAM = "0190f000-0000-7000-8000-0000000000f2";
const USER = "0190f000-0000-7000-8000-0000000000f3";
const ST1 = "0190f000-0000-7000-8000-0000000000f4";

let setup: Client;
/**
 * Skema SENDIRI, bukan `public`.
 *
 * Versi pertama uji ini memakai `public` dan gagal saat dijalankan bersama uji
 * jaringan lain ("relation workspaces already exists") — karena uji migrasi
 * lain sudah membuat tabel di sana. Kegagalan itu bukan bug produk, tetapi
 * membuat `npm run test:realpg` tidak bisa dipercaya: hijau saat sendirian,
 * merah saat bersama. Setiap uji jaringan mendapat skemanya sendiri.
 */
let schema: FreshSchema;
let pool: DbPool;
let app: App;
let base: string;
let poolUrl: string;

beforeAll(async () => {
  if (!hasRealPg()) return;
  schema = await freshSchema("kelindan_pool_http");
  setup = schema.client as unknown as Client;
  await setup.query("CREATE EXTENSION IF NOT EXISTS citext");
  await setup.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(setup as never, dir);

  await setup.query("INSERT INTO workspaces (id,name,slug) VALUES ($1,'Ruang','ruang-pool')", [WS]);
  await setup.query("INSERT INTO users (id,email,display_name) VALUES ($1,'p@x.id','P')", [USER]);
  await setup.query("INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG')", [TEAM, WS]);
  await setup.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
     VALUES ($1,$2,$3,'Antrean',1,0,true)`, [ST1, WS, TEAM]);
  for (let i = 1; i <= 12; i++) {
    await setup.query(
      `INSERT INTO tasks (id,workspace_id,team_id,number,title,status_id,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuidv7(), WS, TEAM, i, `Task pool ${i}`, ST1, USER]);
  }

  /**
   * Pool HARUS memakai search_path yang sama dengan skema uji; kalau tidak,
   * rute akan mencari tabel di `public` dan gagal 500.
   *
   * JANGAN memakai `new URL(...).searchParams.set("options", "-c search_path=a,b")`:
   * `searchParams` meng-encode spasi menjadi `+`, dan `pg` meneruskannya apa
   * adanya sehingga server membaca opsi `search_path%3Da%2Cpublic` lalu gagal
   * dengan `role "user" does not exist`. Parameternya disisipkan langsung.
   */
  poolUrl = REAL_PG_URL + (REAL_PG_URL!.includes("?") ? "&" : "?")
    + `options=${encodeURIComponent(`-c search_path=${schema.schema},public`)}`;
  pool = createDbPool({ connectionString: poolUrl, max: 5 });
  app = createApp({
    sessions: {
      async findByTokenHash() {
        return { sessionId: "s1", userId: USER, workspaceId: WS, epoch: 1,
          expiresAt: new Date(Date.now() + 3_600_000), revokedAt: null, epochNow: 1 };
      },
    },
    db: pool.deps.db,
    async teamRoleOf() { return TEAM_ROLE.ADMIN; },
    async teamIdOfTask() { return TEAM; },
  });
  const { port } = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (schema) await schema.drop();
});

const cookie = "kelindan_session=tok-pool";

describe.skipIf(!hasRealPg())(`T-49 HTTP lewat pool${hasRealPg() ? "" : ` (${SKIP_REASON})`}`, () => {
  it("12 GET board BERSAMAAN semuanya 200 dan datanya benar", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        fetch(`${base}/v1/teams/${TEAM}/board`, { headers: { cookie } }),
      ),
    );
    const bodies = await Promise.all(results.map((r) => r.json() as Promise<Record<string, unknown>>));
    expect(results.every((r) => r.status === 200)).toBe(true);
    // Semua respons harus memuat kolom; kalau satu request memakai koneksi yang
    // sudah dikembalikan koneksi lain, hasilnya akan kosong atau galat.
    for (const b of bodies) {
      expect(Object.keys(b)).toContain("columns");
    }
  }, 30_000);

  it("pool TIDAK habis setelah 40 request berurutan (kebocoran release)", async () => {
    for (let i = 0; i < 40; i++) {
      const r = await fetch(`${base}/v1/teams/${TEAM}/board`, { headers: { cookie } });
      expect(r.status).toBe(200);
      await r.arrayBuffer();
    }
    // max=5: kalau `release` bocor satu kali per request, request ke-6 sudah gagal.
    expect(pool.stats().total).toBeLessThanOrEqual(5);
  }, 60_000);

  it("jalur GALAT (404 task tidak ada) juga mengembalikan koneksi", async () => {
    const missing = "0190ffff-0000-7000-8000-000000000000";
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${base}/v1/tasks/${missing}`, { headers: { cookie } });
      expect(r.status).toBe(404);
      await r.arrayBuffer();
    }
    // 404 paling sering terjadi (klik task yang sudah dihapus) — jalur yang
    // paling mudah lupa `finally`, dan yang paling cepat menghabiskan pool.
    expect(pool.stats().total).toBeLessThanOrEqual(5);
  }, 30_000);

  it("pool penuh -> 503 server.busy, BUKAN 500 internal.error", async () => {
    // Pool terpisah dengan max=1; satu koneksi ditahan, lalu request datang.
    const tight = createDbPool({ connectionString: poolUrl, max: 1 });
    const blocker = await tight.deps.db() as unknown as { release: () => void };
    try {
      const tightApp = createApp({
        sessions: {
          async findByTokenHash() {
            return { sessionId: "s1", userId: USER, workspaceId: WS, epoch: 1,
              expiresAt: new Date(Date.now() + 3_600_000), revokedAt: null, epochNow: 1 };
          },
        },
        db: tight.deps.db,
        async teamRoleOf() { return TEAM_ROLE.ADMIN; },
        async teamIdOfTask() { return TEAM; },
      });
      const { port } = await tightApp.listen(0, "127.0.0.1");
      const r = await fetch(`http://127.0.0.1:${port}/v1/teams/${TEAM}/board`, { headers: { cookie } });
      const body = await r.json() as { code?: string };
      expect(r.status).toBe(503);
      expect(body.code).toBe("server.busy");
      await tightApp.close();
    } finally {
      blocker.release();
      await tight.end();
    }
  }, 30_000);
});
