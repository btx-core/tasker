/**
 * Validasi transisi status — `api-contract.md` §7.4 dan `INV-07`.
 *
 * Kontrak mewajibkan EMPAT hal ketika `status_id` berubah. Berkas ini ditulis
 * untuk membuktikan bahwa ketiganya belum ada: awalnya seluruh uji di sini
 * GAGAL, dan itu memang tujuannya.
 *
 *  1. `status_id` harus milik tim yang sama (INV-08) — ditegakkan trigger DB,
 *     jadi ini menguji bahwa kegagalannya muncul sebagai 400/409 yang bisa
 *     dipahami klien, BUKAN 500 dari pelanggaran constraint.
 *  2. Status harus aktif (tidak `archived_at`).
 *  3. Masuk kategori Selesai -> `completed_at` diisi (first-touch, INV-07).
 *  4. Masuk kategori Dikerjakan/Dibatalkan -> `started_at`/`canceled_at`.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7, TEAM_ROLE, type Actor } from "@kelindan/shared";
import { applyTaskPatch } from "@kelindan/db";
import { createTestClient, applyMigrations, type ClientLike } from "@kelindan/testing";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;

const WS = "0190f000-0000-7000-8000-000000000001";
const TEAM_A = "0190f000-0000-7000-8000-0000000000c1";
const TEAM_B = "0190f000-0000-7000-8000-0000000000c2";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const TASK = "0190f000-0000-7000-8000-0000000000e1";

/** Status tim A: kategori 1=Antrean, 3=Dikerjakan, 4=Selesai, 5=Dibatalkan. */
const A_BACKLOG = "0190f000-0000-7000-8000-0000000000d1";
const A_DOING = "0190f000-0000-7000-8000-0000000000d3";
const A_DONE = "0190f000-0000-7000-8000-0000000000d4";
const A_CANCELED = "0190f000-0000-7000-8000-0000000000d5";
const A_ARCHIVED = "0190f000-0000-7000-8000-0000000000d6";
/** Status milik TIM LAIN. */
const B_DONE = "0190f000-0000-7000-8000-0000000000da";

const actor: Actor = { userId: USER, workspaceId: WS, teamRole: TEAM_ROLE.MEMBER };
let client: ClientLike;

async function patch(statusId: string) {
  return applyTaskPatch(client as never, {
    actor, taskId: TASK, patch: { status_id: statusId } as never,
    operationId: uuidv7(), endpoint: "test", traceId: uuidv7(),
  });
}

async function taskRow() {
  const { rows } = await client.query<{
    status_id: string; completed_at: Date | null; started_at: Date | null;
    canceled_at: Date | null; version: number;
  }>("SELECT status_id, completed_at, started_at, canceled_at, version FROM tasks WHERE id = $1", [TASK]);
  return rows[0]!;
}

beforeEach(async () => {
  if (!client) {
    client = await createTestClient();
    await client.query("CREATE EXTENSION IF NOT EXISTS citext");
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await applyMigrations(client, dir);
    await client.query(`INSERT INTO workspaces (id,name,slug) VALUES ($1,'Ruang','ruang-kerja')`, [WS]);
    await client.query(`INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A')`, [USER]);
    await client.query(
      `INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$3,'ENG','ENG'),($2,$3,'OPS','OPS')`,
      [TEAM_A, TEAM_B, WS],
    );
    await client.query(`INSERT INTO team_keys (team_id,workspace_id) VALUES ($1,$3),($2,$3)`,
      [TEAM_A, TEAM_B, WS]);
  }

  // Status bersih untuk setiap uji: hapus task lama, buat ulang.
  await client.query("DELETE FROM task_events WHERE task_id = $1", [TASK]);
  await client.query("DELETE FROM tasks WHERE id = $1", [TASK]);
  await client.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default,archived_at)
     VALUES ($1,$3,$4,'Antrean',1,0,true,NULL),
            ($2,$3,$4,'Dikerjakan',3,1,false,NULL),
            ('0190f000-0000-7000-8000-0000000000d4',$3,$4,'Selesai',4,2,false,NULL),
            ('0190f000-0000-7000-8000-0000000000d5',$3,$4,'Dibatalkan',5,3,false,NULL)
     ON CONFLICT (id) DO UPDATE SET archived_at = NULL`,
    [A_BACKLOG, A_DOING, WS, TEAM_A],
  );
  await client.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default,archived_at)
     VALUES ($1,$2,$3,'Selesai-TimB',4,9,false,NULL)
     ON CONFLICT (id) DO UPDATE SET archived_at = NULL`,
    [A_ARCHIVED, WS, TEAM_A],
  );
  await client.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default,archived_at)
     VALUES ($1,$2,$3,'Selesai-TimB',4,0,true,NULL)
     ON CONFLICT (id) DO UPDATE SET archived_at = NULL`,
    [B_DONE, WS, TEAM_B],
  );
  await client.query(
    `INSERT INTO tasks (id,workspace_id,team_id,number,title,status_id,created_by)
     VALUES ($1,$2,$3,1,'Awal',$4,$5)`,
    [TASK, WS, TEAM_A, A_BACKLOG, USER],
  );
});

afterAll(async () => {
  // PGlite berjalan di memori proses; tidak ada yang perlu ditutup, tetapi
  // skema tidak boleh bocor ke berkas uji lain yang berbagi proses.
  if (client) await client.query("DROP TABLE IF EXISTS tasks CASCADE").catch(() => undefined);
});

describe("validasi status_id (api-contract.md §7.4)", () => {
  it("status dari TIM LAIN ditolak 400, bukan 500 dari trigger", async () => {
    /**
     * Trigger `trg_tasks_guard_team` sudah mencegah data rusak, jadi TIDAK ADA
     * kebocoran tenant di sini. Masalahnya bentuk kegagalannya: pelanggaran
     * constraint muncul sebagai **500 internal.error** — klien tidak tahu apa
     * yang salah, dan operator disuruh membaca log untuk kesalahan klien.
     */
    const err = await patch(B_DONE).then(() => null).catch((e: unknown) => e as { status: number; code: string });
    expect(err).not.toBeNull();
    expect(err!.status).toBe(400);
  });

  it("status yang sudah DIARSIPKAN ditolak", async () => {
    await client.query("UPDATE statuses SET archived_at = now() WHERE id = $1", [A_ARCHIVED]);
    const err = await patch(A_ARCHIVED).then(() => null).catch((e: unknown) => e as { status: number });
    expect(err).not.toBeNull();
    expect(err!.status).toBe(400);
  });

  it("masuk kategori SELESAI -> completed_at diisi (INV-07)", async () => {
    expect((await taskRow()).completed_at).toBeNull();
    await patch(A_DONE);
    const row = await taskRow();
    expect(row.completed_at).not.toBeNull();
    expect(row.status_id).toBe(A_DONE);
  });

  it("INV-07 first-touch: completed_at TIDAK PERNAH ditimpa", async () => {
    await patch(A_DONE);
    const first = (await taskRow()).completed_at!;
    expect(first).not.toBeNull();

    // Kembali ke Antrean lalu Selesai lagi: timestamp pertama harus bertahan.
    await patch(A_BACKLOG);
    await new Promise((r) => setTimeout(r, 1100));
    await patch(A_DONE);
    const second = (await taskRow()).completed_at!;
    expect(new Date(second).toISOString()).toBe(new Date(first).toISOString());
  });

  it("masuk kategori DIKERJAKAN -> started_at diisi, dan juga first-touch", async () => {
    await patch(A_DOING);
    const row = await taskRow();
    expect(row.started_at).not.toBeNull();
    expect(row.canceled_at).toBeNull();

    const first = row.started_at!;
    await patch(A_BACKLOG);
    await patch(A_DOING);
    expect(new Date((await taskRow()).started_at!).toISOString())
      .toBe(new Date(first).toISOString());
  });

  it("masuk kategori DIBATALKAN -> canceled_at diisi", async () => {
    await patch(A_CANCELED);
    const row = await taskRow();
    expect(row.canceled_at).not.toBeNull();
    // Dibatalkan BUKAN selesai: metrik "throughput" tidak boleh tercemar.
    expect(row.completed_at).toBeNull();
  });

  it("status yang tidak berubah tidak mengisi timestamp apa pun", async () => {
    await patch(A_BACKLOG);
    const row = await taskRow();
    expect(row.completed_at).toBeNull();
    expect(row.started_at).toBeNull();
    expect(row.canceled_at).toBeNull();
  });
});
