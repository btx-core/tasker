import type { SqlClient } from "../client.js";
/**
 * Lapisan BACA. Tidak ada mutasi di sini.
 *
 * Keputusan bentuk respons ada di `api-contract.md` §8.4: board memakai bentuk
 * RINGKAS (tanpa `description`), detail memakai bentuk PENUH. Pemisahan itu
 * eksplisit — endpoint tidak pernah "kadang berat".
 */

/** Bentuk ringkas (board & list), api-contract.md §8.4. */
export interface TaskSummary {
  id: string;
  number: number;
  title: string;
  status_id: string;
  category: number;
  priority: number;
  assignee_id: string | null;
  due_date: string | null;
  effort: number | null;
  version: number;
  updated_at: Date;
  labels: Array<{ id: string; name: string; color: string }>;
  checklist_progress: { done: number; total: number };
}

export interface BoardColumn {
  status_id: string;
  name: string;
  category: number;
  position: number;
  tasks: TaskSummary[];
  /** true bila kolom dipotong pada `limit` — UI menampilkan "lihat semua". */
  truncated: boolean;
}

export interface BoardResult {
  team_id: string;
  columns: BoardColumn[];
  /** Jumlah query yang benar-benar dijalankan. Diuji agar tetap 4. */
  query_count: number;
}

const BOARD_LIMIT = 50;

/**
 * Board 7 kolom.
 *
 * KENAPA `LATERAL ... LIMIT 51`, BUKAN SATU WINDOW FUNCTION:
 * Versi pertama saya memakai `row_number() OVER (PARTITION BY status_id)`
 * untuk mendapatkan semua kolom dalam SATU query. Terdengar hemat round-trip,
 * dan P2-04 membuktikan itu SALAH: window function tidak bisa berhenti lebih
 * awal, jadi PostgreSQL memindai SELURUH 49.000 baris tim (p95 ~900 ms di
 * PGlite) hanya untuk mengembalikan 350 task.
 *
 * Pada 50 rb baris itu "masih jalan". Pada 500 rb baris ia menjadi kegagalan
 * NFR-004 yang diam-diam — persis yang diperingatkan `perf-validation.md`.
 *
 * `LEFT JOIN LATERAL (...) LIMIT 51` memberi ketiganya sekaligus:
 *  - hanya SATU round-trip (alasan awal saya memakai window function),
 *  - tiap kolom memakai `ix_tasks_board` dan BERHENTI setelah 51 baris,
 *  - `LIMIT 51` (bukan 50) memberi `truncated` tanpa `count(*)` atas seluruh
 *    tabel, karena baris ke-51 hanya ada bila kolom memang terpotong.
 *
 * `LEFT` JOIN memastikan status tanpa task tetap muncul sebagai kolom kosong.
 */
export async function loadBoard(
  client: SqlClient,
  scope: { workspaceId: string; teamId: string },
  limit: number = BOARD_LIMIT,
): Promise<BoardResult> {
  const capped = Math.min(Math.max(limit, 1), 200);
  let queryCount = 0;

  const statuses = await client.query<{
    id: string; name: string; category: number; position: number;
  }>(
    `SELECT id, name, category, position
       FROM statuses
      WHERE workspace_id = $1 AND team_id = $2 AND archived_at IS NULL
      ORDER BY position, id`,
    [scope.workspaceId, scope.teamId],
  );
  queryCount++;

  // Semua kolom dalam satu round-trip, tetapi tiap kolom tetap index-backed
  // dan berhenti di 51 baris. `capped + 1` adalah pembawa sinyal `truncated`.
  const rows = await client.query<{
    id: string | null; number: string | null; title: string | null;
    status_id: string | null; category: number; priority: number;
    assignee_id: string | null; due_date: string | null;
    effort: number | null; version: number; updated_at: Date;
    rn: string | null;
  }>(
    `SELECT x.id, x.number, x.title, x.status_id, x.category, x.priority,
            x.assignee_id, x.due_date::text AS due_date, x.effort, x.version,
            x.updated_at, x.rn
       FROM statuses s
       LEFT JOIN LATERAL (
         SELECT t.id, t.number, t.title, t.status_id, st.category,
                t.priority, t.assignee_id, t.due_date, t.effort, t.version,
                t.updated_at,
                row_number() OVER (ORDER BY t.updated_at DESC, t.id DESC) AS rn
           FROM tasks t
           JOIN statuses st ON st.id = t.status_id
          WHERE t.workspace_id = $1 AND t.team_id = $2
            AND t.status_id = s.id AND t.deleted_at IS NULL
          ORDER BY t.updated_at DESC, t.id DESC
          LIMIT $3
       ) x ON true
      WHERE s.workspace_id = $1 AND s.team_id = $2 AND s.archived_at IS NULL
      ORDER BY s.position, s.id, x.rn`,
    [scope.workspaceId, scope.teamId, capped + 1],
  );
  queryCount++;

  const allRows = rows.rows.filter((r) => r.id !== null);
  const visible = allRows.filter((r) => Number(r.rn) <= capped);
  const ids = visible.map((r) => r.id!);

  const labelsByTask = new Map<string, Array<{ id: string; name: string; color: string }>>();
  const progressByTask = new Map<string, { done: number; total: number }>();

  if (ids.length > 0) {
    // 2 query terakhir HANYA untuk task yang dikembalikan.
    const labels = await client.query<{
      task_id: string; id: string; name: string; color: string;
    }>(
      `SELECT tl.task_id, l.id, l.name, l.color
         FROM task_labels tl
         JOIN labels l ON l.id = tl.label_id
        WHERE tl.workspace_id = $1 AND tl.task_id = ANY($2::uuid[])
        ORDER BY l.name`,
      [scope.workspaceId, ids],
    );
    queryCount++;
    for (const l of labels.rows) {
      const arr = labelsByTask.get(l.task_id) ?? [];
      arr.push({ id: l.id, name: l.name, color: l.color });
      labelsByTask.set(l.task_id, arr);
    }

    const progress = await client.query<{ task_id: string; done: string; total: string }>(
      `SELECT task_id,
              count(*) FILTER (WHERE is_done) AS done,
              count(*) AS total
         FROM checklist_items
        WHERE workspace_id = $1 AND task_id = ANY($2::uuid[])
        GROUP BY task_id`,
      [scope.workspaceId, ids],
    );
    queryCount++;
    for (const p of progress.rows) {
      progressByTask.set(p.task_id, { done: Number(p.done), total: Number(p.total) });
    }
  }

  const byStatus = new Map<string, TaskSummary[]>();
  const truncatedByStatus = new Set<string>();
  for (const r of allRows) {
    const statusId = r.status_id!;
    if (Number(r.rn) > capped) {
      // Baris ke-(capped+1) ada -> kolom ini terpotong. Tidak perlu count(*).
      truncatedByStatus.add(statusId);
      continue;
    }
    const list = byStatus.get(statusId) ?? [];
    list.push({
      id: r.id!,
      number: Number(r.number),
      title: r.title!,
      status_id: statusId,
      category: r.category,
      priority: r.priority,
      assignee_id: r.assignee_id,
      due_date: r.due_date,
      effort: r.effort,
      version: r.version,
      updated_at: r.updated_at,
      labels: labelsByTask.get(r.id!) ?? [],
      checklist_progress: progressByTask.get(r.id!) ?? { done: 0, total: 0 },
    });
    byStatus.set(statusId, list);
  }

  return {
    team_id: scope.teamId,
    query_count: queryCount,
    columns: statuses.rows.map((s) => ({
      status_id: s.id,
      name: s.name,
      category: s.category,
      position: s.position,
      tasks: byStatus.get(s.id) ?? [],
      truncated: truncatedByStatus.has(s.id),
    })),
  };
}
