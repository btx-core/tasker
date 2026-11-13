/**
 * UJI INTEGRASI runner migrasi pada PostgreSQL SUNGGUHAN (PGlite = Postgres 18
 * dikompilasi ke WASM, berjalan di dalam proses uji).
 *
 * Ini menjalankan `migrate()` yang ASLI — checksum, header, urutan, idempotensi.
 * Berbeda dari versi sebelumnya yang memakai `pg` dan DILEWATI karena sandbox
 * tidak dapat menjangkau port 5432 (T-04): uji ini SELALU berjalan.
 *
 * Batas: satu koneksi, tanpa LISTEN/NOTIFY antar-proses. Konkurensi multi-koneksi
 * tetap butuh Postgres jaringan.
 */
import { describe, expect, it } from "vitest";
import type { Client } from "pg";
import { migrate, MigrationError } from "@kelindan/db";
import { createTestClient } from "./pglite-adapter.js";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";

const dir = new URL("../../db/migrations/", import.meta.url).pathname;

async function freshDb() {
  const c = await createTestClient();
  await c.query("CREATE EXTENSION IF NOT EXISTS citext");
  await c.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  return c;
}

describe("migrate() pada PostgreSQL nyata", () => {
  it("menerapkan 20 migrasi, lalu jalan kedua = no-op", async () => {
    const c = await freshDb();
    const first = await migrate(c as unknown as Client, { dir, schema: "public", apply: true });
    expect(first.applied.length).toBe(20);
    expect(first.applied[0]).toBe(1);
    expect(first.applied.at(-1)).toBe(20);

    const tables = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'`,
    );
    // 20 tabel domain + schema_migrations yang dibuat runner
    expect(tables.rows[0]!.n).toBe(21);

    const second = await migrate(c as unknown as Client, { dir, schema: "public", apply: true });
    expect(second.applied.length).toBe(0);
  }, 120_000);

  it("dry-run tidak menerapkan apa pun", async () => {
    const c = await freshDb();
    const res = await migrate(c as unknown as Client, { dir, schema: "public", apply: false });
    expect(res.dryRun).toBe(true);
    expect(res.applied.length).toBe(0);
    expect(res.plan.every((p) => p.status === "pending")).toBe(true);

    const tables = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`,
    );
    expect(tables.rows[0]!.n).toBe(0);
  }, 120_000);

  it("M5: migrasi yang sudah diterapkan lalu diubah -> BERHENTI KERAS", async () => {
    const c = await freshDb();
    const tmp = "/tmp/kelindan-mig-drift";
    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true });

    // Migrasi kecil & sah, lalu dijalankan.
    const header = `-- migration: 0001_awal
-- intent: tabel uji
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: uji
`;
    await writeFile(`${tmp}/0001_awal.sql`, `${header}CREATE TABLE uji (id int);`);
    const r1 = await migrate(c as unknown as Client, { dir: tmp, schema: "public", apply: true });
    expect(r1.applied).toEqual([1]);

    // Berkas diubah SETELAH diterapkan -> runner harus menolak.
    await writeFile(`${tmp}/0001_awal.sql`, `${header}CREATE TABLE uji (id int, tambahan int);`);
    await expect(
      migrate(c as unknown as Client, { dir: tmp, schema: "public", apply: true }),
    ).rejects.toThrow(/checksum migrasi 1 .* BERBEDA/);

    await rm(tmp, { recursive: true, force: true });
  }, 120_000);

  it("celah nomor migrasi ditolak sebelum apa pun dijalankan", async () => {
    const c = await freshDb();
    const tmp = "/tmp/kelindan-mig-gap";
    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true });
    const h = (n: string) => `-- migration: ${n}
-- intent: uji celah
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: uji
`;
    await writeFile(`${tmp}/0001_satu.sql`, `${h("0001_satu")}CREATE TABLE a (id int);`);
    await writeFile(`${tmp}/0003_tiga.sql`, `${h("0003_tiga")}CREATE TABLE b (id int);`);
    await expect(
      migrate(c as unknown as Client, { dir: tmp, schema: "public", apply: false }),
    ).rejects.toBeInstanceOf(MigrationError);
    await rm(tmp, { recursive: true, force: true });
  }, 120_000);

  it("preflight: ekstensi belum terpasang -> pesan yang bisa ditindaklanjuti", async () => {
    // Tanpa CREATE EXTENSION: preflight harus menolak, bukan gagal di tengah migrasi.
    const c = await createTestClient();
    await expect(
      migrate(c as unknown as Client, { dir, schema: "public", apply: false }),
    ).rejects.toThrow(/ekstensi belum terpasang/);
  }, 120_000);
});
