/**
 * P4-02/P4-05: render board dari payload P2-01. Uji ini menguji STRING yang
 * dihasilkan, bukan DOM — cukup untuk membuktikan kolom, escaping, dan
 * penolakan menimpa pada konflik.
 */
import { describe, expect, it } from "vitest";
import { boardHtml, esc } from "./board.js";
import { initialState } from "../lib/store.js";
import type { BoardPayload } from "../lib/api.js";
import type { BoardState } from "../lib/store.js";

const payload: BoardPayload = {
  team_id: "team",
  query_count: 4,
  columns: [
    { status_id: "s1", name: "Antrean", category: 1, position: 0, truncated: true, tasks: [
      { id: "t1", number: 12, title: `<script>alert(1)</script>`, status_id: "s1", category: 1,
        priority: 2, assignee_id: null, due_date: "2026-11-20", effort: 3, version: 4,
        updated_at: "2026-11-12T00:00:00Z", labels: [], checklist_progress: { done: 2, total: 5 } },
    ] },
    { status_id: "s2", name: "Selesai", category: 4, position: 1, truncated: false, tasks: [] },
  ],
};

const state = (over: Partial<BoardState> = {}): BoardState => ({
  ...initialState(), loading: false, payload, ...over,
});

describe("boardHtml", () => {
  it("merender satu <section> per kolom, termasuk kolom kosong", () => {
    const html = boardHtml(state());
    expect(html.match(/class="column"/g)?.length).toBe(2);
    expect(html).toContain("Selesai");
  });

  it("judul task DI-ESCAPE (judul adalah input pengguna)", () => {
    const html = boardHtml(state());
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("kolom terpotong menampilkan tombol 'lihat semua'", () => {
    const html = boardHtml(state());
    expect(html).toContain("Lihat semua");
  });

  it("progres checklist & prioritas tampil dari data, bukan hardcode", () => {
    const html = boardHtml(state());
    expect(html).toContain("2/5");
    expect(html).toContain("#12");
  });

  it("konflik menampilkan DUA nilai dan tidak menimpa apa pun", () => {
    const html = boardHtml(state({
      notice: "conflict",
      conflict: { taskId: "t1", mine: 4, theirs: 9, current: { version: 9 }, traceId: "tr" },
    }));
    expect(html).toContain("Pertahankan versi saya");
    expect(html).toContain("Pakai versi server");
    expect(html).toContain("9");
  });

  it("memuat -> status, galat -> trace_id terlihat", () => {
    expect(boardHtml(state({ loading: true, payload: null }))).toContain("Memuat papan");
    const err = boardHtml(state({
      payload: null, error: { message: "server.error", traceId: "01ab" },
    }));
    expect(err).toContain("01ab");
  });

  it("esc menangani semua lima karakter berbahaya", () => {
    expect(esc(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});
