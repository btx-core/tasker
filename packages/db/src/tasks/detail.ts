/**
 * Detail task (bentuk PENUH, api-contract.md §8.4) + riwayat `task_events`.
 *
 * Riwayat diurutkan ASCENDING menurut `seq` untuk tampilan, tetapi diambil
 * dengan LIMIT dari ujung terbaru agar task berumur panjang tidak mengirim
 * ribuan baris. Dua hal itu bisa tampak bertentangan; penjelasannya: kita
 * memilih "N event TERAKHIR", lalu menampilkannya dalam urutan kejadian.
 */
import { ApiError } from "@kelindan/shared";
import type { SqlClient } from "../client.js";

export interface TaskEventRow {
  id: string;
  seq: number;
  kind: number;
  source: number;
  actor: { id: string; display_name: string } | null;
  from_value: unknown;
  to_value: unknown;
  category_from: number | null;
  category_to: number | null;
  created_at: Date;
}

export interface TaskDetail {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status_id: string;
  category: number;
  priority: number;
  assignee_id: string | null;
  due_date: string | null;
  effort: number | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  deleted_at: Date | null;
  created_by: string | null;
  labels: Array<{ id: string; name: string; color: string }>;
  checklist: Array<{ id: string; content: string; is_done: boolean; position: number }>;
  events: TaskEventRow[];
  events_truncated: boolean;
}

const DEFAULT_EVENT_LIMIT = 100;

export async function loadTaskDetail(
  client: SqlClient,
  scope: { workspaceId: string },
  taskId: string,
  eventLimit: number = DEFAULT_EVENT_LIMIT,
): Promise<TaskDetail | null> {
  const t = await client.query<Omit<TaskDetail, "labels" | "checklist" | "events" | "events_truncated">>(
    `SELECT t.id, t.number::bigint::int AS number, t.title, t.description,
            t.status_id, s.category, t.priority, t.assignee_id,
            t.due_date::text AS due_date, t.effort, t.version,
            t.created_at, t.updated_at, t.completed_at, t.deleted_at, t.created_by
       FROM tasks t
       JOIN statuses s ON s.id = t.status_id
      WHERE t.id = $1 AND t.workspace_id = $2`,
    [taskId, scope.workspaceId],
  );
  const task = t.rows[0];
  // Task tenant lain -> null -> 404 di handler (anti-enumerasi, §5.5).
  if (!task) return null;

  const labels = await client.query<{ id: string; name: string; color: string }>(
    `SELECT l.id, l.name, l.color
       FROM task_labels tl JOIN labels l ON l.id = tl.label_id
      WHERE tl.workspace_id = $1 AND tl.task_id = $2
      ORDER BY l.name`,
    [scope.workspaceId, taskId],
  );

  const checklist = await client.query<{
    id: string; content: string; is_done: boolean; position: number;
  }>(
    `SELECT id, content, is_done, position
       FROM checklist_items
      WHERE workspace_id = $1 AND task_id = $2
      ORDER BY position`,
    [scope.workspaceId, taskId],
  );

  const lim = Math.min(Math.max(eventLimit, 1), 500);
  // Ambil lim+1 dari yang TERBARU, lalu balik urutannya untuk tampilan.
  const ev = await client.query<TaskEventRow & { actor_id: string | null; actor_name: string | null }>(
    `SELECT e.id, e.seq::bigint::int AS seq, e.kind, e.source,
            e.actor_id, u.display_name AS actor_name,
            e.from_value, e.to_value, e.category_from, e.category_to, e.created_at
       FROM task_events e
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.workspace_id = $1 AND e.task_id = $2
      ORDER BY e.seq DESC
      LIMIT $3`,
    [scope.workspaceId, taskId, lim + 1],
  );
  const truncated = ev.rows.length > lim;
  const events = ev.rows.slice(0, lim).reverse().map((r) => ({
    id: r.id,
    seq: r.seq,
    kind: r.kind,
    source: r.source,
    actor: r.actor_id ? { id: r.actor_id, display_name: r.actor_name ?? "" } : null,
    from_value: r.from_value,
    to_value: r.to_value,
    category_from: r.category_from,
    category_to: r.category_to,
    created_at: r.created_at,
  }));

  return {
    ...task,
    labels: labels.rows,
    checklist: checklist.rows,
    events,
    events_truncated: truncated,
  };
}

/** Dipakai handler untuk membedakan 404 dari "ada tapi terhapus". */
export async function taskExists(
  client: SqlClient, workspaceId: string, taskId: string,
): Promise<boolean> {
  const r = await client.query("SELECT 1 FROM tasks WHERE id = $1 AND workspace_id = $2", [taskId, workspaceId]);
  return (r.rowCount ?? 0) > 0;
}

export function assertFound<T>(v: T | null, what: string): T {
  if (v === null) throw ApiError.notFound(what);
  return v;
}
