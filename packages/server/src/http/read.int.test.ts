/**
 * Uji HTTP endpoint BACA (P2). Fokus pada aturan yang paling mudah dilanggar:
 * anti-enumerasi 404 (api-contract.md §5.5) dan paginasi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7, TEAM_ROLE } from "@kelindan/shared";
import { createTestClient, applyMigrations, type ClientLike } from "@kelindan/testing";
import { createApp, type App } from "../app.js";
import { testDeps } from "../test-deps.js";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const WS = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const TEAM_HIDDEN = "0190f000-0000-7000-8000-0000000000c2";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const USER_OUT = "0190f000-0000-7000-8000-0000000000a9";
const ST1 = "0190f000-0000-7000-8000-0000000000d1";
const ST2 = "0190f000-0000-7000-8000-0000000000d2";
const TASK = "0190f000-0000-7000-8000-0000000000e1";

let client: ClientLike;
let app: App;
let base: string;

async function get(path: string, token = "tok-member") {
  const res = await fetch(`${base}${path}`, { headers: { cookie: `kelindan_session=${token}` } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} } as {
    status: number; body: Record<string, unknown>;
  };
}

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);
  await client.query(`INSERT INTO workspaces (id,name,slug) VALUES ($1,'Ruang','ruang-kerja')`, [WS]);
  await client.query(
    `INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A'),($2,'o@x.id','O')`,
    [USER, USER_OUT]);
  await client.query(
    `INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$3,'ENG','ENG'),($2,$3,'DSN','DSN')`,
    [TEAM, TEAM_HIDDEN, WS]);
  await client.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
     VALUES ($1,$3,$4,'Antrean',1,0,true),($2,$3,$4,'Siap',2,1,false)`, [ST1, ST2, WS, TEAM]);
  for (let i = 0; i < 12; i++) {
    await client.query(
      `INSERT INTO tasks (id,workspace_id,team_id,number,title,status_id,created_by,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() - ($8 || ' minutes')::interval)`,
      [uuidv7(), WS, TEAM, i + 100, `T${i}`, i % 2 ? ST2 : ST1, USER, i]);
  }
  await client.query(
    `INSERT INTO tasks (id,workspace_id,team_id,number,title,status_id,created_by)
     VALUES ($1,$2,$3,1,'Target',$4,$5)`, [TASK, WS, TEAM, ST1, USER]);

  const sess = (token: string, userId: string) => ({
    sessionId: uuidv7(), userId, workspaceId: WS, epoch: 1,
    expiresAt: new Date(Date.now() + 3600_000), revokedAt: null, epochNow: 1, token,
  });
  app = createApp(testDeps({
    client,
    sessions: [sess("tok-member", USER), sess("tok-outsider", USER_OUT)],
    teamRoles: [{ userId: USER, workspaceId: WS, teamId: TEAM, role: TEAM_ROLE.MEMBER }],
  }));
  const { port } = await app.listen(0);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => { await app?.close(); });

describe("GET /v1/teams/:id/board", () => {
  it("200 dengan kolom dan task, tanpa description", async () => {
    const r = await get(`/v1/teams/${TEAM}/board`);
    expect(r.status).toBe(200);
    const cols = r.body["columns"] as Array<Record<string, unknown>>;
    expect(cols.length).toBe(2);
    const tasks = cols.flatMap((c) => c["tasks"] as Array<Record<string, unknown>>);
    expect(tasks.length).toBe(13);
    expect(Object.keys(tasks[0]!)).not.toContain("description");
  });

  it("tim yang bukan anggota -> 404, BUKAN [] (anti-enumerasi)", async () => {
    const r = await get(`/v1/teams/${TEAM_HIDDEN}/board`, "tok-outsider");
    expect(r.status).toBe(404);
    expect(r.body["code"]).toBe("resource.not_found");
  });

  it("tim yang tidak ada juga 404 — sama persis dengan tim tersembunyi", async () => {
    const hidden = await get(`/v1/teams/${TEAM_HIDDEN}/board`, "tok-outsider");
    const missing = await get(`/v1/teams/${uuidv7()}/board`, "tok-outsider");
    expect(missing.status).toBe(hidden.status);
    expect(missing.body["code"]).toBe(hidden.body["code"]);
  });

  it("limit di luar batas -> 400", async () => {
    const r = await get(`/v1/teams/${TEAM}/board?limit=999`);
    expect(r.status).toBe(400);
    expect(r.body["field"]).toBe("limit");
  });
});

describe("GET /v1/teams/:id/tasks", () => {
  it("halaman pertama + next_cursor", async () => {
    const r = await get(`/v1/teams/${TEAM}/tasks?limit=5`);
    expect(r.status).toBe(200);
    expect((r.body["items"] as unknown[]).length).toBe(5);
    const page = r.body["page"] as Record<string, unknown>;
    expect(page["has_more"]).toBe(true);
    expect(typeof page["next_cursor"]).toBe("string");
  });

  it("menelusuri semua halaman tanpa duplikat", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = cursor ? `&cursor=${cursor}` : "";
      const r = await get(`/v1/teams/${TEAM}/tasks?limit=4${q}`);
      ids.push(...(r.body["items"] as Array<{ id: string }>).map((x) => x.id));
      cursor = (r.body["page"] as Record<string, string | null>)["next_cursor"];
    } while (cursor);
    expect(ids.length).toBe(13);
    expect(new Set(ids).size).toBe(13);
  });

  it("filter tak dikenal -> 400 menyebut nama filter", async () => {
    const r = await get(`/v1/teams/${TEAM}/tasks?namafilter=x`);
    expect(r.status).toBe(400);
    expect(r.body["field"]).toBe("namafilter");
  });

  it("order di luar allowlist -> 400 (bukan interpolasi SQL)", async () => {
    const r = await get(`/v1/teams/${TEAM}/tasks?order=1;DROP+TABLE+tasks`);
    expect(r.status).toBe(400);
  });

  it("assignee_id=me memakai id pemanggil", async () => {
    const r = await get(`/v1/teams/${TEAM}/tasks?assignee_id=me`);
    expect(r.status).toBe(200);
    expect((r.body["items"] as unknown[]).length).toBe(0); // belum ada yang di-assign
  });

  it("include_deleted oleh MEMBER diabaikan, bukan ditolak", async () => {
    await client.query(`UPDATE tasks SET deleted_at = now() WHERE title = 'T0'`);
    const member = await get(`/v1/teams/${TEAM}/tasks?include_deleted=true&limit=200`);
    const plain = await get(`/v1/teams/${TEAM}/tasks?limit=200`);
    expect((member.body["items"] as unknown[]).length).toBe((plain.body["items"] as unknown[]).length);
  });

  it("tim tersembunyi -> 404 bahkan untuk koleksi", async () => {
    const r = await get(`/v1/teams/${TEAM_HIDDEN}/tasks`, "tok-outsider");
    expect(r.status).toBe(404);
  });
});

describe("GET /v1/tasks/:id", () => {
  it("200 bentuk penuh dengan description & events", async () => {
    const r = await get(`/v1/tasks/${TASK}`);
    expect(r.status).toBe(200);
    expect(r.body["description"]).toBeNull();
    expect(Array.isArray(r.body["events"])).toBe(true);
    expect(r.body["number"]).toBe(1);
  });

  it("task tidak ada -> 404", async () => {
    const r = await get(`/v1/tasks/${uuidv7()}`);
    expect(r.status).toBe(404);
  });

  it("task tim yang bukan anggota -> 404 (bukan 403)", async () => {
    const r = await get(`/v1/tasks/${TASK}`, "tok-outsider");
    expect(r.status).toBe(404);
  });

  it("tanpa sesi -> 401", async () => {
    const res = await fetch(`${base}/v1/tasks/${TASK}`);
    expect(res.status).toBe(401);
  });
});
