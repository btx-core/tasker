/**
 * Jalur tulis task. TEMPLATE TUNGGAL (ADR-015):
 *
 *   authz -> validasi -> idempotensi -> versi -> patch -> task_events
 *         -> changes -> NOTIFY -> commit
 *
 * "Tidak boleh ada handler yang menyimpang" (ADR-015 konsekuensi). Karena itu
 * seluruh urutan ada di SATU fungsi, dan handler HTTP hanya memanggil ini.
 */
import {
  ApiError,
  can,
  FIELD_ACTION,
  TEAM_ROLE,
  uuidv7,
  type Action,
  type Actor,
  type TaskPatch,
} from "@kelindan/shared";
import type { ChangeRecord, TaskRow } from "./types.js";
import type { SqlClient } from "../client.js";

export interface ApplyPatchParams {
  actor: Actor;
  taskId: string;
  patch: TaskPatch;
  expectedVersion?: number;
  /** Wajib: dipakai untuk idempotensi (ADR-015 butir 1). */
  operationId: string;
  endpoint: string;
  traceId: string;
}

export interface ApplyPatchResult {
  task: TaskRow;
  changedFields: string[];
  /** null bila tidak ada perubahan bersih (versi tidak naik, tidak ada delta). */
  change: ChangeRecord | null;
  replayed: boolean;
}

/** Kolom yang boleh masuk payload delta. `description` TIDAK PERNAH (ADR-017). */
const DELTA_SAFE = ["title", "status_id", "assignee_id", "priority", "effort", "due_date"] as const;

const ENTITY_TASK = 1;
const OP_UPSERT = 1;
const EVENT_KIND = {
  title: 4, status_id: 1, assignee_id: 2, priority: 3, due_date: 5, effort: 6,
} as const;

export async function applyTaskPatch(
  client: SqlClient,
  p: ApplyPatchParams,
): Promise<ApplyPatchResult> {
  const fields = Object.keys(p.patch) as (keyof TaskPatch)[];

  // ---- 1. authz (sebelum menyentuh data apa pun) ----
  // Diperiksa per-field: mengubah status butuh izin berbeda dari mengubah judul.
  for (const f of fields) {
    const action = FIELD_ACTION[f] as Action | undefined;
    if (!action) throw ApiError.validation(`field '${f}' tidak dapat diubah`, f);
    if (!can(p.actor, action)) {
      throw new ApiError(403, "auth.forbidden", `Tidak berwenang mengubah '${f}'`);
    }
  }

  await client.query("BEGIN");
  try {
    // ---- 2. idempotensi: cek SEBELUM bekerja ----
    const hash = await requestHash(p.patch, p.expectedVersion);
    const prev = await client.query<{ request_hash: string; response_status: number; response_body: unknown }>(
      `SELECT request_hash, response_status, response_body
         FROM idempotency_keys WHERE actor_id = $1 AND operation_id = $2`,
      [p.actor.userId, p.operationId],
    );
    if (prev.rowCount && prev.rowCount > 0) {
      const row = prev.rows[0]!;
      if (row.request_hash !== hash) {
        // operation_id sama, body beda -> 409, JANGAN diproses (ENT-19).
        throw ApiError.idempotencyMismatch();
      }
      await client.query("COMMIT");
      const body = row.response_body as ApplyPatchResult;
      return { ...body, replayed: true };
    }

    // ---- 3. baca entitas DALAM SCOPE tenant (INV-12) ----
    // 404, bukan 403: jangan bocorkan keberadaan task milik tenant lain.
    const cur = await client.query<TaskRow>(
      `SELECT id, workspace_id, team_id, number, title, description, status_id,
              assignee_id, priority, effort, due_date, version, deleted_at
         FROM tasks
        WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [p.taskId, p.actor.workspaceId],
    );
    if (cur.rowCount === 0) throw ApiError.notFound("Task");
    const before = cur.rows[0]!;

    // ---- 4. versi: expected_version opsional, tapi bila dikirim harus cocok ----
    if (p.expectedVersion !== undefined && p.expectedVersion !== before.version) {
      const canonical = await readCanonical(client, before.id, p.actor.workspaceId);
      throw ApiError.versionConflict(canonical);
    }

    /**
     * ---- 4b. validasi status (api-contract.md §7.4) ----
     *
     * Hanya bila `status_id` benar-benar BERUBAH. Mengirim status yang sama
     * dengan yang sekarang bukan transisi, dan menolaknya akan membuat klien
     * yang mengirim seluruh objek (termasuk status lama) gagal tanpa alasan.
     *
     * KENAPA VALIDASI INI PERLU, padahal trigger DB sudah menjaga INV-08:
     * trigger mencegah DATA RUSAK, tetapi pelanggarannya sampai ke klien sebagai
     * **500 internal.error**. Klien tidak tahu apa yang salah, dan operator
     * disuruh mencari log untuk kesalahan klien. Dua hal berbeda: kebenaran data
     * (trigger) dan bentuk kegagalan yang bisa ditindaklanjuti (di sini).
     */
    const statusChanged = p.patch.status_id !== undefined && p.patch.status_id !== before.status_id;
    let targetCategory: number | null = null;
    if (statusChanged) {
      const st = await client.query<{ category: number; team_id: string; archived_at: Date | null }>(
        "SELECT category, team_id, archived_at FROM statuses WHERE id = $1",
        [p.patch.status_id],
      );
      const status = st.rows[0];
      if (!status) throw ApiError.validation("status_id tidak ditemukan", "status_id");

      // INV-08: status harus milik tim task. Tim LAIN = kesalahan klien, 400.
      if (status.team_id !== before.team_id) {
        throw ApiError.validation("status_id bukan milik tim task ini", "status_id");
      }
      /**
       * Status terarsip tidak boleh menjadi tujuan. Tanpa ini task bisa masuk
       * kolom yang sudah disembunyikan dari board — task yang "hilang" dari UI
       * tetapi masih dihitung di laporan.
       */
      if (status.archived_at !== null) {
        throw ApiError.validation("status_id sudah diarsipkan", "status_id");
      }
      targetCategory = status.category;
    }

    // ---- 5. hitung perubahan bersih ----
    const changed: (keyof TaskPatch)[] = [];
    for (const f of fields) {
      if (normalize(before[f as keyof TaskRow]) !== normalize(p.patch[f])) changed.push(f);
    }

    if (changed.length === 0) {
      // Mutasi tanpa perubahan bersih: versi TIDAK naik (INV-04), tidak ada
      // event, tidak ada delta. Tetap dicatat idempoten agar retry konsisten.
      const result: ApplyPatchResult = { task: before, changedFields: [], change: null, replayed: false };
      await recordIdempotency(client, p, hash, 200, result);
      await client.query("COMMIT");
      return result;
    }

    // ---- 6. patch + naikkan versi TEPAT 1 ----
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const f of changed) {
      vals.push(p.patch[f] ?? null);
      sets.push(`${f} = $${vals.length}`);
    }

    /**
     * Timestamp first-touch (INV-07). `COALESCE(kolom, now())` adalah
     * keseluruhan aturannya dalam satu ekspresi: isi bila masih NULL, jangan
     * sentuh bila sudah terisi. Menulis `= now()` akan menimpa waktu selesai
     * pertama setiap kali task dibuka kembali — dan metrik "berapa lama task
     * selesai" menjadi tidak bermakna tanpa ada yang terlihat rusak.
     *
     * Kategori: 3=Dikerjakan, 4=Selesai, 5=Dibatalkan (0008_statuses.sql).
     */
    if (targetCategory === 3) sets.push("started_at = COALESCE(started_at, now())");
    if (targetCategory === 4) sets.push("completed_at = COALESCE(completed_at, now())");
    if (targetCategory === 5) sets.push("canceled_at = COALESCE(canceled_at, now())");

    vals.push(before.version, before.id, p.actor.workspaceId);
    const updated = await client.query<TaskRow>(
      `UPDATE tasks SET ${sets.join(", ")}, version = version + 1, updated_at = now()
        WHERE id = $${vals.length - 1} AND workspace_id = $${vals.length} AND version = $${vals.length - 2}
        RETURNING *`,
      vals,
    );
    // Bila baris hilang di sini, ada penulis lain di antara FOR UPDATE dan UPDATE.
    // Itu tidak boleh terjadi (FOR UPDATE mengunci), jadi ini kegagalan internal.
    if (updated.rowCount === 0) {
      throw new ApiError(500, "internal.error", "task berubah di tengah transaksi", {});
    }
    const after = updated.rows[0]!;

    // ---- 7. task_events per field yang berubah (jejak, bukan hanya hasil) ----
    const seq = await nextSeq(client, p.actor.workspaceId);
    for (const f of changed) {
      if (f === "description") continue; // deskripsi tidak punya kind di ENT-15
      const kind = EVENT_KIND[f as keyof typeof EVENT_KIND];
      if (kind === undefined) continue;
      await client.query(
        `INSERT INTO task_events
           (id, workspace_id, team_id, task_id, seq, actor_id, source, kind,
            from_value, to_value, category_from, category_to)
         VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11)`,
        [
          uuidv7(), after.workspace_id, after.team_id, after.id, seq, p.actor.userId, kind,
          JSON.stringify(before[f as keyof TaskRow] ?? null),
          JSON.stringify((p.patch[f] ?? null) as unknown),
          kind === 1 ? await categoryOf(client, before.status_id) : null,
          kind === 1 ? await categoryOf(client, after.status_id) : null,
        ],
      );
    }

    // ---- 8. changes: patch MINIMAL, tanpa description (ADR-017) ----
    const payload: Record<string, unknown> = { version: after.version };
    for (const f of changed) {
      if ((DELTA_SAFE as readonly string[]).includes(f)) {
        payload[f] = (p.patch[f] ?? null) as unknown;
      }
    }
    // Perubahan deskripsi dikirim sebagai SINYAL, bukan isi.
    if (changed.includes("description")) {
      payload.description_changed = true;
    }

    await client.query(
      `INSERT INTO changes (workspace_id, seq, entity_type, entity_id, team_id, op, version, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.actor.workspaceId, seq, ENTITY_TASK, after.id, after.team_id, OP_UPSERT, after.version, JSON.stringify(payload)],
    );

    // ---- 9. NOTIFY: hanya pointer <= 64 byte (ADR-017) ----
    // "NOTIFY adalah bel, bukan kurir." Bila ini melebihi ~8 KB, seluruh
    // transaksi gagal - karena itu ia tidak boleh memuat entitas.
    await client.query(`SELECT pg_notify('kelindan_changes', $1)`, [
      `${p.actor.workspaceId}:${seq}`,
    ]);

    const result: ApplyPatchResult = {
      task: after,
      changedFields: changed as string[],
      change: {
        workspaceId: p.actor.workspaceId,
        seq,
        entityType: ENTITY_TASK,
        entityId: after.id,
        teamId: after.team_id,
        op: OP_UPSERT,
        version: after.version,
        payload,
      },
      replayed: false,
    };
    await recordIdempotency(client, p, hash, 200, result);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

/**
 * seq per workspace, dinaikkan dalam transaksi yang sama (ENT-17).
 * `UPDATE ... RETURNING` mengunci satu baris per workspace: mutasi pada
 * workspace yang sama memang harus berurutan, jadi ini bukan kontensi yang
 * bisa dihindari tanpa kehilangan urutan.
 */
async function nextSeq(client: SqlClient, workspaceId: string): Promise<number> {
  const r = await client.query<{ seq: number }>(
    `UPDATE workspaces SET seq_next = seq_next + 1
      WHERE id = $1 RETURNING seq_next - 1 AS seq`,
    [workspaceId],
  );
  if (r.rowCount === 0) throw ApiError.notFound("Workspace");
  return Number(r.rows[0]!.seq);
}

async function categoryOf(client: SqlClient, statusId: string): Promise<number | null> {
  const r = await client.query<{ category: number }>(
    `SELECT category FROM statuses WHERE id = $1`,
    [statusId],
  );
  return r.rowCount ? r.rows[0]!.category : null;
}

async function readCanonical(client: SqlClient, id: string, workspaceId: string): Promise<TaskRow | null> {
  const r = await client.query<TaskRow>(
    `SELECT id, workspace_id, team_id, number, title, description, status_id,
            assignee_id, priority, effort, due_date, version, deleted_at
       FROM tasks WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId],
  );
  return r.rowCount ? r.rows[0]! : null;
}

async function recordIdempotency(
  client: SqlClient,
  p: ApplyPatchParams,
  hash: string,
  status: number,
  body: ApplyPatchResult,
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_keys
       (actor_id, operation_id, endpoint, request_hash, response_status, response_body)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [p.actor.userId, p.operationId, p.endpoint, hash, status, JSON.stringify(body)],
  );
}

async function requestHash(patch: TaskPatch, expectedVersion?: number): Promise<string> {
  const { createHash } = await import("node:crypto");
  const stable = JSON.stringify({ patch: sortKeys(patch), expectedVersion: expectedVersion ?? null });
  return createHash("sha256").update(stable).digest("hex");
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

/** Normalisasi untuk membandingkan nilai sebelum/sesudah. */
function normalize(v: unknown): string {
  if (v === null || v === undefined) return "\u0000null";
  if (v instanceof Date) return `d:${v.toISOString()}`;
  return `v:${String(v)}`;
}

export { TEAM_ROLE };
