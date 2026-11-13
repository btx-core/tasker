/**
 * Protokol WebSocket (api-contract.md §10.1, realtime-and-search.md §1–§2).
 *
 * Berkas ini SENGAJA hanya berisi tipe + parser tanpa I/O, sehingga aturan
 * yang mudah salah (batas 5 tim, `since_seq`, klasifikasi K1/K2/K3) bisa
 * diuji tanpa soket. Server (`hub.ts`) dan klien memakai aturan yang sama.
 */
import { ApiError } from "@kelindan/shared";

/** realtime-and-search.md §1. Default aman: tanpa klasifikasi = TIDAK disiarkan. */
export const ENTITY_CLASS = {
  1: "task",
  2: "comment",
  3: "status",
  4: "team",
  5: "goal",
  6: "checklist_item",
  7: "label",
} as const;

export type EntityClass = (typeof ENTITY_CLASS)[keyof typeof ENTITY_CLASS];

/** K1 = patch per entitas; K2 = entitas penuh. K3 tidak ada di peta ini. */
export const BROADCAST_CLASS: Record<EntityClass, "K1" | "K2"> = {
  task: "K1",
  comment: "K1",
  checklist_item: "K1",
  status: "K2",
  label: "K2",
  team: "K2",
  goal: "K2",
};

/**
 * K3: TIDAK PERNAH disiarkan. Daftar ini ada supaya objek K3 yang entah
 * bagaimana sampai ke `changes` tetap ditolak di titik keluar — bukan hanya
 * "tidak sengaja tidak dikirim".
 */
export const NEVER_BROADCAST = new Set([
  "audit_event", "email_message", "job", "import", "notification", "saved_view",
]);

export const MAX_TEAMS_PER_CONNECTION = 5;
export const MAX_DELTAS_PER_FRAME = 50;
export const DELTA_MAX_BYTES = 4096;

// ---- Klien -> server ------------------------------------------------------

export type ClientMessage =
  | { op: "subscribe"; team_ids: string[]; since_seq?: number }
  | { op: "unsubscribe"; team_ids: string[] }
  | { op: "ping" };

// ---- Server -> klien ------------------------------------------------------

export interface DeltaFrame {
  op: "delta";
  seq: number;
  entity: string;
  entity_type: number;
  id: string;
  team_id: string | null;
  version: number | null;
  op_kind: 1 | 2;
  patch: unknown;
}

export type ServerMessage =
  | { op: "subscribed"; team_ids: string[]; seq: number; resync_required: boolean; rejected: string[] }
  | { op: "delta_batch"; frames: DeltaFrame[] }
  | { op: "resync_required"; reason: string; team_ids: string[] }
  | { op: "revoked"; team_id: string }
  | { op: "pong" }
  | { op: "error"; code: string; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse pesan klien. Melempar `ApiError` dengan `code` yang stabil — bukan
 * string bebas, karena klien memutuskan perilaku dari `code`.
 */
export function parseClientMessage(raw: string): ClientMessage {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "validation.failed", "pesan bukan JSON yang sah");
  }
  if (typeof v !== "object" || v === null || !("op" in v)) {
    throw new ApiError(400, "validation.failed", "pesan tanpa op");
  }
  const m = v as Record<string, unknown>;

  if (m["op"] === "ping") return { op: "ping" };

  if (m["op"] === "subscribe") {
    const ids = m["team_ids"];
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ApiError(400, "validation.failed", "team_ids wajib berisi minimal satu tim");
    }
    if (!ids.every((x) => typeof x === "string" && UUID_RE.test(x))) {
      throw new ApiError(400, "validation.failed", "team_ids harus uuid");
    }
    const since = m["since_seq"];
    if (since !== undefined && (typeof since !== "number" || !Number.isInteger(since) || since < 0)) {
      throw new ApiError(400, "validation.failed", "since_seq harus bilangan bulat >= 0");
    }
    return {
      op: "subscribe",
      team_ids: ids as string[],
      ...(since !== undefined ? { since_seq: since as number } : {}),
    };
  }

  if (m["op"] === "unsubscribe") {
    const ids = m["team_ids"];
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) {
      throw new ApiError(400, "validation.failed", "team_ids harus array string");
    }
    return { op: "unsubscribe", team_ids: ids as string[] };
  }

  throw new ApiError(400, "validation.failed", `op tidak dikenal: ${String(m["op"])}`);
}

/** Batas 5 tim/koneksi. Tim ke-6 DITOLAK dengan alasan, bukan diam. */
export function capTeams(
  current: Iterable<string>,
  requested: string[],
): { accepted: string[]; rejected: string[] } {
  const set = new Set(current);
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const id of requested) {
    if (set.has(id)) continue; // sudah dilanggan: bukan penambahan
    if (set.size >= MAX_TEAMS_PER_CONNECTION) {
      rejected.push(id);
      continue;
    }
    set.add(id);
    accepted.push(id);
  }
  return { accepted, rejected };
}

/**
 * Apakah entitas ini boleh disiarkan? K3 TIDAK PERNAH. Objek tanpa
 * klasifikasi juga tidak (default aman, §1).
 */
export function isBroadcastable(entityType: number, entityName?: string): boolean {
  if (entityName !== undefined && NEVER_BROADCAST.has(entityName)) return false;
  const c = (ENTITY_CLASS as Record<number, EntityClass | undefined>)[entityType];
  if (c === undefined) return false;
  return BROADCAST_CLASS[c] !== undefined;
}
