/**
 * P2-04 — board pada dataset acuan (50.000 task, prd.md §7.1).
 *
 * BATAS KEJUJURAN: PGlite adalah WASM di memori, bukan PostgreSQL di disk.
 * Angka absolutnya TIDAK sebanding dengan pengukuran Supabase di
 * `perf-validation.md` (p95 0,23 ms) dan TIDAK boleh dikutip sebagai bukti
 * SLO. Yang diuji di sini adalah dua hal yang tetap berlaku di mana pun:
 *
 *  1. **RENCANA QUERY** — `ix_tasks_board` benar-benar dipakai, dan tidak ada
 *     `Sort` terpisah pada 50 rb baris. Ini yang bisa memburuk diam-diam.
 *  2. **REGRESI ORDE BESARAN** — board tidak melambat secara eksplisit
 *     (mis. menjadi O(n) karena kehilangan index).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { loadBoard } from "@kelindan/db";
import { createTestClient, applyMigrations, type ClientLike } from "@kelindan/testing";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const WS = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const STATUS_IDS = ["d1", "d2", "d3", "d4", "d5", "d6", "d7"].map(
  (s) => `0190f000-0000-7000-8000-0000000000${s}`,
);
const N = 50_000;

let client: ClientLike;
const db = () => client as unknown as Client;

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);
  await client.query(`INSERT INTO workspaces (id,name,slug) VALUES ($1,'Ruang','ruang-kerja')`, [WS]);
  await client.query(`INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A')`, [USER]);
  await client.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG')`, [TEAM, WS]);

  const cats = [1, 2, 3, 3, 3, 4, 5];
  for (let i = 0; i < STATUS_IDS.length; i++) {
    await client.query(
      `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [STATUS_IDS[i], WS, TEAM, `S${i}`, cats[i], i, i === 0]);
  }

  // generate_series: 50 rb baris dalam satu statement, bukan 50 rb round-trip.
  await client.query(
    `INSERT INTO tasks (id, workspace_id, team_id, number, title, description,
                        status_id, created_by, priority, due_date, updated_at)
     SELECT gen_random_uuid(), $1, $2, g,
            'Task nomor ' || g,
            CASE WHEN g % 10 = 0 THEN repeat('deskripsi panjang ', 300) ELSE NULL END,
            (ARRAY[$3,$4,$5,$6,$7,$8,$9]::uuid[])[1 + (g % 7)],
            $10, g % 5,
            CASE WHEN g % 4 = 0 THEN NULL ELSE DATE '2026-12-01' + (g % 28) END,
            now() - (g || ' seconds')::interval
       FROM generate_series(1, $11) AS g`,
    [WS, TEAM, ...STATUS_IDS, USER, N],
  );
  await client.query("ANALYZE tasks");
  await client.query("ANALYZE statuses");

  // 2% soft-deleted, seperti produksi (prd.md §7.1).
  await client.query(
    `UPDATE tasks SET deleted_at = now() WHERE id IN (
       SELECT id FROM tasks WHERE team_id = $1 ORDER BY number LIMIT $2)`,
    [TEAM, Math.floor(N * 0.02)]);
  await client.query("ANALYZE tasks");
}, 300_000);

describe("board pada 50.000 task", () => {
  it("dataset benar-benar terisi", async () => {
    const r = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM tasks WHERE team_id = $1 AND deleted_at IS NULL`, [TEAM]);
    expect(Number(r.rows[0]!.c)).toBe(N - Math.floor(N * 0.02));
  }, 60_000);

  it("memakai ix_tasks_board, TANPA Sort terpisah", async () => {
    // Rencana diperiksa untuk query kolom tunggal — bentuk paling sederhana
    // dari pola board. Bila index hilang, `Sort` akan muncul di sini.
    const plan = await client.query<{ "QUERY PLAN": string }>(
      `EXPLAIN
       SELECT id FROM tasks
        WHERE workspace_id = $1 AND team_id = $2 AND status_id = $3 AND deleted_at IS NULL
        ORDER BY updated_at DESC, id DESC
        LIMIT 50`,
      [WS, TEAM, STATUS_IDS[2]],
    );
    const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(text).toContain("ix_tasks_board");
    expect(text).not.toMatch(/Sort\s+\(/);
  });

  it("board 7 kolom: 4 query, tepat ≤50 task/kolom, ditandai truncated", async () => {
    const board = await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
    expect(board.query_count).toBe(4);
    expect(board.columns.length).toBe(7);
    for (const col of board.columns) {
      expect(col.tasks.length).toBeLessThanOrEqual(50);
      // ±7.000 task/kolom -> semua kolom pasti terpotong.
      expect(col.truncated).toBe(true);
    }
  }, 60_000);

  it("p95 board jauh di bawah 200 ms DI PGLITE (bukan bukti SLO di Supabase)", async () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    // Ambang longgar SENGAJA: ini penjaga regresi, bukan SLO. NFR-004 dibuktikan
    // oleh perf-validation.md pada PostgreSQL nyata (0,23 ms).
    expect(p95).toBeLessThan(200);
    console.log(`[P2-04] board 50k di PGlite: p50=${times[9]!.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
  }, 120_000);

  it("payload board 7 kolom × 50 task tetap di bawah 300 KB", async () => {
    const board = await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
    const bytes = Buffer.byteLength(JSON.stringify(board), "utf8");
    // 350 task × ~600 B. Deskripsi 4 KB/task TIDAK ikut — itu inti bentuk ringkas.
    expect(bytes).toBeLessThan(300_000);
    console.log(`[P2-04] payload board: ${(bytes / 1024).toFixed(1)} KB`);
  }, 60_000);
});
