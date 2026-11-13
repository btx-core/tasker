/**
 * Daftar task dengan paginasi cursor (api-contract.md §8.1, INV-11).
 *
 * KENAPA CURSOR, BUKAN OFFSET: dengan OFFSET, menyisipkan satu task di atas
 * membuat halaman 2 mengulang item yang sudah dilihat (atau melewatkan satu
 * item). Pada board tim yang hidup, itu terjadi sepanjang hari. Cursor
 * `(sort_key, id)` tidak punya masalah itu karena posisinya absolut.
 *
 * TIDAK ADA `total`. Total mahal pada dataset besar dan menyesatkan — ia
 * berubah di antara dua halaman. Endpoint hitung terpisah bila perlu.
 */
import { ApiError } from "@kelindan/shared";
import type { SqlClient } from "../client.js";

export const ORDER_KEYS = ["updated_at", "created_at", "due_date", "number"] as const;
export type OrderKey = (typeof ORDER_KEYS)[number];

export interface Order {
  key: OrderKey;
  desc: boolean;
}

export interface TaskFilter {
  statusIds?: string[];
  assigneeId?: string;
  category?: number;
  updatedSince?: Date;
  includeDeleted?: boolean;
}

export interface ListParams {
  workspaceId: string;
  teamId: string;
  order?: Order;
  filter?: TaskFilter;
  limit?: number;
  cursor?: string | null;
}

export interface ListRow {
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
  created_at: Date;
}

export interface ListResult {
  rows: ListRow[];
  has_more: boolean;
  next_cursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Kolom untuk tiap kunci urutan. Allowlist — jangan pernah interpolasi input. */
const COLUMN: Record<OrderKey, string> = {
  updated_at: "t.updated_at",
  created_at: "t.created_at",
  due_date: "t.due_date",
  number: "t.number",
};

const CAST: Record<OrderKey, string> = {
  updated_at: "timestamptz",
  created_at: "timestamptz",
  due_date: "date",
  number: "bigint",
};

interface Cursor {
  k: string | number | null;
  i: string;
  o: string; // "key:dir" — menolak cursor dari urutan lain
}

export function encodeCursor(k: string | number | null, i: string, order: Order): string {
  const payload: Cursor = { k, i, o: `${order.key}:${order.desc ? "desc" : "asc"}` };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(raw: string, order: Order): { k: string | number | null; i: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(400, "validation.failed", "cursor tidak sah", { field: "cursor" });
  }
  const c = parsed as Partial<Cursor>;
  const expected = `${order.key}:${order.desc ? "desc" : "asc"}`;
  // Cursor dari urutan lain tidak punya arti. Lebih baik menolak daripada
  // mengembalikan halaman yang diam-diam salah.
  if (typeof c !== "object" || c === null || c.o !== expected || typeof c.i !== "string") {
    throw new ApiError(400, "validation.failed", "cursor tidak sesuai urutan", { field: "cursor" });
  }
  if (!(c.k === null || typeof c.k === "string" || typeof c.k === "number")) {
    throw new ApiError(400, "validation.failed", "cursor tidak sah", { field: "cursor" });
  }
  return { k: c.k, i: c.i };
}

export function parseOrderParams(params: URLSearchParams): { order: Order; filter: TaskFilter } {
  const known = new Set([
    "order", "limit", "cursor", "status_id", "assignee_id", "category",
    "updated_since", "include_deleted", "fields",
  ]);
  for (const key of params.keys()) {
    if (!known.has(key)) {
      // Konsisten dengan PATCH: filter salah tulis tidak boleh "berhasil" diam-diam.
      throw new ApiError(400, "validation.failed", `filter tidak dikenal: ${key}`, { field: key });
    }
  }

  const raw = params.get("order") ?? "-updated_at";
  const desc = raw.startsWith("-");
  const key = (desc ? raw.slice(1) : raw) as OrderKey;
  if (!ORDER_KEYS.includes(key)) {
    throw new ApiError(400, "validation.failed", `order tidak dikenal: ${key}`, { field: "order" });
  }

  const filter: TaskFilter = {};
  const statuses = params.getAll("status_id");
  if (statuses.length > 0) filter.statusIds = statuses;
  const assignee = params.get("assignee_id");
  if (assignee !== null) filter.assigneeId = assignee;
  const category = params.get("category");
  if (category !== null) {
    const n = Number(category);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      throw new ApiError(400, "validation.failed", "category harus 1-5", { field: "category" });
    }
    filter.category = n;
  }
  const since = params.get("updated_since");
  if (since !== null) {
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) {
      throw new ApiError(400, "validation.failed", "updated_since bukan waktu sah", {
        field: "updated_since",
      });
    }
    filter.updatedSince = d;
  }
  if (params.get("include_deleted") === "true") filter.includeDeleted = true;

  return { order: { key, desc }, filter };
}

export function parseLimit(params: URLSearchParams): number {
  const raw = params.get("limit");
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new ApiError(400, "validation.failed", `limit harus 1-${MAX_LIMIT}`, { field: "limit" });
  }
  return n;
}

export async function listTasks(client: SqlClient, p: ListParams): Promise<ListResult> {
  const order = p.order ?? { key: "updated_at", desc: true };
  const filter = p.filter ?? {};
  const limit = Math.min(Math.max(p.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const col = COLUMN[order.key];

  const where: string[] = ["t.workspace_id = $1", "t.team_id = $2"];
  const args: unknown[] = [p.workspaceId, p.teamId];

  if (!filter.includeDeleted) where.push("t.deleted_at IS NULL");
  if (filter.statusIds && filter.statusIds.length > 0) {
    args.push(filter.statusIds);
    where.push(`t.status_id = ANY($${args.length}::uuid[])`);
  }
  if (filter.assigneeId !== undefined) {
    args.push(filter.assigneeId);
    where.push(`t.assignee_id = $${args.length}`);
  }
  if (filter.category !== undefined) {
    args.push(filter.category);
    where.push(`s.category = $${args.length}`);
  }
  if (filter.updatedSince !== undefined) {
    args.push(filter.updatedSince);
    where.push(`t.updated_at >= $${args.length}`);
  }

  // Pembanding baris `(k, i)` — bukan `k < x OR (k = x AND i < y)` yang salah
  // untuk lebih dari satu baris. `NULL` pada due_date ditangani terpisah
  // karena NULLS LAST tidak bisa diekspresikan dengan pembanding baris.
  if (p.cursor) {
    const c = decodeCursor(p.cursor, order);
    const cast = CAST[order.key];
    const op = order.desc ? "<" : ">";
    if (c.k === null) {
      // Baris sebelumnya punya kunci NULL -> lanjutkan di antara NULL saja.
      args.push(c.i);
      where.push(`(${col} IS NULL AND t.id ${op} $${args.length}::uuid)`);
    } else {
      args.push(c.k);
      const kIdx = args.length;
      args.push(c.i);
      const iIdx = args.length;
      where.push(
        `((${col} IS NOT NULL AND (${col}, t.id) ${op} ($${kIdx}::${cast}, $${iIdx}::uuid))
          OR ${col} IS NULL)`,
      );
    }
  }

  // Ambil limit+1 untuk mengetahui has_more tanpa query COUNT.
  args.push(limit + 1);
  const limitIdx = args.length;

  const dir = order.desc ? "DESC" : "ASC";
  const nulls = "NULLS LAST";
  const sql = `
    SELECT t.id, t.number, t.title, t.status_id, s.category,
           t.priority, t.assignee_id, t.due_date::text AS due_date, t.effort,
           t.version, t.updated_at, t.created_at,
           ${col} AS sort_key
      FROM tasks t
      JOIN statuses s ON s.id = t.status_id
     WHERE ${where.join(" AND ")}
     ORDER BY ${col} ${dir} ${nulls}, t.id ${dir}
     LIMIT $${limitIdx}`;

  const res = await client.query<ListRow & { sort_key: string | number | null }>(sql, args);
  const hasMore = res.rows.length > limit;
  const rows = res.rows.slice(0, limit);

  let nextCursor: string | null = null;
  if (hasMore && rows.length > 0) {
    const last = res.rows[limit - 1]!;
    nextCursor = encodeCursor(last.sort_key, last.id, order);
  }

  return {
    // `sort_key` hanya untuk cursor; jangan bocor ke klien.
    rows: rows.map((r) => {
      const out = { ...r } as Record<string, unknown>;
      delete out["sort_key"];
      return { ...out, number: Number(r.number) } as unknown as ListRow;
    }),
    has_more: hasMore,
    next_cursor: nextCursor,
  };
}
