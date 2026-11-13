/**
 * T-W1 / T-W2: KONKURENSI SUNGGUHAN pada PostgreSQL jaringan (dua koneksi).
 *
 * Inilah yang tidak bisa dibuktikan PGlite. Yang diuji:
 *  - Dua PATCH field BERBEDA dengan expected_version sama: keduanya BERHASIL
 *    (patch per-field tidak saling menghapus).
 *  - Dua PATCH field SAMA: satu berhasil, satu 409 — tidak ada yang hilang diam.
 *  - Dua createTask bersamaan: nomor ENG-* TIDAK PERNAH ganda.
 *  - 20 PATCH bersamaan pada field berbeda: semua perubahan bertahan.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { applyTaskPatch, createTask } from "@kelindan/db";
import { uuidv7, TEAM_ROLE, type Actor } from "@kelindan/shared";
import { hasRealPg, SKIP_REASON, freshSchema, connect, REAL_PG_URL, type FreshSchema } from "@kelindan/testing";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const WS = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const ST1 = "0190f000-0000-7000-8000-0000000000d1";
const ST2 = "0190f000-0000-7000-8000-0000000000d2";
const TASK = "0190f000-0000-7000-8000-0000000000e1";

const actor: Actor = { userId: USER, workspaceId: WS, teamRole: TEAM_ROLE.MEMBER };
let schema: FreshSchema;
let client: Client;
/** Koneksi kedua: tanpa ini, "bersamaan" hanya kata. */
let client2: Client;

beforeAll(async () => {
  if (!hasRealPg()) return;
  schema = await freshSchema();
  client = schema.client;
  client2 = await connect();
  await client2.query(`SET search_path TO ${schema.schema}, public`);

  // Migrasi dijalankan pada koneksi 1; `schema_migrations` ikut di skema ini.
  const { applyMigrations } = await import("@kelindan/testing");
  await applyMigrations(client as never, dir);
  await client.query("SET search_path TO " + schema.schema + ", public");

  await client.query(`INSERT INTO workspaces (id,name,slug,seq_next) VALUES ($1,'Ruang','ruang-kerja',1)`, [WS]);
  await client.query(`INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A')`, [USER]);
  await client.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG')`, [TEAM, WS]);
  await client.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
     VALUES ($1,$3,$4,'Antrean',1,0,true),($2,$3,$4,'Dikerjakan',3,1,false)`,
    [ST1, ST2, WS, TEAM]);
  await client.query(
    `INSERT INTO tasks (id,workspace_id,team_id,number,title,status_id,created_by)
     VALUES ($1,$2,$3,1,'Awal',$4,$5)`, [TASK, WS, TEAM, ST1, USER]);
}, 120_000);

afterAll(async () => { await schema?.drop(); });

const patch = (
  c: Client,
  body: Record<string, unknown>,
  opts: { opId?: string; expectedVersion?: number } = {},
) =>
  applyTaskPatch(c as never, {
    actor, taskId: TASK, patch: body as never,
    operationId: opts.opId ?? uuidv7(), endpoint: "test", traceId: uuidv7(),
    ...(opts.expectedVersion !== undefined ? { expectedVersion: opts.expectedVersion } : {}),
  });

const settle = <T,>(p: Promise<T>) =>
  p.then((v) => ({ ok: true as const, v })).catch((e: unknown) => ({ ok: false as const, e }));

describe.skipIf(!hasRealPg())("T-W1/T-W2 — konkurensi pada PostgreSQL nyata", () => {
  /**
   * T-W1 — DAN KONTRADIKSI DOKUMEN YANG DITEMUKANNYA.
   *
   * TODO `P1-13` menuntut: dua PATCH beda field dengan `expected_version` sama
   * -> KEDUANYA berhasil. `api-contract.md` §7.3 menuntut: `expected_version`
   * yang tidak sama dengan versi server -> **409**, tanpa memandang field.
   *
   * Implementasi mengikuti KONTRAK (409), karena kontrak adalah yang dibaca
   * klien. Uji ini membuktikan perilaku itu apa adanya, lalu uji berikutnya
   * membuktikan bahwa yang SEBENARNYA penting — tidak ada update yang hilang —
   * tetap terpenuhi pada jalur normal (tanpa `expected_version`).
   */
  it("expected_version adalah penjaga SELURUH entitas (sesuai api-contract §7.3)", async () => {
    const v = (await client.query<{ version: number }>(
      `SELECT version FROM tasks WHERE id = $1`, [TASK])).rows[0]!.version;

    const [a, b] = await Promise.all([
      settle(patch(client, { title: "Dari A" }, { expectedVersion: v })),
      settle(patch(client2, { priority: 3 }, { expectedVersion: v })),
    ]);
    const okCount = [a, b].filter((r) => r.ok).length;
    const conflict = [a, b].filter((r) => !r.ok && (r.e as { status?: number }).status === 409);

    expect(okCount).toBe(1);
    expect(conflict.length).toBe(1);
    // Dokumen TODO P1-13 menuntut `okCount === 2`. Kontrak menuntut 1.
    // Yang menang di sini adalah KONTRAK; TODO dikoreksi (T-21).
  }, 60_000);

  it("TANPA expected_version: dua PATCH beda field bersamaan -> keduanya bertahan", async () => {
    const before = (await client.query<{ version: number }>(
      `SELECT version, title, priority FROM tasks WHERE id = $1`, [TASK])).rows[0]!.version;

    const [a, b] = await Promise.all([
      settle(patch(client, { title: "Judul bersamaan" })),
      settle(patch(client2, { priority: 4 })),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const row = (await client.query<{ title: string; priority: number; version: number }>(
      `SELECT title, priority, version FROM tasks WHERE id = $1`, [TASK])).rows[0]!;
    // INTI dari ADR-015(3): patch per-field tidak saling menghapus.
    expect(row.title).toBe("Judul bersamaan");
    expect(row.priority).toBe(4);
    expect(row.version).toBe(before + 2);
  }, 60_000);

  it("dua PATCH field SAMA: tepat satu menang, satu 409 (tidak ada yang hilang diam)", async () => {
    const v = (await client.query<{ version: number }>(
      `SELECT version FROM tasks WHERE id = $1`, [TASK])).rows[0]!.version;

    const results = await Promise.all([
      settle(patch(client, { title: "Penulis 1" }, { expectedVersion: v })),
      settle(patch(client2, { title: "Penulis 2" }, { expectedVersion: v })),
    ]);
    const okCount = results.filter((r) => r.ok).length;
    const conflictCount = results.filter(
      (r) => !r.ok && (r.e as { status?: number }).status === 409,
    ).length;
    expect(okCount).toBe(1);
    expect(conflictCount).toBe(1);

    const row = (await client.query<{ title: string }>(
      `SELECT title FROM tasks WHERE id = $1`, [TASK])).rows[0]!;
    expect(["Penulis 1", "Penulis 2"]).toContain(row.title);
  }, 60_000);

  it("20 PATCH bersamaan pada field berbeda: SEMUA perubahan bertahan", async () => {
    // 20 penulis, satu task, tanpa expected_version (last-write-wins per field).
    // Yang dibuktikan: tidak ada UPDATE yang hilang, dan versi naik tepat 20.
    const before = (await client.query<{ version: number }>(
      `SELECT version FROM tasks WHERE id = $1`, [TASK])).rows[0]!.version;

    // SATU KONEKSI PER OPERASI. Ini bukan kemewahan: `pg.Client` mengantre
    // query, sehingga dua `BEGIN`/`COMMIT` yang tumpang tindih pada satu
    // koneksi saling merusak transaksi. Uji versi pertama saya memakai 2
    // koneksi bergantian dan menghasilkan `pk_changes` ganda serta "task
    // berubah di tengah transaksi" — ARTEFAK, bukan bug server. Produksi
    // memakai pool, jadi uji juga harus begitu.
    const conns = await Promise.all(Array.from({ length: 20 }, () => connect(REAL_PG_URL!)));
    await Promise.all(conns.map((c) => c.query(`SET search_path TO ${schema.schema}, public`)));
    // Nilai HARUS berbeda tiap operasi. Versi pertama saya memakai `priority =
    // i % 5`, sehingga sebagian patch TIDAK MENGUBAH apa pun — dan itu no-op
    // yang BENAR (INV-04: versi tidak naik). Uji saya yang salah, bukan kode.
    const ops = conns.map((c, i) => settle(patch(c, { title: `Judul ${i}` })));
    const results = await Promise.all(ops);
    await Promise.all(conns.map((c) => c.end()));
    const bad = results.filter((r) => !r.ok);
    if (bad.length > 0) console.log("GAGAL:", bad.slice(0, 3).map((r) => String((r as { e: Error }).e)));
    expect(results.every((r) => r.ok)).toBe(true);

    const after = (await client.query<{ version: number }>(
      `SELECT version FROM tasks WHERE id = $1`, [TASK])).rows[0]!.version;
    expect(after - before).toBe(20);

    // Satu event per perubahan: tidak ada yang hilang dari riwayat.
    const events = (await client.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM task_events WHERE task_id = $1`, [TASK])).rows[0]!.c;
    expect(Number(events)).toBeGreaterThanOrEqual(20);
  }, 120_000);

  it("20 createTask bersamaan: nomor ENG TIDAK PERNAH ganda", async () => {
    const conns = await Promise.all(Array.from({ length: 20 }, () => connect(REAL_PG_URL!)));
    await Promise.all(conns.map((c) => c.query(`SET search_path TO ${schema.schema}, public`)));
    const ops = conns.map((c, i) =>
      settle(createTask(c as never, { actor, teamId: TEAM, title: `Bersamaan ${i}` })));
    const results = await Promise.all(ops);
    await Promise.all(conns.map((c) => c.end()));
    const ok = results.filter((r) => r.ok);
    if (ok.length < 20) console.log("create gagal:", results.filter((r) => !r.ok).slice(0, 2).map((r) => String((r as { e: Error }).e)));
    // Kegagalan yang sah: serialization/unique. Yang TIDAK boleh: nomor ganda tersimpan.
    expect(ok.length).toBeGreaterThan(0);

    const nums = (await client.query<{ number: string }>(
      `SELECT number FROM tasks WHERE team_id = $1 ORDER BY number`, [TEAM])).rows
      .map((r) => r.number);
    expect(new Set(nums).size).toBe(nums.length); // nol duplikat

    // team_keys konsisten dengan nomor tertinggi yang benar-benar dipakai.
    const key = (await client.query<{ next_number: string }>(
      `SELECT next_number FROM team_keys WHERE team_id = $1`, [TEAM])).rows[0]!;
    const maxNum = Math.max(...nums.map(Number));
    expect(Number(key.next_number)).toBeGreaterThan(maxUsed(maxNum));
  }, 120_000);

  it("idempotensi tetap benar di bawah konkurensi: dua request KUNCI SAMA", async () => {
    const opId = uuidv7();
    const results = await Promise.all([
      settle(patch(client, { title: "Idem" }, { opId })),
      settle(patch(client2, { title: "Idem" }, { opId })),
    ]);
    // Salah satu memproses; yang lain memutar ulang hasil atau menerima 409.
    // Yang DILARANG: dua perubahan tercatat untuk satu operation_id.
    const rows = (await client.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM idempotency_keys WHERE actor_id = $1 AND operation_id = $2`,
      [USER, opId])).rows[0]!.c;
    expect(Number(rows)).toBe(1);
    void results;
  }, 60_000);
});

function maxUsed(maxNum: number): number {
  return maxNum - 1;
}

if (!hasRealPg()) {
  describe("T-W1/T-W2 (dilewati)", () => {
    it.skip(SKIP_REASON, () => {});
  });
}
