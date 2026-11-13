/**
 * Checklist (ENT-11) — "pemecahan task tanpa status" (NG-05).
 *
 * `position` UNIK per task (`uq_checklist_items_position`). Itu keputusan skema
 * yang punya konsekuensi nyata di sini: menambah, menghapus, atau menggeser item
 * tidak boleh menghasilkan posisi ganda di tengah jalan — PostgreSQL memeriksa
 * indeks unik per BARIS, bukan per transaksi. Karena itu setiap operasi yang
 * menyentuh urutan masuk ke satu transaksi dan menormalkan ulang posisi di
 * akhirnya (0..n-1), bukan sekadar `position = position + 1`.
 *
 * Otorisasi lewat INDUK, sama seperti komentar (INV-13).
 */
import { randomBytes } from "node:crypto";
import { ApiError } from "@kelindan/shared";
import type { SqlClient } from "../client.js";

export interface ChecklistItem {
  id: string;
  task_id: string;
  content: string;
  is_done: boolean;
  assignee_id: string | null;
  due_date: string | null;
  position: number;
}

const COLUMNS = "id, task_id, content, is_done, assignee_id, due_date, position";

export interface ChecklistProgress {
  done: number;
  total: number;
}

export async function listChecklist(
  client: SqlClient,
  opts: { workspaceId: string; taskId: string },
): Promise<ChecklistItem[]> {
  const { rows } = await client.query<ChecklistItem>(
    `SELECT ${COLUMNS} FROM checklist_items ci
      WHERE ci.task_id = $1
        AND EXISTS (SELECT 1 FROM tasks t
                     WHERE t.id = ci.task_id AND t.workspace_id = $2 AND t.deleted_at IS NULL)
      ORDER BY ci.position`,
    [opts.taskId, opts.workspaceId],
  );
  return rows;
}

/**
 * Progres checklist untuk bentuk ringkas task (api-contract.md §8.4:
 * `checklist_progress`). Dihitung di SQL, bukan di klien: board memuat 350 task
 * dan mengirim seluruh item hanya untuk menghitung dua angka akan melipatgandakan
 * payload.
 */
export async function checklistProgress(
  client: SqlClient,
  opts: { workspaceId: string; taskIds: string[] },
): Promise<Map<string, ChecklistProgress>> {
  const out = new Map<string, ChecklistProgress>();
  if (opts.taskIds.length === 0) return out;

  const { rows } = await client.query<{ task_id: string; done: string; total: string }>(
    `SELECT ci.task_id,
            count(*) FILTER (WHERE ci.is_done)::text AS done,
            count(*)::text AS total
       FROM checklist_items ci
       JOIN tasks t ON t.id = ci.task_id
      WHERE ci.task_id = ANY($1::uuid[]) AND t.workspace_id = $2
      GROUP BY ci.task_id`,
    [opts.taskIds, opts.workspaceId],
  );
  for (const r of rows) {
    out.set(r.task_id, { done: Number(r.done), total: Number(r.total) });
  }
  return out;
}

export async function addChecklistItem(
  client: SqlClient,
  opts: {
    workspaceId: string; taskId: string; content: string;
    assigneeId?: string | null; dueDate?: string | null;
  },
): Promise<ChecklistItem> {
  await assertTaskVisible(client, opts.workspaceId, opts.taskId);

  await client.query("BEGIN");
  try {
    /**
     * Posisi berikutnya dihitung DI DALAM transaksi. `MAX(position)+1` pada
     * koneksi terpisah bisa menghasilkan posisi yang sama untuk dua penulis
     * bersamaan, dan pelanggaran indeks unik muncul sebagai 500.
     */
    const { rows: maxRow } = await client.query<{ next: number }>(
      "SELECT COALESCE(MAX(position) + 1, 0) AS next FROM checklist_items WHERE task_id = $1",
      [opts.taskId],
    );
    const position = maxRow[0]!.next;

    const { rows } = await client.query<ChecklistItem>(
      `INSERT INTO checklist_items (id, workspace_id, task_id, content, assignee_id, due_date, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLUMNS}`,
      [randomUuid(), opts.workspaceId, opts.taskId, opts.content,
        opts.assigneeId ?? null, opts.dueDate ?? null, position],
    );
    await client.query("COMMIT");
    return rows[0]!;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Memperbarui item. Semua field opsional: `is_done` saja cukup untuk mencentang.
 *
 * KENAPA `content` divalidasi di sini juga, padahal ada CHECK di skema: CHECK
 * menghasilkan 500 lewat driver. Klien yang mengirim 600 karakter harus melihat
 * 400 dengan nama field, bukan "kesalahan internal".
 */
export async function updateChecklistItem(
  client: SqlClient,
  opts: {
    workspaceId: string; itemId: string;
    patch: { content?: string; is_done?: boolean; assigneeId?: string | null; dueDate?: string | null };
  },
): Promise<ChecklistItem> {
  const current = await loadItem(client, opts.workspaceId, opts.itemId);
  if (!current) throw ApiError.notFound("Item checklist");

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (opts.patch.content !== undefined) {
    const c = opts.patch.content.trim();
    if (c.length === 0 || c.length > 500) {
      throw ApiError.validation("isi checklist harus 1–500 karakter", "content");
    }
    vals.push(c);
    sets.push(`content = $${vals.length}`);
  }
  if (opts.patch.is_done !== undefined) {
    vals.push(opts.patch.is_done);
    sets.push(`is_done = $${vals.length}`);
  }
  if (opts.patch.assigneeId !== undefined) {
    vals.push(opts.patch.assigneeId);
    sets.push(`assignee_id = $${vals.length}`);
  }
  if (opts.patch.dueDate !== undefined) {
    vals.push(opts.patch.dueDate);
    sets.push(`due_date = $${vals.length}`);
  }
  if (sets.length === 0) return current;

  vals.push(opts.itemId);
  const { rows } = await client.query<ChecklistItem>(
    `UPDATE checklist_items SET ${sets.join(", ")}, updated_at = now()
      WHERE id = $${vals.length} RETURNING ${COLUMNS}`,
    vals,
  );
  return rows[0]!;
}

/**
 * Menghapus item lalu menormalkan posisi sisanya menjadi 0..n-1.
 *
 * Tanpa penormalan, posisi menjadi berlubang (0, 2, 5, …). Itu tidak salah
 * secara data, tetapi membuat pengurutan ulang (drag-and-drop kelak) harus
 * menebak jarak antar-item, dan `position` berhenti bermakna sebagai indeks.
 */
export async function deleteChecklistItem(
  client: SqlClient,
  opts: { workspaceId: string; itemId: string },
): Promise<{ deleted: boolean }> {
  const current = await loadItem(client, opts.workspaceId, opts.itemId);
  if (!current) throw ApiError.notFound("Item checklist");

  await client.query("BEGIN");
  try {
    await client.query("DELETE FROM checklist_items WHERE id = $1", [opts.itemId]);
    await resequence(client, current.task_id);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  return { deleted: true };
}

/**
 * Menormalkan posisi. Dilakukan dengan menggeser ke rentang sementara yang
 * tidak mungkin bertabrakan (1000+), lalu memberi nomor final.
 *
 * KENAPA TIDAK LANGSUNG `SET position = row_number()`: UPDATE memeriksa indeks
 * unik per baris. Mengubah 0,1,2 menjadi 0,1 dengan cara naif bisa mengenai
 * posisi yang masih dipakai baris lain di tengah pernyataan.
 */
async function resequence(client: SqlClient, taskId: string): Promise<void> {
  await client.query(
    `UPDATE checklist_items SET position = position + 100000 WHERE task_id = $1`,
    [taskId],
  );
  await client.query(
    `UPDATE checklist_items ci SET position = s.rn
       FROM (SELECT id, (row_number() OVER (ORDER BY position)) - 1 AS rn
               FROM checklist_items WHERE task_id = $1) s
      WHERE ci.id = s.id`,
    [taskId],
  );
}

async function loadItem(
  client: SqlClient,
  workspaceId: string,
  itemId: string,
): Promise<ChecklistItem | null> {
  const { rows } = await client.query<ChecklistItem>(
    `SELECT ${COLUMNS.split(", ").map((c) => `ci.${c}`).join(", ")}
       FROM checklist_items ci
      WHERE ci.id = $1
        AND EXISTS (SELECT 1 FROM tasks t
                     WHERE t.id = ci.task_id AND t.workspace_id = $2 AND t.deleted_at IS NULL)`,
    [itemId, workspaceId],
  );
  return rows[0] ?? null;
}

async function assertTaskVisible(client: SqlClient, workspaceId: string, taskId: string): Promise<void> {
  const { rows } = await client.query(
    "SELECT 1 FROM tasks WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
    [taskId, workspaceId],
  );
  if (rows.length === 0) throw ApiError.notFound("Task");
}

function randomUuid(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
