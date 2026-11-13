/**
 * Detail task + riwayat (ENT-15). Fokus: urutan `seq`, `category_*` ikut
 * terbawa, dan riwayat panjang tidak dikirim seluruhnya.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { loadTaskDetail } from "@kelindan/db";
import { applyTaskPatch } from "@kelindan/db";
import { uuidv7, TEAM_ROLE, type Actor } from "@kelindan/shared";
import { createTestClient, applyMigrations, type ClientLike } from "@kelindan/testing";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const WS = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const ST1 = "0190f000-0000-7000-8000-0000000000d1";
const ST3 = "0190f000-0000-7000-8000-0000000000d3";
const TASK = "0190f000-0000-7000-8000-0000000000e1";

let client: ClientLike;
const db = () => client as unknown as Client;
const actor: Actor = { userId: USER, workspaceId: WS, teamRole: TEAM_ROLE.MEMBER };

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);
  await client.query(`INSERT INTO workspaces (id,name,slug,seq_next) VALUES ($1,'Ruang','ruang-kerja',1)`, [WS]);
  await client.query(`INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','Ani')`, [USER]);
  await client.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG')`, [TEAM, WS]);
  await client.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
     VALUES ($1,$3,$4,'Antrean',1,0,true),($2,$3,$4,'Dikerjakan',3,1,false)`,
    [ST1, ST3, WS, TEAM]);
  await client.query(
    `INSERT INTO tasks (id,workspace_id,team_id,number,title,description,status_id,created_by)
     VALUES ($1,$2,$3,7,'Judul',$4,$5,$6)`,
    [TASK, WS, TEAM, "deskripsi penuh", ST1, USER]);
});

describe("loadTaskDetail", () => {
  it("mengembalikan bentuk PENUH termasuk description", async () => {
    const d = await loadTaskDetail(db(), { workspaceId: WS }, TASK);
    expect(d).not.toBeNull();
    expect(d!.description).toBe("deskripsi penuh");
    expect(d!.number).toBe(7);
    expect(d!.category).toBe(1);
    expect(d!.events).toEqual([]);
  });

  it("task tenant lain -> null (bukan error) supaya handler bisa 404", async () => {
    expect(await loadTaskDetail(db(), { workspaceId: uuidv7() }, TASK)).toBeNull();
  });

  it("riwayat terurut seq menaik dan membawa category_from/to", async () => {
    await applyTaskPatch(db(), {
      actor, taskId: TASK, patch: { status_id: ST3 },
      operationId: uuidv7(), endpoint: "test", traceId: uuidv7(),
    });
    await applyTaskPatch(db(), {
      actor, taskId: TASK, patch: { title: "Judul baru" },
      operationId: uuidv7(), endpoint: "test", traceId: uuidv7(),
    });

    const d = await loadTaskDetail(db(), { workspaceId: WS }, TASK);
    expect(d!.events.length).toBe(2);
    const seqs = d!.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    const statusEvent = d!.events.find((e) => e.category_to !== null)!;
    expect(statusEvent.kind).toBe(1); // 1 = status
    expect(statusEvent.category_from).toBe(1);
    expect(statusEvent.category_to).toBe(3);
    expect(statusEvent.actor).toEqual({ id: USER, display_name: "Ani" });
  });

  it("event sistem (actor null) tetap tampil sebagai sistem", async () => {
    const { seqNext } = { seqNext: 1 };
    await client.query(
      `INSERT INTO task_events (id,workspace_id,team_id,task_id,seq,actor_id,source,kind,to_value)
       VALUES ($1,$2,$3,$4,(SELECT seq_next FROM workspaces WHERE id=$2),NULL,2,9,$5)`,
      [uuidv7(), WS, TEAM, TASK, JSON.stringify({ by: "impor" })]);
    await client.query(`UPDATE workspaces SET seq_next = seq_next + 1 WHERE id = $1`, [WS]);
    const d = await loadTaskDetail(db(), { workspaceId: WS }, TASK);
    const sys = d!.events.find((e) => e.source === 2)!;
    expect(sys.actor).toBeNull();
    expect(sys.to_value).toEqual({ by: "impor" });
    expect(seqNext).toBe(1);
  });

  it("riwayat panjang dipotong, ditandai jujur, dan tetap yang TERBARU", async () => {
    for (let i = 0; i < 8; i++) {
      await client.query(
        `INSERT INTO task_events (id,workspace_id,team_id,task_id,seq,actor_id,source,kind)
         VALUES ($1,$2,$3,$4,(SELECT seq_next FROM workspaces WHERE id=$2),$5,1,4)`,
        [uuidv7(), WS, TEAM, TASK, USER]);
      await client.query(`UPDATE workspaces SET seq_next = seq_next + 1 WHERE id = $1`, [WS]);
    }
    const d = await loadTaskDetail(db(), { workspaceId: WS }, TASK, 5);
    expect(d!.events.length).toBe(5);
    expect(d!.events_truncated).toBe(true);
    const all = await client.query<{ max: string }>(
      `SELECT MAX(seq)::text AS max FROM task_events WHERE task_id = $1`, [TASK]);
    expect(d!.events[d!.events.length - 1]!.seq).toBe(Number(all.rows[0]!.max));
  });

  it("label & checklist ikut, checklist terurut position", async () => {
    const l = uuidv7();
    await client.query(
      `INSERT INTO labels (id,workspace_id,team_id,name,color) VALUES ($1,$2,$3,'urgent','#ff0000')`,
      [l, WS, TEAM]);
    await client.query(`INSERT INTO task_labels (workspace_id,task_id,label_id) VALUES ($1,$2,$3)`, [WS, TASK, l]);
    for (const [pos, done] of [[2, false], [0, true]] as const) {
      await client.query(
        `INSERT INTO checklist_items (id,workspace_id,task_id,content,is_done,position)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [uuidv7(), WS, TASK, `item${pos}`, done, pos]);
    }
    const d = await loadTaskDetail(db(), { workspaceId: WS }, TASK);
    expect(d!.labels[0]!.name).toBe("urgent");
    expect(d!.checklist.map((c) => c.position)).toEqual([0, 2]);
  });
});
