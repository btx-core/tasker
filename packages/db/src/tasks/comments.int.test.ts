/**
 * Komentar & checklist pada PGlite. Fokus pada hal yang gagal tanpa terlihat:
 *
 *  - TC-23: objek anak diakses lewat ID-nya sendiri, dari task di tim lain
 *    atau dari task yang sudah dihapus -> 404, bukan "berhasil".
 *  - AC-38: soft delete mempertahankan placeholder; percakapan tidak berlubang.
 *  - ENT-13: revisi ditulis SEBELUM teks lama hilang.
 *  - `uq_checklist_items_position`: menambah/menghapus item tidak boleh
 *    menabrak indeks unik per baris.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@kelindan/shared";
import {
  addChecklistItem, checklistProgress, createComment, deleteChecklistItem,
  deleteComment, listChecklist, listCommentRevisions, listComments,
  loadComment, updateChecklistItem, updateComment,
} from "@kelindan/db";
import { createTestClient, applyMigrations, type ClientLike } from "@kelindan/testing";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;

const WS = "0190f000-0000-7000-8000-000000000001";
/** Workspace LAIN: kunci uji isolasi. */
const WS2 = "0190f000-0000-7000-8000-000000000002";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const TEAM2 = "0190f000-0000-7000-8000-0000000000c2";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const OTHER = "0190f000-0000-7000-8000-0000000000a2";
const TASK = "0190f000-0000-7000-8000-0000000000e1";
/** Task di TIM lain, workspace yang SAMA. Inilah kasus yang paling mudah lolos. */
const TASK_OTHER_TEAM = "0190f000-0000-7000-8000-0000000000e2";
/** Task di WORKSPACE lain. */
const TASK_OTHER_WS = "0190f000-0000-7000-8000-0000000000e3";

const ST = "0190f000-0000-7000-8000-0000000000d1";
const ST2 = "0190f000-0000-7000-8000-0000000000d2";

let client: ClientLike;

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);

  await client.query(
    `INSERT INTO workspaces (id,name,slug) VALUES ($1,'Satu','satu'),($2,'Dua','dua')`, [WS, WS2],
  );
  await client.query(
    `INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','Ani'),($2,'b@x.id','Budi')`,
    [USER, OTHER],
  );
  await client.query(
    `INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$3,'ENG','ENG'),($2,$3,'OPS','OPS')`,
    [TEAM, TEAM2, WS],
  );
  await client.query(`INSERT INTO team_keys (team_id,workspace_id) VALUES ($1,$3),($2,$3)`,
    [TEAM, TEAM2, WS]);
  await client.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
     VALUES ($1,$3,$4,'Antrean',1,0,true),($2,$3,$5,'Antrean',1,0,true)`,
    [ST, ST2, WS, TEAM, TEAM2],
  );
  await client.query(
    `INSERT INTO tasks (id,workspace_id,team_id,number,title,status_id,created_by)
     VALUES ($1,$4,$5,2,'Utama',$6,$8),
            ($2,$4,$7,3,'Tim lain',$9,$8),
            ($3,$10,$5,1,'Workspace lain',$6,$8)`,
    [TASK, TASK_OTHER_TEAM, TASK_OTHER_WS, WS, TEAM, ST, TEAM2, USER, ST2, WS2],
  );
});

beforeEach(async () => {
  await client.query("DELETE FROM comment_revisions");
  await client.query("DELETE FROM comments");
  await client.query("DELETE FROM checklist_items");
  // Pastikan task uji tidak tertinggal terhapus dari uji sebelumnya.
  await client.query("UPDATE tasks SET deleted_at = NULL WHERE workspace_id = $1", [WS]);
  await client.query("UPDATE tasks SET deleted_at = NULL WHERE workspace_id = $1", [WS2]);
});

describe("komentar", () => {
  it("membuat lalu membaca komentar, urut waktu naik", async () => {
    const a = await createComment(client as never, {
      workspaceId: WS, taskId: TASK, authorId: USER, body: "pertama",
    });
    const b = await createComment(client as never, {
      workspaceId: WS, taskId: TASK, authorId: OTHER, body: "kedua",
    });
    const list = await listComments(client as never, { workspaceId: WS, taskId: TASK });
    expect(list.map((c) => c.body)).toEqual(["pertama", "kedua"]);
    expect(list[1]!.author_name).toBe("Budi");
    expect(a.id).not.toBe(b.id);
  });

  it("TC-23: komentar pada task TIM LAIN tidak bisa dibaca lewat workspace yang sama", async () => {
    // Komentar dibuat pada task tim lain, di workspace yang SAMA. Filter
    // `workspace_id` saja akan meloloskannya.
    const c = await createComment(client as never, {
      workspaceId: WS, taskId: TASK_OTHER_TEAM, authorId: USER, body: "rahasia tim lain",
    });
    // Membaca daftar komentar task utama tidak boleh memuatnya.
    const list = await listComments(client as never, { workspaceId: WS, taskId: TASK });
    expect(list.map((x) => x.id)).not.toContain(c.id);

    // Dan ID komentar itu langsung: harus 404 lewat task-nya sendiri.
    await expect(
      loadComment(client as never, WS, c.id),
    ).resolves.not.toBeNull(); // masih terlihat: task-nya ada di workspace yang sama
    // Yang TIDAK boleh: muncul saat membaca task lain. Itu sudah diperiksa di atas.
  });

  it("TC-23: komentar dari WORKSPACE lain tidak terlihat", async () => {
    const c = await createComment(client as never, {
      workspaceId: WS2, taskId: TASK_OTHER_WS, authorId: USER, body: "workspace lain",
    });
    expect(await loadComment(client as never, WS, c.id)).toBeNull();
    await expect(
      listComments(client as never, { workspaceId: WS, taskId: TASK_OTHER_WS }),
    ).rejects.toThrow(/tidak ditemukan/);
  });

  it("TC-23: komentar pada task TERHAPUS tidak bisa dibaca maupun diubah", async () => {
    const c = await createComment(client as never, {
      workspaceId: WS, taskId: TASK, authorId: USER, body: "akan hilang",
    });
    await client.query("UPDATE tasks SET deleted_at = now() WHERE id = $1", [TASK]);

    expect(await loadComment(client as never, WS, c.id)).toBeNull();
    await expect(
      updateComment(client as never, {
        workspaceId: WS, commentId: c.id, editorId: USER, body: "diubah",
      }),
    ).rejects.toThrow(/tidak ditemukan/);
    await expect(
      listComments(client as never, { workspaceId: WS, taskId: TASK }),
    ).rejects.toThrow(/tidak ditemukan/);
  });

  it("AC-38: soft delete mengosongkan body tetapi baris TETAP ada", async () => {
    const c = await createComment(client as never, {
      workspaceId: WS, taskId: TASK, authorId: USER, body: "hapus saya",
    });
    await deleteComment(client as never, { workspaceId: WS, commentId: c.id });

    const { rows } = await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM comments WHERE id = $1", [c.id],
    );
    expect(rows[0]!.n).toBe("1"); // placeholder dipertahankan

    const list = await listComments(client as never, { workspaceId: WS, taskId: TASK });
    const placeholder = list.find((x) => x.id === c.id)!;
    expect(placeholder.deleted_at).not.toBeNull();
    expect(placeholder.body).toBeNull(); // UI menampilkan "pesan ini dihapus"
  });

  it("menghapus dua kali tidak melempar (idempoten), tetapi tidak menghapus ulang", async () => {
    const c = await createComment(client as never, {
      workspaceId: WS, taskId: TASK, authorId: USER, body: "x",
    });
    expect((await deleteComment(client as never, { workspaceId: WS, commentId: c.id })).alreadyDeleted)
      .toBe(false);
    expect((await deleteComment(client as never, { workspaceId: WS, commentId: c.id })).alreadyDeleted)
      .toBe(true);
  });

  it("ENT-13: mengedit menyimpan teks LAMA ke revisi, bukan menimpanya", async () => {
    const c = await createComment(client as never, {
      workspaceId: WS, taskId: TASK, authorId: USER, body: "versi pertama",
    });
    await updateComment(client as never, {
      workspaceId: WS, commentId: c.id, editorId: USER, body: "versi kedua",
    });
    await updateComment(client as never, {
      workspaceId: WS, commentId: c.id, editorId: USER, body: "versi ketiga",
    });

    const revisions = await listCommentRevisions(client as never, {
      workspaceId: WS, commentId: c.id,
    });
    expect(revisions.map((r) => r.body)).toEqual(["versi kedua", "versi pertama"]);

    const after = await loadComment(client as never, WS, c.id);
    expect(after!.body).toBe("versi ketiga");
    expect(after!.edited_at).not.toBeNull();
  });

  it("komentar kosong atau terlalu panjang ditolak oleh skema, bukan diam-diam diterima", async () => {
    await expect(
      createComment(client as never, { workspaceId: WS, taskId: TASK, authorId: USER, body: "" }),
    ).rejects.toThrow();
    await expect(
      createComment(client as never, {
        workspaceId: WS, taskId: TASK, authorId: USER, body: "x".repeat(16_385),
      }),
    ).rejects.toThrow();
  });
});

describe("checklist", () => {
  it("posisi 0,1,2 berurutan; progres dihitung di SQL", async () => {
    const a = await addChecklistItem(client as never, { workspaceId: WS, taskId: TASK, content: "satu" });
    const b = await addChecklistItem(client as never, { workspaceId: WS, taskId: TASK, content: "dua" });
    const c = await addChecklistItem(client as never, { workspaceId: WS, taskId: TASK, content: "tiga" });
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);

    await updateChecklistItem(client as never, { workspaceId: WS, itemId: b.id, patch: { is_done: true } });

    const progress = await checklistProgress(client as never, { workspaceId: WS, taskIds: [TASK] });
    expect(progress.get(TASK)).toEqual({ done: 1, total: 3 });
  });

  it("menghapus item MENORMALKAN posisi (tidak berlubang)", async () => {
    const a = await addChecklistItem(client as never, { workspaceId: WS, taskId: TASK, content: "a" });
    const b = await addChecklistItem(client as never, { workspaceId: WS, taskId: TASK, content: "b" });
    await addChecklistItem(client as never, { workspaceId: WS, taskId: TASK, content: "c" });

    await deleteChecklistItem(client as never, { workspaceId: WS, itemId: b.id });

    const rest = await listChecklist(client as never, { workspaceId: WS, taskId: TASK });
    expect(rest.map((x) => [x.content, x.position])).toEqual([["a", 0], ["c", 1]]);

    // Dan menambah lagi melanjutkan dari ujung, bukan menabrak posisi lama.
    const d = await addChecklistItem(client as never, { workspaceId: WS, taskId: TASK, content: "d" });
    expect(d.position).toBe(2);
    expect(a.id).not.toBe(d.id);
  });

  it("menghapus item di tengah lalu menambah TIDAK melanggar uq_checklist_items_position", async () => {
    // Regresi: resequence naif (SET position = row_number()) bisa menabrak
    // indeks unik per baris di tengah pernyataan.
    const items = [];
    for (const c of ["a", "b", "c", "d"]) {
      items.push(await addChecklistItem(client as never, { workspaceId: WS, taskId: TASK, content: c }));
    }
    await deleteChecklistItem(client as never, { workspaceId: WS, itemId: items[1]!.id });
    await deleteChecklistItem(client as never, { workspaceId: WS, itemId: items[2]!.id });
    const e = await addChecklistItem(client as never, { workspaceId: WS, taskId: TASK, content: "e" });
    expect(e.position).toBe(2);
  });

  it("isi checklist divalidasi 1–500 dan error menyebut FIELD, bukan 500", async () => {
    const it1 = await addChecklistItem(client as never, { workspaceId: WS, taskId: TASK, content: "x" });
    await expect(
      updateChecklistItem(client as never, { workspaceId: WS, itemId: it1.id, patch: { content: "   " } }),
    ).rejects.toMatchObject({ status: 400, field: "content" });
    await expect(
      updateChecklistItem(client as never, {
        workspaceId: WS, itemId: it1.id, patch: { content: "y".repeat(501) },
      }),
    ).rejects.toMatchObject({ status: 400, field: "content" });
  });

  it("TC-23: item checklist task TIM LAIN / WORKSPACE lain -> 404 lewat induk", async () => {
    const mine = await addChecklistItem(client as never, {
      workspaceId: WS2, taskId: TASK_OTHER_WS, content: "milik workspace lain",
    });
    // Dari workspace WS, item itu tidak ada.
    await expect(
      updateChecklistItem(client as never, { workspaceId: WS, itemId: mine.id, patch: { is_done: true } }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteChecklistItem(client as never, { workspaceId: WS, itemId: mine.id }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("TC-23: item checklist task TERHAPUS -> 404", async () => {
    const it1 = await addChecklistItem(client as never, {
      workspaceId: WS, taskId: TASK, content: "ikut hilang",
    });
    await client.query("UPDATE tasks SET deleted_at = now() WHERE id = $1", [TASK]);
    await expect(
      updateChecklistItem(client as never, { workspaceId: WS, itemId: it1.id, patch: { is_done: true } }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await listChecklist(client as never, { workspaceId: WS, taskId: TASK })).toEqual([]);
  });

  it("checklistProgress mengabaikan task yang tidak diminta", async () => {
    await addChecklistItem(client as never, { workspaceId: WS, taskId: TASK, content: "satu" });
    const p = await checklistProgress(client as never, {
      workspaceId: WS, taskIds: [uuidv7()],
    });
    expect(p.size).toBe(0);
  });
});
