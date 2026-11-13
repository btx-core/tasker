/**
 * UJI INTEGRASI jalur tulis TaskSession pada PostgreSQL SUNGGUHAN (PGlite/WASM).
 *
 * Ini menjalankan `applyTaskPatch` yang ASLI — bukan salinan SQL. Yang
 * dibuktikan: urutan template ADR-015, constraint skema nyata, dan perlakuan
 * error. Yang TIDAK dibuktikan: konkurensi multi-koneksi & LISTEN/NOTIFY
 * antar-proses (PGlite satu koneksi) — lihat docs/todo.md §10.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { applyTaskPatch } from "@kelindan/db";
import { uuidv7, TEAM_ROLE, type Actor } from "@kelindan/shared";
import { createTestClient, type ClientLike } from "./pglite-adapter.js";
import { applyMigrations } from "./harness.js";

const dir = new URL("../../db/migrations/", import.meta.url).pathname;

const WS = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const USER2 = "0190f000-0000-7000-8000-0000000000a2";
const ST_BACKLOG = "0190f000-0000-7000-8000-0000000000d1";
const ST_DOING = "0190f000-0000-7000-8000-0000000000d3";
const TASK = "0190f000-0000-7000-8000-0000000000e1";

const actor: Actor = { userId: USER, workspaceId: WS, teamRole: TEAM_ROLE.MEMBER };

let client: ClientLike;

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);

  await client.query(`INSERT INTO workspaces (id,name,slug) VALUES ($1,'Ruang Kerja','ruang-kerja')`, [WS]);
  await client.query(
    `INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A'),($2,'b@x.id','B')`,
    [USER, USER2],
  );
  for (const [u, role] of [[USER, 1], [USER2, 1]] as const) {
    await client.query(
      `INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,$4)`,
      [uuidv7(), WS, u, role],
    );
  }
  await client.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG')`, [TEAM, WS]);
  await client.query(`INSERT INTO team_keys (team_id,workspace_id) VALUES ($1,$2)`, [TEAM, WS]);
  await client.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
     VALUES ($1,$3,$4,'Antrean',1,0,true),($2,$3,$4,'Dikerjakan',3,1,false)`,
    [ST_BACKLOG, ST_DOING, WS, TEAM],
  );
  await client.query(
    `INSERT INTO tasks (id,workspace_id,team_id,number,title,description,status_id,created_by,priority)
     VALUES ($1,$2,$3,1,'Judul awal',$4,$5,$6,0)`,
    [TASK, WS, TEAM, "x".repeat(1000), ST_BACKLOG, USER],
  );
});

const patch = (operationId: string, body: Record<string, unknown>, expectedVersion?: number) =>
  applyTaskPatch(client as unknown as Client, {
    actor,
    taskId: TASK,
    patch: body as never,
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    operationId,
    endpoint: "PATCH /v1/tasks/:id",
    traceId: "trace-1",
  });

describe("applyTaskPatch pada PostgreSQL nyata", () => {
  it("T-IDEM: operation_id sama dikirim 2x -> replay, bukan diterapkan ulang", async () => {
    const op = uuidv7();
    const first = await patch(op, { title: "Judul baru" });
    const second = await patch(op, { title: "Judul baru" });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.task.version).toBe(first.task.version);

    const rows = await client.query<{ title: string; version: number }>(
      "SELECT title, version FROM tasks WHERE id = $1",
      [TASK],
    );
    expect(rows.rows[0]!.title).toBe("Judul baru");
    expect(rows.rows[0]!.version).toBe(first.task.version);
  });

  it("T-IDEM: operation_id sama dengan body BERBEDA -> 409", async () => {
    const op = uuidv7();
    await patch(op, { title: "Satu" });
    await expect(patch(op, { title: "Dua" })).rejects.toMatchObject({
      status: 409,
      code: "conflict.idempotency_mismatch",
    });
  });

  it("INV-04: versi naik TEPAT 1 per perubahan bersih", async () => {
    const before = await client.query<{ version: number }>(
      "SELECT version FROM tasks WHERE id = $1",
      [TASK],
    );
    const res = await patch(uuidv7(), { priority: 3 });
    expect(res.task.version).toBe(before.rows[0]!.version + 1);
  });

  it("INV-04: patch tanpa perubahan bersih -> versi TIDAK naik, tanpa delta", async () => {
    const cur = await client.query<{ priority: number; version: number }>(
      "SELECT priority, version FROM tasks WHERE id = $1",
      [TASK],
    );
    const changesBefore = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM changes");

    const res = await patch(uuidv7(), { priority: cur.rows[0]!.priority });

    expect(res.changedFields).toEqual([]);
    expect(res.change).toBeNull();
    expect(res.task.version).toBe(cur.rows[0]!.version);

    const changesAfter = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM changes");
    expect(changesAfter.rows[0]!.n).toBe(changesBefore.rows[0]!.n);
  });

  it("expected_version basi -> 409 dengan state kanonik", async () => {
    await expect(patch(uuidv7(), { title: "Konflik" }, 1)).rejects.toMatchObject({
      status: 409,
      code: "conflict.version",
    });
  });

  it("T-TENANT: workspace lain -> 404, bukan 403 (keberadaan tidak bocor)", async () => {
    await expect(
      applyTaskPatch(client as unknown as Client, {
        actor: { ...actor, workspaceId: "0190f000-0000-7000-8000-0000000000ff" },
        taskId: TASK,
        patch: { title: "curang" },
        operationId: uuidv7(),
        endpoint: "PATCH /v1/tasks/:id",
        traceId: "t",
      }),
    ).rejects.toMatchObject({ status: 404, code: "resource.not_found" });
  });

  it("ADR-017: deskripsi 100 KB -> payload changes <= 4 KB dan TANPA isi deskripsi", async () => {
    const res = await patch(uuidv7(), { description: "d".repeat(102_400) });
    expect(res.change).not.toBeNull();
    const payload = res.change!.payload;
    expect(payload["description"]).toBeUndefined();
    expect(payload["description_changed"]).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(4096);

    const size = await client.query<{ s: number }>(
      "SELECT pg_column_size(payload)::int AS s FROM changes WHERE seq = $1",
      [res.change!.seq],
    );
    expect(size.rows[0]!.s).toBeLessThanOrEqual(4096);
  });

  it("ADR-017: pointer NOTIFY < 64 byte", async () => {
    const res = await patch(uuidv7(), { title: "Cek pointer" });
    const pointer = `${WS}:${res.change!.seq}`;
    expect(Buffer.byteLength(pointer)).toBeLessThan(64);
  });

  it("V3: event status membawa category_from/category_to", async () => {
    const res = await patch(uuidv7(), { status_id: ST_DOING });
    expect(res.change!.payload["status_id"]).toBe(ST_DOING);

    const ev = await client.query<{ category_from: number; category_to: number }>(
      `SELECT category_from, category_to FROM task_events
        WHERE task_id = $1 AND kind = 1 ORDER BY seq DESC LIMIT 1`,
      [TASK],
    );
    expect(ev.rows[0]!.category_from).toBe(1);
    expect(ev.rows[0]!.category_to).toBe(3);
  });

  it("T-W2 (sebagian): LWW menyimpan nilai lama di task_events", async () => {
    const ev = await client.query<{ from_value: unknown }>(
      `SELECT from_value FROM task_events WHERE task_id = $1 AND kind = 4 ORDER BY seq DESC LIMIT 1`,
      [TASK],
    );
    expect(ev.rows[0]!.from_value).toBeTruthy();
  });

  it("seq naik tanpa celah per workspace", async () => {
    const seqs = await client.query<{ seq: number }>("SELECT seq FROM changes ORDER BY seq");
    const list = seqs.rows.map((r) => Number(r.seq));
    for (let i = 1; i < list.length; i++) {
      expect(list[i]! - list[i - 1]!).toBe(1);
    }
  });

  it("authz: viewer DITOLAK (403), bukan diam-diam diabaikan", async () => {
    await expect(
      applyTaskPatch(client as unknown as Client, {
        actor: { ...actor, teamRole: TEAM_ROLE.VIEWER },
        taskId: TASK,
        patch: { title: "viewer coba" },
        operationId: uuidv7(),
        endpoint: "PATCH /v1/tasks/:id",
        traceId: "t",
      }),
    ).rejects.toMatchObject({ status: 403, code: "auth.forbidden" });
  });

  it("constraint skema nyata: status lintas tim tetap ditolak trigger", async () => {
    const TEAM2 = "0190f000-0000-7000-8000-0000000000c2";
    await client.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'DSN','DSN')`, [TEAM2, WS]);
    const st2 = uuidv7();
    await client.query(
      `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
       VALUES ($1,$2,$3,'Antrean DSN',1,0,true)`,
      [st2, WS, TEAM2],
    );
    await expect(patch(uuidv7(), { status_id: st2 })).rejects.toThrow();
  });
});
