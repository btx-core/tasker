/**
 * P4-03 & P4-05: optimisme yang AMAN dan konflik yang TIDAK ditimpa.
 */
import { describe, expect, it } from "vitest";
import { BoardStore } from "./store.js";
import type { HttpClient, BoardPayload } from "./api.js";

const T1 = "t1", T2 = "t2", S1 = "s1", S2 = "s2";

function payload(): BoardPayload {
  return {
    team_id: "team",
    query_count: 4,
    columns: [
      { status_id: S1, name: "Antrean", category: 1, position: 0, truncated: false, tasks: [
        { id: T1, number: 1, title: "A", status_id: S1, category: 1, priority: 0, assignee_id: null,
          due_date: null, effort: null, version: 1, updated_at: "2026-11-12T00:00:00Z", labels: [],
          checklist_progress: { done: 0, total: 0 } },
        { id: T2, number: 2, title: "B", status_id: S1, category: 1, priority: 0, assignee_id: null,
          due_date: null, effort: null, version: 1, updated_at: "2026-11-12T00:00:00Z", labels: [],
          checklist_progress: { done: 0, total: 0 } },
      ] },
      { status_id: S2, name: "Selesai", category: 4, position: 1, truncated: false, tasks: [] },
    ],
  };
}

type Result = Awaited<ReturnType<HttpClient["patchTask"]>>;

function storeWith(result: Result) {
  const api = {
    async patchTask() { return result; },
    async board() { return { ok: true, status: 200, data: payload(), error: null } as never; },
  } as unknown as HttpClient;
  const s = new BoardStore({ api, teamId: "team", onChange: () => {} });
  s.state = { ...s.state, loading: false, payload: payload() };
  return s;
}

const columnsOf = (s: BoardStore) => s.state.payload!.columns.map((c) => ({ id: c.status_id, ids: c.tasks.map((t) => t.id) }));

describe("moveTask", () => {
  it("berhasil: kartu pindah dan versi mengikuti server", async () => {
    const s = storeWith({ ok: true, status: 200, data: { task: { version: 7 }, seq: 3, replayed: false }, error: null });
    await s.moveTask(T1, S2);
    expect(columnsOf(s)).toEqual([{ id: S1, ids: [T2] }, { id: S2, ids: [T1] }]);
    const moved = s.state.payload!.columns[1]!.tasks[0]!;
    expect(moved.version).toBe(7);
    expect(moved.status_id).toBe(S2);
  });

  it("gagal: kartu KEMBALI ke posisi & urutan semula, plus pesan", async () => {
    const s = storeWith({
      ok: false, status: 403, data: null,
      error: { code: "auth.forbidden", message: "tidak boleh", trace_id: "tr-403", retryable: false },
    });
    // T1 berada di indeks 0; setelah rollback harus kembali ke indeks 0.
    await s.moveTask(T1, S2);
    expect(columnsOf(s)).toEqual([{ id: S1, ids: [T1, T2] }, { id: S2, ids: [] }]);
    expect(s.state.notice).toBe("auth.forbidden");
    expect(s.state.error?.traceId).toBe("tr-403");
  });

  it("409 konflik: kartu kembali DAN state kanonik disimpan untuk dipilih", async () => {
    const s = storeWith({
      ok: false, status: 409, data: null,
      error: {
        code: "conflict.version", message: "basi", trace_id: "tr-409", retryable: false,
        current: { id: T1, version: 12, status_id: S2, title: "diubah orang lain" },
      },
    });
    await s.moveTask(T1, S2);
    expect(columnsOf(s)[0]!.ids).toEqual([T1, T2]);
    expect(s.state.conflict).toMatchObject({ taskId: T1, mine: 1, theirs: 12 });
    expect(s.state.conflict?.current["title"]).toBe("diubah orang lain");
  });

  it("target sama dengan asal: tidak ada request sama sekali", async () => {
    let calls = 0;
    const api = {
      async patchTask() { calls++; return { ok: true, status: 200, data: null, error: null }; },
      async board() { return { ok: true, status: 200, data: payload(), error: null }; },
    } as unknown as HttpClient;
    const s = new BoardStore({ api, teamId: "team", onChange: () => {} });
    s.state = { ...s.state, payload: payload() };
    await s.moveTask(T1, S1);
    expect(calls).toBe(0);
  });
});

describe("applyDelta (P4-04)", () => {
  it("delta versi lebih tinggi diterapkan", () => {
    const s = storeWith({ ok: true, status: 200, data: null, error: null });
    const changed = s.applyDelta({ id: T1, version: 5, patch: { title: "baru" } });
    expect(changed).toBe(true);
    expect(s.state.payload!.columns[0]!.tasks[0]!.title).toBe("baru");
    expect(s.state.payload!.columns[0]!.tasks[0]!.version).toBe(5);
  });

  it("delta versi SAMA atau lebih tua DIABAIKAN (at-least-once)", () => {
    const s = storeWith({ ok: true, status: 200, data: null, error: null });
    expect(s.applyDelta({ id: T1, version: 1, patch: { title: "duplikat" } })).toBe(false);
    expect(s.state.payload!.columns[0]!.tasks[0]!.title).toBe("A");
  });

  it("delta yang mengubah status memindahkan kartu antar kolom", () => {
    const s = storeWith({ ok: true, status: 200, data: null, error: null });
    s.applyDelta({ id: T1, version: 9, patch: { status_id: S2 } });
    expect(columnsOf(s)).toEqual([{ id: S1, ids: [T2] }, { id: S2, ids: [T1] }]);
  });
});
