/**
 * Pembuatan task. Nomor manusiawi (ENG-123) diambil dari `team_keys` dengan
 * pola BLOK (ENT-06): satu `UPDATE ... RETURNING` memesan rentang nomor,
 * lalu nomor dipakai dari memori. Ini menghindari `SELECT FOR UPDATE` pada
 * setiap pembuatan task — bottleneck nyata pada 150 konkuren.
 *
 * KONSEKUENSI YANG DITERIMA: nomor bisa bolong bila proses mati setelah
 * memesan blok. Pengguna lebih memaafkan ENG-118 yang hilang daripada
 * antrean pembuatan task.
 */
import type { Client } from "pg";
import { ApiError, can, ACTIONS, uuidv7, type Actor } from "@kelindan/shared";
import type { TaskRow } from "./types.js";

export interface CreateTaskParams {
  actor: Actor;
  teamId: string;
  title: string;
  description?: string | null;
  statusId?: string;
  priority?: number;
  blockSize?: number;
}

const DEFAULT_BLOCK = 20;

export async function createTask(client: Client, p: CreateTaskParams): Promise<TaskRow> {
  if (!can(p.actor, ACTIONS.TASK_CREATE)) {
    throw new ApiError(403, "auth.forbidden", "Tidak berwenang membuat task");
  }

  await client.query("BEGIN");
  try {
    // Pastikan tim ada DI workspace ini (INV-12). Tim tenant lain -> 404.
    const team = await client.query<{ id: string }>(
      "SELECT id FROM teams WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
      [p.teamId, p.actor.workspaceId],
    );
    if (team.rowCount === 0) throw ApiError.notFound("Tim");

    // Status default bila tidak ditentukan.
    const statusId =
      p.statusId ??
      (
        await client.query<{ id: string }>(
          `SELECT id FROM statuses
            WHERE team_id = $1 AND is_default AND archived_at IS NULL`,
          [p.teamId],
        )
      ).rows[0]?.id;
    if (!statusId) throw ApiError.validation("Tim belum punya status default", "status_id");

    const number = await allocateNumber(client, p.teamId, p.actor.workspaceId, p.blockSize ?? DEFAULT_BLOCK);

    const row = await client.query<TaskRow>(
      `INSERT INTO tasks (id, workspace_id, team_id, number, title, description,
                          status_id, priority, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [uuidv7(), p.actor.workspaceId, p.teamId, number, p.title,
       p.description ?? null, statusId, p.priority ?? 0, p.actor.userId],
    );

    await client.query("COMMIT");
    return row.rows[0]!;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

/**
 * Alokasi nomor dari blok.
 *
 * BUG YANG DITEMUKAN UJI: versi pertama menaikkan `next_number` pada SETIAP
 * panggilan, sehingga 45 task menghasilkan nomor sampai 441 — blok tidak
 * pernah dipakai, hanya terus dipesan. Uji menangkapnya karena memeriksa
 * nomor TERTINGGI, bukan hanya keunikan.
 *
 * Perilaku yang benar:
 *  - bila masih ada sisa dalam blok (`next_number <= allocated_until`), pakai
 *    nomor itu dan naikkan `next_number` saja;
 *  - bila blok habis, pesan blok baru: `allocated_until = next_number + block - 1`.
 *
 * Ini SATU statement `UPDATE ... RETURNING`, sehingga baris `team_keys` terkunci
 * sepanjang transaksi dan dua pembuatan task bersamaan tidak bisa mendapat
 * nomor yang sama.
 */
async function allocateNumber(
  client: Client,
  teamId: string,
  workspaceId: string,
  blockSize: number,
): Promise<number> {
  // Tim baru mungkin belum punya baris team_keys.
  //
  // MULAI DARI max(number)+1, BUKAN dari 1: task bisa sudah ada sebelum baris
  // `team_keys` dibuat (data impor, atau task yang dibuat sebelum mekanisme
  // blok ada). Versi pertama selalu mulai dari 1 dan langsung menabrak
  // UNIQUE (team_id, number) — ditemukan uji HTTP, dan ini persis kondisi
  // yang akan dihadapi importer.
  await client.query(
    `INSERT INTO team_keys (team_id, workspace_id, next_number, allocated_until)
     SELECT $1, $2, COALESCE(MAX(t.number), 0) + 1, 0
       FROM tasks t WHERE t.team_id = $1
     ON CONFLICT (team_id) DO NOTHING`,
    [teamId, workspaceId],
  );

  // MENYEMBUHKAN DIRI: bila task sudah ada dengan nomor >= next_number (data
  // impor, atau baris team_keys yang dibuat sebelum task), counter dinaikkan
  // melewati nomor tertinggi yang sudah terpakai. Tanpa ini, pembuatan task
  // gagal dengan `uq_tasks_team_number` — ditemukan uji HTTP, dan ini persis
  // kondisi yang dihadapi importer.
  const r = await client.query<{ n: string }>(
    `WITH mx AS (
       SELECT COALESCE(MAX(number), 0) + 1 AS m FROM tasks WHERE team_id = $1
     ), base AS (
       SELECT GREATEST(k.next_number, mx.m) AS b, k.allocated_until
         FROM team_keys k, mx WHERE k.team_id = $1
     )
     UPDATE team_keys k
        SET allocated_until = CASE
              WHEN b.b <= b.allocated_until THEN b.allocated_until
              ELSE b.b + $2 - 1
            END,
            next_number = b.b + 1
       FROM base b
      WHERE k.team_id = $1
      RETURNING (k.next_number - 1) AS n`,
    [teamId, blockSize],
  );
  const row = r.rows[0];
  if (!row) throw ApiError.notFound("Tim");
  return Number(row.n);
}
