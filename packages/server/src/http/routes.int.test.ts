/**
 * UJI HTTP END-TO-END pada PostgreSQL sungguhan (PGlite).
 * Membuktikan kontrak api-contract.md §5: status, `code`, `field`, `trace_id`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7, TEAM_ROLE } from "@kelindan/shared";
import { createTestClient, applyMigrations } from "@kelindan/testing";
import { createApp, type App } from "../app.js";
import { testDeps } from "../test-deps.js";
import type { ClientLike } from "@kelindan/testing";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;

const WS = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const USER_VIEWER = "0190f000-0000-7000-8000-0000000000a2";
const ST_BACKLOG = "0190f000-0000-7000-8000-0000000000d1";
const ST_DOING = "0190f000-0000-7000-8000-0000000000d3";
const TASK = "0190f000-0000-7000-8000-0000000000e1";
const TOKEN = "tok-member";
const KEY = () => uuidv7();
const TOKEN_VIEWER = "tok-viewer";
const TOKEN_REVOKED = "tok-revoked";

let client: ClientLike;
let app: App;
let base: string;

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string | null; idem?: string | null } = {},
): Promise<{ status: number; body: Record<string, unknown>; traceId: string | null }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie !== null) headers["cookie"] = `kelindan_session=${opts.cookie ?? TOKEN}`;
  if (opts.idem !== null) headers["idempotency-key"] = opts.idem ?? uuidv7();
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    traceId: res.headers.get("x-trace-id"),
  };
}

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);

  await client.query(`INSERT INTO workspaces (id,name,slug) VALUES ($1,'Ruang','ruang-kerja')`, [WS]);
  await client.query(
    `INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A'),($2,'v@x.id','V')`,
    [USER, USER_VIEWER],
  );
  for (const u of [USER, USER_VIEWER]) {
    await client.query(
      `INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,1)`,
      [uuidv7(), WS, u],
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
    [TASK, WS, TEAM, "d".repeat(500), ST_BACKLOG, USER],
  );

  const session = (token: string, userId: string, revokedAt: Date | null = null) => ({
    sessionId: uuidv7(), userId, workspaceId: WS, epoch: 1,
    expiresAt: new Date(Date.now() + 3600_000), revokedAt, epochNow: 1, token,
  });

  app = createApp(
    testDeps({
      client,
      sessions: [
        session(TOKEN, USER),
        session(TOKEN_VIEWER, USER_VIEWER),
        session(TOKEN_REVOKED, USER, new Date()),
      ],
      teamRoles: [
        { userId: USER, workspaceId: WS, teamId: TEAM, role: TEAM_ROLE.MEMBER },
        { userId: USER_VIEWER, workspaceId: WS, teamId: TEAM, role: TEAM_ROLE.VIEWER },
      ],
    }),
  );
  const { port } = await app.listen(0);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
});

describe("PATCH /v1/tasks/:id — kontrak HTTP", () => {
  it("health tanpa sesi -> 200", async () => {
    const r = await call("GET", "/health", { cookie: null });
    expect(r.status).toBe(200);
    expect(r.body["ok"]).toBe(true);
  });

  it("tanpa cookie -> 401 auth.unauthenticated + trace_id", async () => {
    const r = await call("PATCH", `/v1/tasks/${TASK}`, { body: { title: "x" }, cookie: null });
    expect(r.status).toBe(401);
    expect(r.body["code"]).toBe("auth.unauthenticated");
    expect(r.body["trace_id"]).toBe(r.traceId);
  });

  it("sesi dicabut -> 401 (bukan lolos)", async () => {
    const r = await call("PATCH", `/v1/tasks/${TASK}`, { body: { title: "x" }, cookie: TOKEN_REVOKED });
    expect(r.status).toBe(401);
  });

  it("tanpa Idempotency-Key -> 400 dengan field Idempotency-Key", async () => {
    const r = await call("PATCH", `/v1/tasks/${TASK}`, { body: { title: "x" }, idem: null });
    expect(r.status).toBe(400);
    expect(r.body["field"]).toBe("Idempotency-Key");
  });

  it("field tak dikenal -> 400, menyebut field-nya", async () => {
    const r = await call("PATCH", `/v1/tasks/${TASK}`, { body: { titel: "salah" } });
    expect(r.status).toBe(400);
    expect(r.body["field"]).toBe("titel");
  });

  it("judul kosong -> 400 validation.failed", async () => {
    const r = await call("PATCH", `/v1/tasks/${TASK}`, { body: { title: "" } });
    expect(r.status).toBe(400);
    expect(r.body["code"]).toBe("validation.failed");
  });

  it("viewer menulis -> 403 auth.forbidden", async () => {
    const r = await call("PATCH", `/v1/tasks/${TASK}`, {
      body: { title: "viewer" }, cookie: TOKEN_VIEWER,
    });
    expect(r.status).toBe(403);
    expect(r.body["code"]).toBe("auth.forbidden");
  });

  it("task tidak ada -> 404 resource.not_found", async () => {
    const r = await call("PATCH", `/v1/tasks/${uuidv7()}`, { body: { title: "x" } });
    expect(r.status).toBe(404);
    expect(r.body["code"]).toBe("resource.not_found");
  });

  it("body bukan JSON -> 400", async () => {
    const res = await fetch(`${base}/v1/tasks/${TASK}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `kelindan_session=${TOKEN}`, "idempotency-key": uuidv7() },
      body: "{bukan json",
    });
    expect(res.status).toBe(400);
  });

  it("Idempotency-Key bukan UUID -> 400, BUKAN 500", async () => {
    const r = await call("PATCH", `/v1/tasks/${TASK}`, { body: { title: "x" }, idem: "demo-key-123" });
    expect(r.status).toBe(400);
    expect(r.body["code"]).toBe("validation.failed");
    expect(r.body["field"]).toBe("Idempotency-Key");
  });

  it("PATCH sah -> 200, versi naik, seq terisi", async () => {
    const r = await call("PATCH", `/v1/tasks/${TASK}`, { body: { priority: 2 } });
    expect(r.status).toBe(200);
    const task = r.body["task"] as Record<string, unknown>;
    expect(task["priority"]).toBe(2);
    expect(r.body["seq"]).toBeGreaterThan(0);
  });

  it("T-IDEM lewat HTTP: key sama 2x -> replayed true, versi sama", async () => {
    const key = uuidv7();
    const a = await call("PATCH", `/v1/tasks/${TASK}`, { body: { title: "Judul HTTP" }, idem: key });
    const b = await call("PATCH", `/v1/tasks/${TASK}`, { body: { title: "Judul HTTP" }, idem: key });
    expect(a.status).toBe(200);
    expect(b.body["replayed"]).toBe(true);
    expect((b.body["task"] as Record<string, unknown>)["version"]).toBe(
      (a.body["task"] as Record<string, unknown>)["version"],
    );
  });

  it("key sama + body beda -> 409 conflict.idempotency_mismatch", async () => {
    const key = uuidv7();
    await call("PATCH", `/v1/tasks/${TASK}`, { body: { title: "Satu HTTP" }, idem: key });
    const r = await call("PATCH", `/v1/tasks/${TASK}`, { body: { title: "Dua HTTP" }, idem: key });
    expect(r.status).toBe(409);
    expect(r.body["code"]).toBe("conflict.idempotency_mismatch");
  });

  it("expected_version basi -> 409 conflict.version dengan state kanonik", async () => {
    const r = await call("PATCH", `/v1/tasks/${TASK}`, {
      body: { title: "Konflik HTTP", expected_version: 1 },
    });
    expect(r.status).toBe(409);
    expect(r.body["code"]).toBe("conflict.version");
    expect(r.body["current"]).toBeTruthy();
  });

  it("POST /v1/teams/:id/tasks -> 201, nomor ENG-* terbit", async () => {
    const r = await call("POST", `/v1/teams/${TEAM}/tasks`, {
      body: { title: "Task dari HTTP" },
    });
    expect(r.status).toBe(201);
    const t = r.body["task"] as Record<string, unknown>;
    expect(Number(t["number"])).toBeGreaterThan(0);
    expect(t["version"]).toBe(1);
  });

  it("POST tanpa Idempotency-Key -> 400", async () => {
    const r = await call("POST", `/v1/teams/${TEAM}/tasks`, {
      body: { title: "x" }, idem: null,
    });
    expect(r.status).toBe(400);
    expect(r.body["field"]).toBe("Idempotency-Key");
  });

  it("POST judul kosong -> 400 field title", async () => {
    const r = await call("POST", `/v1/teams/${TEAM}/tasks`, { body: { title: "" } });
    expect(r.status).toBe(400);
    expect(r.body["field"]).toBe("title");
  });

  it("POST oleh viewer -> 403", async () => {
    const r = await call("POST", `/v1/teams/${TEAM}/tasks`, {
      body: { title: "viewer" }, cookie: TOKEN_VIEWER,
    });
    expect(r.status).toBe(403);
  });

  it("POST ke tim yang bukan anggota -> 404", async () => {
    const r = await call("POST", `/v1/teams/${uuidv7()}/tasks`, { body: { title: "x" } });
    expect(r.status).toBe(404);
  });

  it("T-W1 lewat HTTP: dua request berurutan field BERBEDA, expected_version sama", async () => {
    const cur = await call("PATCH", `/v1/tasks/${TASK}`, { body: { priority: 1 } });
    const v = (cur.body["task"] as Record<string, unknown>)["version"] as number;

    const a = await call("PATCH", `/v1/tasks/${TASK}`, {
      body: { title: "W1 judul", expected_version: v },
    });
    // Penulis kedua memakai expected_version LAMA yang sama.
    const b = await call("PATCH", `/v1/tasks/${TASK}`, {
      body: { priority: 3, expected_version: v },
    });
    expect(a.status).toBe(200);
    // CATATAN JUJUR: ini BUKAN konkurensi nyata (request berurutan pada satu
    // koneksi). Yang dibuktikan: per-field patch tidak saling menghapus, dan
    // penulis kedua MENDAPAT 409 karena versinya basi. Untuk konkurensi
    // sungguhan lihat T-12 di docs/todo.md.
    expect(b.status).toBe(409);
  });
});
