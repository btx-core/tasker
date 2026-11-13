/**
 * Klien API (P4-01). Aturan yang dipegang di satu tempat:
 *  - `Idempotency-Key` dibuat OTOMATIS untuk setiap non-GET. Tanpa ini,
 *    retry jaringan akan melahirkan task ganda — bukan kesalahan pengguna.
 *  - Kunci DIPERTAHANKAN saat retry. Membuat kunci baru pada retry sama saja
 *    dengan tidak punya kunci.
 *  - `trace_id` selalu tersedia untuk ditampilkan (api-contract.md §5.4).
 *
 * Catatan transport: klien ini memakai cookie sesi. Path relatif dipakai
 * supaya UI tidak pernah menembak localhost dari browser pengguna.
 */
import { ApiError, ERROR_CODES, type ApiErrorBody } from "@kelindan/shared";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: (ApiErrorBody & { retryable: boolean }) | null;
}

const RETRYABLE_STATUS = new Set([429, 503]);

function newKey(): string {
  // ULID-ish; cukup unik dan terurut (shared/ids.ts juga punya ini, tapi web
  // tidak boleh mengimpor id server — uuidv7 aman & murni).
  const c = globalThis.crypto;
  if (!c?.randomUUID) return `k${Date.now()}${Math.random().toString(36).slice(2)}`;
  return c.randomUUID();
}

export interface ClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Jumlah percobaan ulang untuk galat yang aman diulang. */
  maxAttempts?: number;
  /** Dipakai uji agar tidak benar-benar menunggu. */
  sleep?: (ms: number) => Promise<void>;
}

interface ResolvedOptions {
  baseUrl: string;
  maxAttempts: number;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export class HttpClient {
  private opts: ResolvedOptions;

  constructor(opts: ClientOptions = {}) {
    this.opts = {
      baseUrl: opts.baseUrl ?? "",
      maxAttempts: opts.maxAttempts ?? 3,
      fetchImpl: opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init)),
      sleep: opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    };
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    init: { idempotencyKey?: string } = {},
  ): Promise<ApiResult<T>> {
    const key = method === "GET" ? null : (init.idempotencyKey ?? newKey());
    let lastError: ApiResult<T>["error"] = null;
    let lastStatus = 0;

    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      // KUNCI YANG SAMA di setiap percobaan. Ini inti idempotensi.
      if (key) headers["idempotency-key"] = key;

      let res: Response;
      try {
        res = await this.opts.fetchImpl(`${this.opts.baseUrl}${path}`, {
          method, headers, credentials: "include",
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        // Galat jaringan: aman diulang hanya karena ada Idempotency-Key.
        lastStatus = 0;
        lastError = {
          code: ERROR_CODES.INTERNAL, message: "Jaringan terputus",
          trace_id: "", retryable: true,
        };
        if (attempt < this.opts.maxAttempts) {
          await this.opts.sleep(150 * 2 ** (attempt - 1));
          continue;
        }
        return { ok: false, status: 0, data: null, error: lastError };
      }

      const text = await res.text();
      const parsed: unknown = text ? JSON.parse(text) : null;
      if (res.ok) {
        return { ok: true, status: res.status, data: parsed as T, error: null };
      }

      lastStatus = res.status;
      const e = (parsed ?? {}) as Partial<ApiErrorBody>;
      lastError = {
        code: e.code ?? ERROR_CODES.INTERNAL,
        message: e.message ?? "Terjadi kesalahan",
        trace_id: e.trace_id ?? res.headers.get("x-trace-id") ?? "",
        ...(e.field !== undefined ? { field: e.field } : {}),
        ...(e.current !== undefined ? { current: e.current } : {}),
        retryable: RETRYABLE_STATUS.has(res.status),
      };
      if (!lastError.retryable || attempt === this.opts.maxAttempts) break;
      await this.opts.sleep(150 * 2 ** (attempt - 1));
    }
    return { ok: false, status: lastStatus, data: null, error: lastError };
  }

  /**
   * Rute auth. Sengaja TIDAK diulang otomatis: `request()` otomatis mengulang
   * galat jaringan untuk non-GET, dan percobaan login yang diulang diam-diam
   * menghabiskan jatah 10/menit (NFR-014). Login harus satu percobaan per
   * penekanan tombol — pengguna yang menekan dua kali tahu apa yang ia lakukan.
   */
  async login(email: string, password: string) {
    return this.send<{ user: { id: string; displayName: string; workspaceId: string | null } }>(
      "POST", "/v1/auth/login", { email, password },
    );
  }

  async logout() {
    return this.send<null>("POST", "/v1/auth/logout");
  }

  async me() {
    return this.send<{ user: { id: string; display_name: string; email: string }; workspace_id: string }>(
      "GET", "/v1/me",
    );
  }

  /** Satu percobaan, tanpa retry otomatis. Lihat catatan pada `login`. */
  private async send<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await this.opts.fetchImpl(`${this.opts.baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        credentials: "include",
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      return {
        ok: false, status: 0, data: null,
        error: { code: ERROR_CODES.INTERNAL, message: "Jaringan terputus", trace_id: "", retryable: true },
      };
    }
    const text = await res.text();
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (res.ok) return { ok: true, status: res.status, data: parsed as T, error: null };
    const e = (parsed ?? {}) as Partial<ApiErrorBody>;
    return {
      ok: false, status: res.status, data: null,
      error: {
        code: e.code ?? ERROR_CODES.INTERNAL,
        message: e.message ?? "Terjadi kesalahan",
        trace_id: e.trace_id ?? "",
        retryable: RETRYABLE_STATUS.has(res.status),
      },
    };
  }

  patchTask(taskId: string, patch: Record<string, unknown>, idempotencyKey?: string) {
    return this.request<{ task: Record<string, unknown>; seq: number; replayed: boolean }>(
      "PATCH", `/v1/tasks/${taskId}`, patch,
      idempotencyKey ? { idempotencyKey } : {},
    );
  }

  board(teamId: string) {
    return this.request<BoardPayload>("GET", `/v1/teams/${teamId}/board`);
  }
}

/** Bentuk respons board (P2-01). Dicerminkan, bukan diimpor dari server. */
export interface BoardTask {
  id: string; number: number; title: string; status_id: string; category: number;
  priority: number; assignee_id: string | null; due_date: string | null;
  effort: number | null; version: number; updated_at: string;
  labels: Array<{ id: string; name: string; color: string }>;
  checklist_progress: { done: number; total: number };
}

export interface BoardColumnPayload {
  status_id: string; name: string; category: number; position: number;
  tasks: BoardTask[]; truncated: boolean;
}

export interface BoardPayload {
  team_id: string;
  columns: BoardColumnPayload[];
  query_count: number;
}

export { ApiError };
