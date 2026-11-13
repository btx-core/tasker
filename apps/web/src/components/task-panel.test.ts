/**
 * Uji panel detail. Yang diuji adalah hal yang gagal tanpa terlihat:
 *  - isi pengguna di-ESCAPE (judul, deskripsi, komentar)
 *  - komentar terhapus menampilkan placeholder, bukan ruang kosong
 *  - tombol "Ubah" hanya muncul bila server pasti mengizinkan
 *  - galat satu bagian tidak menghapus bagian lain
 */
import { describe, expect, it } from "vitest";
import { EDIT_WINDOW_MS, canEditLocally, esc, panelHtml, type PanelData } from "./task-panel.js";
import type { CommentPayload } from "../lib/api.js";
import { S } from "../i18n/strings.js";

const ME = "0190f000-0000-7000-8000-0000000000a1";
const OTHER = "0190f000-0000-7000-8000-0000000000a2";
const NOW = new Date("2026-03-01T12:00:00.000Z").getTime();

const comment = (over: Partial<CommentPayload> = {}): CommentPayload => ({
  id: "c1", task_id: "t1", author_id: ME, author_name: "Ani",
  body: "isi komentar", created_at: new Date(NOW - 60_000).toISOString(),
  edited_at: null, deleted_at: null, ...over,
});

const data = (over: Partial<PanelData> = {}): PanelData => ({
  task: {
    id: "t1", number: 7, title: "Judul task", description: "Deskripsi",
    status_id: "s1", category: 1, priority: 0, assignee_id: null,
    due_date: null, effort: null, version: 1,
    created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(),
    completed_at: null, deleted_at: null, labels: [], checklist: [], events: [],
  },
  comments: [],
  checklist: { items: [], progress: { done: 0, total: 0 } },
  ...over,
});

describe("esc", () => {
  it("meng-escape kelima karakter berbahaya", () => {
    expect(esc(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });

  it("tidak merusak teks biasa", () => {
    expect(esc("Perbaiki login SSO — aman 100%")).toBe("Perbaiki login SSO — aman 100%");
  });
});

describe("panelHtml", () => {
  it("judul task DARI PENGGUNA di-escape di kedua tempat", () => {
    const html = panelHtml(
      data({ task: { ...data().task, title: `<img src=x onerror=alert(1)>` } }), ME, NOW,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("deskripsi di-escape; deskripsi kosong menampilkan penanda, bukan ruang kosong", () => {
    const html = panelHtml(data({ task: { ...data().task, description: "<script>x</script>" } }), ME, NOW);
    expect(html).not.toContain("<script>");

    const empty = panelHtml(data({ task: { ...data().task, description: null } }), ME, NOW);
    expect(empty).toContain(S.panelDescriptionEmpty);
  });

  it("komentar terhapus menampilkan PLACEHOLDER, bukan ruang kosong", () => {
    // Server mengirim body = NULL untuk komentar terhapus (T-38). Tanpa kalimat
    // dari UI, pembaca tidak bisa membedakan "dihapus" dari "gagal dimuat".
    const html = panelHtml(
      data({ comments: [comment({ body: null, deleted_at: new Date(NOW).toISOString() })] }),
      ME, NOW,
    );
    expect(html).toContain(S.commentDeleted);
    expect(html).toContain("comment--deleted");
  });

  it("komentar terhapus TIDAK punya tombol Ubah maupun Hapus", () => {
    const html = panelHtml(
      data({ comments: [comment({ body: null, deleted_at: new Date(NOW).toISOString() })] }),
      ME, NOW,
    );
    expect(html).not.toContain("data-comment-edit");
    expect(html).not.toContain("data-comment-delete");
  });

  it("komentar yang diedit menampilkan penanda (diedit)", () => {
    const html = panelHtml(
      data({ comments: [comment({ edited_at: new Date(NOW).toISOString() })] }), ME, NOW,
    );
    expect(html).toContain(S.commentEdited);
  });

  it("progres checklist tampil dari data, bukan hardcode", () => {
    const html = panelHtml(data({
      checklist: {
        items: [
          { id: "i1", content: "a", is_done: true, assignee_id: null, due_date: null, position: 0 },
        ],
        progress: { done: 3, total: 7 },
      },
    }), ME, NOW);
    expect(html).toContain("3/7");
  });

  it("progres tetap tampil walau daftar item gagal dimuat (jangan sembunyikan angka)", () => {
    // Terjadi bila permintaan daftar checklist gagal sementara ringkasan
    // berhasil: menyembunyikan angka membuat pengguna mengira datanya hilang.
    const html = panelHtml(data({
      checklist: { items: [], progress: { done: 2, total: 5 } },
    }), ME, NOW);
    expect(html).toContain("2/5");
    expect(html).toContain(S.checklistEmpty);
  });

  it("item yang sudah selesai ditandai checked DAN bergaya coret", () => {
    const html = panelHtml(data({
      checklist: {
        items: [
          { id: "i1", content: "sudah", is_done: true, assignee_id: null, due_date: null, position: 0 },
          { id: "i2", content: "belum", is_done: false, assignee_id: null, due_date: null, position: 1 },
        ],
        progress: { done: 1, total: 2 },
      },
    }), ME, NOW);
    expect(html).toMatch(/data-item-toggle="i1" checked/);
    expect(html).not.toMatch(/data-item-toggle="i2" checked/);
    expect(html).toContain('class="done">sudah');
  });

  it("formulir komentar & checklist memakai <form> sungguhan", () => {
    const html = panelHtml(data(), ME, NOW);
    expect(html).toContain("data-comment-form");
    expect(html).toContain("data-checklist-form");
    expect(html).toContain('<textarea id="new-comment"');
  });

  it("formulir baru punya <label> (walau tersembunyi) untuk pembaca layar", () => {
    const html = panelHtml(data(), ME, NOW);
    expect(html).toContain('for="new-comment"');
    expect(html).toContain('for="new-item"');
  });
});

describe("canEditLocally", () => {
  it("penulis dalam 15 menit -> boleh", () => {
    expect(canEditLocally(comment(), ME, NOW)).toBe(true);
  });

  it("penulis setelah 15 menit -> tombol disembunyikan", () => {
    const old = comment({ created_at: new Date(NOW - EDIT_WINDOW_MS - 120_000).toISOString() });
    expect(canEditLocally(old, ME, NOW)).toBe(false);
  });

  it("BUKAN penulis -> tidak boleh, sedapapun masih dalam jendela", () => {
    expect(canEditLocally(comment(), OTHER, NOW)).toBe(false);
  });

  it("komentar terhapus -> tidak boleh", () => {
    expect(canEditLocally(comment({ deleted_at: new Date(NOW).toISOString() }), ME, NOW)).toBe(false);
  });

  it("longgar 1 menit agar tombol tidak berkedip hilang tepat di batas", () => {
    // Jam klien bisa lebih cepat dari server; server tetap yang memutuskan.
    const justOver = comment({ created_at: new Date(NOW - EDIT_WINDOW_MS - 30_000).toISOString() });
    expect(canEditLocally(justOver, ME, NOW)).toBe(true);
  });
});
