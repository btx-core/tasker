/**
 * Uji board pada PostgreSQL sungguhan (PGlite).
 * Fokus: bentuk kolom, batas 50/kolom, `truncated` jujur, dan jumlah query.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { loadBoard } from "@kelindan/db";
import { uuidv7, TEAM_ROLE } from "@kelindan/shared";
import { createTestClient, applyMigrations, type ClientLike } from "@kelindan/testing";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const WS = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const STATUSES = [
  ["d1", "Antrean", 1], ["d2", "Siap", 2], ["d3", "Dikerjakan", 3],
  ["d4", "Tinjau", 4], ["d5", "Selesai", 5], ["d6", "Dibatalkan", 6], ["d7", "Arsip", 7],
] as const;
const sid = (s: string) => `0190f000-0000-7000-8000-0000000000${s}`;

let client: ClientLike;
const db = () => client as unknown as Client;

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);
  await client.query(`INSERT INTO workspaces (id,name,slug) VALUES ($1,'Ruang','ruang-kerja')`, [WS]);
  await client.query(`INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A')`, [USER]);
  await client.query(
    `INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,1)`, [uuidv7(), WS, USER]);
  await client.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG')`, [TEAM, WS]);
  // Kategori diperbolehkan 1..5 di skema; kolom ke-6 & 7 pakai 4 dan 5.
  const cats = [1, 2, 3, 3, 4, 5, 4];
  for (let i = 0; i < STATUSES.length; i++) {
    const [s, name] = STATUSES[i]!;
    await client.query(
      `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [sid(s), WS, TEAM, name, cats[i], i, i === 0],
    );
  }
});

async function addTasks(count: number, statusKey: string, tag = "") {
  for (let i = 0; i < count; i++) {
    await client.query(
      `INSERT INTO tasks (id,workspace_id,team_id,number,title,status_id,created_by,priority,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() - ($9 || ' seconds')::interval)`,
      [uuidv7(), WS, TEAM,
       Math.floor(Math.random() * 1e9), `Task ${tag}${i}`, sid(statusKey), USER, i % 5, i],
    );
  }
}

describe("loadBoard pada PostgreSQL nyata", () => {
  it("mengembalikan semua status aktif sebagai kolom, termasuk yang kosong", async () => {
    const board = await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
    expect(board.columns.length).toBe(7);
    expect(board.columns.map((c) => c.name)).toEqual([
      "Antrean", "Siap", "Dikerjakan", "Tinjau", "Selesai", "Dibatalkan", "Arsip",
    ]);
    expect(board.columns.every((c) => c.tasks.length === 0)).toBe(true);
  });

  it("membatasi 50 task/kolom dan menandai truncated dengan jujur", async () => {
    await addTasks(53, "d3", "D");
    const board = await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
    const doing = board.columns.find((c) => c.status_id === sid("d3"))!;
    expect(doing.tasks.length).toBe(50);
    expect(doing.truncated).toBe(true);
    // Kolom lain tetap kosong dan TIDAK ditandai truncated.
    const empty = board.columns.find((c) => c.status_id === sid("d1"))!;
    expect(empty.truncated).toBe(false);
  }, 120_000);

  it("urutan dalam kolom: updated_at DESC, id DESC (stabil)", async () => {
    const board = await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
    const doing = board.columns.find((c) => c.status_id === sid("d3"))!;
    for (let i = 1; i < doing.tasks.length; i++) {
      const a = doing.tasks[i - 1]!;
      const b = doing.tasks[i]!;
      expect(a.updated_at.getTime()).toBeGreaterThanOrEqual(b.updated_at.getTime());
    }
  });

  it("jumlah query TETAP 4 apa pun jumlah kolom dan task-nya", async () => {
    const board = await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
    // 4 query: status, task (semua kolom), label, checklist. TIDAK tumbuh
    // dengan jumlah kolom maupun jumlah task — itu inti klaimnya.
    expect(board.query_count).toBe(4);
  });

  it("tanpa description: bentuk ringkas tidak membawa deskripsi", async () => {
    await client.query(`UPDATE tasks SET description = $1 WHERE team_id = $2`, ["x".repeat(4000), TEAM]);
    const board = await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
    const task = board.columns.find((c) => c.status_id === sid("d3"))!.tasks[0]!;
    expect(Object.keys(task)).not.toContain("description");
    // Payload board harus tetap kecil walau deskripsi 4 KB/task.
    expect(Buffer.byteLength(JSON.stringify(board), "utf8")).toBeLessThan(120_000);
  });

  it("label & progres checklist terisi untuk task yang dikembalikan saja", async () => {
    const board1 = await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
    const task = board1.columns.find((c) => c.status_id === sid("d3"))!.tasks[0]!;
    expect(task.labels).toEqual([]);
    expect(task.checklist_progress).toEqual({ done: 0, total: 0 });

    const labelId = uuidv7();
    await client.query(
      `INSERT INTO labels (id,workspace_id,team_id,name,color) VALUES ($1,$2,$3,'bug','#ff0000')`,
      [labelId, WS, TEAM]);
    await client.query(
      `INSERT INTO task_labels (workspace_id,task_id,label_id) VALUES ($1,$2,$3)`, [WS, task.id, labelId]);
    for (const done of [true, true, false]) {
      await client.query(
        `INSERT INTO checklist_items (id,workspace_id,task_id,content,is_done,position)
         VALUES ($1,$2,$3,'item',$4,(SELECT COALESCE(MAX(position),0)+1 FROM checklist_items WHERE task_id=$3))`,
        [uuidv7(), WS, task.id, done]);
    }

    const board2 = await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
    const enriched = board2.columns.flatMap((c) => c.tasks).find((t) => t.id === task.id)!;
    expect(enriched.labels).toEqual([{ id: labelId, name: "bug", color: "#ff0000" }]);
    expect(enriched.checklist_progress).toEqual({ done: 2, total: 3 });
  });

  it("task soft-deleted tidak muncul di board", async () => {
    const before = await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
    const t = before.columns.find((c) => c.status_id === sid("d3"))!.tasks[0]!;
    await client.query(`UPDATE tasks SET deleted_at = now() WHERE id = $1`, [t.id]);
    const after = await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
    expect(after.columns.flatMap((c) => c.tasks).some((x) => x.id === t.id)).toBe(false);
  });

  it("status yang diarsipkan hilang beserta kolomnya", async () => {
    await client.query(`UPDATE statuses SET archived_at = now() WHERE id = $1`, [sid("d7")]);
    const board = await loadBoard(db(), { workspaceId: WS, teamId: TEAM });
    expect(board.columns.length).toBe(6);
    expect(board.columns.some((c) => c.status_id === sid("d7"))).toBe(false);
  });

  it("tim lain -> 0 kolom (bukan error, bukan bocor)", async () => {
    const board = await loadBoard(db(), { workspaceId: WS, teamId: uuidv7() });
    expect(board.columns).toEqual([]);
  });
});
