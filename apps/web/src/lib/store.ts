/**
 * State board + mutasi optimistis (P4-03) dan konflik (P4-05).
 *
 * Aturan yang membuat optimisme AMAN:
 *  - kartu dipindah dulu, lalu PATCH; bila gagal, kartu DIKEMBALIKAN dan
 *    pesan ditampilkan. Tidak boleh ada kegagalan yang diam.
 *  - konflik versi TIDAK PERNAH ditimpa: state kanonik dari server disimpan
 *    dan dipakai untuk menampilkan pilihan.
 */
import type { HttpClient, BoardPayload, BoardTask, BoardColumnPayload } from "./api.js";

export interface Conflict {
  taskId: string;
  mine: number;
  theirs: number;
  current: Record<string, unknown>;
  traceId: string;
}

export interface BoardState {
  loading: boolean;
  payload: BoardPayload | null;
  error: { message: string; traceId: string } | null;
  conflict: Conflict | null;
  notice: string | null;
  /** id task yang sedang disimpan; UI menampilkan status halus. */
  saving: Set<string>;
}

export function initialState(): BoardState {
  return {
    loading: true, payload: null, error: null, conflict: null, notice: null,
    saving: new Set<string>(),
  };
}

export interface StoreDeps {
  api: HttpClient;
  teamId: string;
  onChange: (s: BoardState) => void;
}

export class BoardStore {
  state: BoardState = initialState();

  constructor(private deps: StoreDeps) {}

  private emit() {
    this.deps.onChange(this.state);
  }

  async load(): Promise<void> {
    this.state = { ...this.state, loading: true, error: null };
    this.emit();
    const res = await this.deps.api.board(this.deps.teamId);
    if (!res.ok || !res.data) {
      this.state = {
        ...this.state, loading: false,
        error: {
          message: res.error?.code ?? "server.error",
          traceId: res.error?.trace_id ?? "",
        },
      };
      this.emit();
      return;
    }
    this.state = { ...this.state, loading: false, payload: res.data, error: null };
    this.emit();
  }

  /** Cari posisi kartu saat ini agar bisa dikembalikan persis. */
  private locate(taskId: string): { colId: string; index: number; task: BoardTask } | null {
    const cols = this.state.payload?.columns ?? [];
    for (const c of cols) {
      const i = c.tasks.findIndex((t) => t.id === taskId);
      if (i >= 0) return { colId: c.status_id, index: i, task: c.tasks[i]! };
    }
    return null;
  }

  /** Pindah kartu secara optimistis, lalu PATCH. Gagal -> kembali ke posisi awal. */
  async moveTask(taskId: string, toStatusId: string): Promise<void> {
    const payload = this.state.payload;
    if (!payload) return;
    const from = this.locate(taskId);
    if (!from) return;
    if (from.colId === toStatusId) return;

    const optimistic = moveCard(payload, taskId, toStatusId);
    const saving = new Set(this.state.saving).add(taskId);
    this.state = { ...this.state, payload: optimistic, notice: null, saving };
    this.emit();

    const res = await this.deps.api.patchTask(taskId, {
      status_id: toStatusId,
      expected_version: from.task.version,
    });

    const nextSaving = new Set(this.state.saving);
    nextSaving.delete(taskId);

    if (res.ok) {
      // Versi baru dari server dipakai apa adanya (server adalah kebenaran).
      const version = Number((res.data as { task: { version: number } }).task.version);
      this.state = {
        ...this.state,
        payload: updateVersion(this.state.payload!, taskId, version),
        saving: nextSaving,
      };
      this.emit();
      return;
    }

    // ROLLBACK. Kartu kembali ke kolom & urutan semula.
    const rolledBack = moveCard(this.state.payload!, taskId, from.colId, from.index);
    const err = res.error;
    if (err?.code === "conflict.version") {
      this.state = {
        ...this.state, payload: rolledBack, saving: nextSaving,
        conflict: {
          taskId,
          mine: from.task.version,
          theirs: Number((err.current as { version?: number } | undefined)?.version ?? 0),
          current: (err.current ?? {}) as Record<string, unknown>,
          traceId: err.trace_id,
        },
        notice: "conflict",
      };
      this.emit();
      return;
    }
    this.state = {
      ...this.state, payload: rolledBack, saving: nextSaving,
      notice: err?.code ?? "server.error",
      error: { message: err?.code ?? "server.error", traceId: err?.trace_id ?? "" },
    };
    this.emit();
  }

  dismissConflict(): void {
    this.state = { ...this.state, conflict: null, notice: null };
    this.emit();
  }

  /** Terapkan delta real-time (P4-04). Delta lebih tua DIABAIKAN. */
  applyDelta(delta: { id: string; version: number | null; patch: unknown }): boolean {
    if (!this.state.payload) return false;
    const found = this.locate(delta.id);
    if (!found) return false;
    // ADR-015(5): hanya bila versi lebih tinggi. At-least-once berarti delta
    // duplikat itu normal, bukan kesalahan.
    if (delta.version !== null && delta.version <= found.task.version) return false;
    const patch = (delta.patch ?? {}) as Partial<BoardTask>;
    const payload: BoardPayload = {
      ...this.state.payload,
      columns: this.state.payload.columns.map((c) => ({
        ...c,
        tasks: c.tasks.map((t) =>
          t.id === delta.id ? { ...t, ...patch, version: delta.version ?? t.version } : t),
      })),
    };
    // Pindah kolom bila status berubah lewat delta.
    const target = typeof patch.status_id === "string" ? patch.status_id : found.colId;
    this.state = {
      ...this.state,
      payload: target === found.colId ? payload : moveCard(payload, delta.id, target),
    };
    this.emit();
    return true;
  }
}

/** Pindahkan kartu antar kolom secara imutabel. */
export function moveCard(
  payload: BoardPayload,
  taskId: string,
  toStatusId: string,
  atIndex?: number,
): BoardPayload {
  let task: BoardTask | undefined;
  const stripped: BoardColumnPayload[] = payload.columns.map((c) => {
    const idx = c.tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) return c;
    task = { ...c.tasks[idx]!, status_id: toStatusId };
    return { ...c, tasks: c.tasks.filter((t) => t.id !== taskId) };
  });
  if (!task) return payload;
  return {
    ...payload,
    columns: stripped.map((c) => {
      if (c.status_id !== toStatusId) return c;
      const tasks = [...c.tasks];
      tasks.splice(atIndex ?? tasks.length, 0, task!);
      return { ...c, tasks };
    }),
  };
}

function updateVersion(payload: BoardPayload, taskId: string, version: number): BoardPayload {
  return {
    ...payload,
    columns: payload.columns.map((c) => ({
      ...c,
      tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, version } : t)),
    })),
  };
}
