/**
 * Uji HTTP komentar & checklist. Yang diperiksa adalah MATRIKS PERAN, karena
 * di situlah kesalahan paling mahal: `commenter` yang bisa mengubah task, atau
 * `viewer` yang bisa berkomentar, keduanya lolos dari uji "happy path".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7, TEAM_ROLE } from "@kelindan/shared";
import { createTestClient, applyMigrations, type ClientLike } from "@kelindan/testing";
import { createApp, type App } from "../app.js";
import { testDeps } from "../test-deps.js";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;

const WS = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const TASK = "0190f000-0000-7000-8000-0000000000e1";
const ST = "0190f000-0000-7000-8000-0000000000d1";

const U_ADMIN = "0190f000-0000-7000-8000-0000000000a1";
const U_MEMBER = "0190f000-0000-7000-8000-0000000000a2";
const U_COMMENTER = "0190f000-0000-7000-8000-0000000000a3";
const U_VIEWER = "0190f000-0000-7000-8000-0000000000a4";
const U_OUTSIDER = "0190f000-0000-7000-8000-0000000000a5";

const T_ADMIN = "tok-admin";
const T_MEMBER = "tok-member";
const T_COMMENTER = "tok-commenter";
const T_VIEWER = "tok-viewer";
const T_OUTSIDER = "tok-outsider";

let client: ClientLike;
let app: App;
let base: string;

interface Res {
  status: number;
  body: Record<string, unknown>;
}

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<Res> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers["cookie"] = `kelindan_session=${opts.token}`;
  const res = await fetch(`${base}${path}`, {
    method, headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);

  await client.query(`INSERT INTO workspaces (id,name,slug) VALUES ($1,'Ruang','ruang-kerja')`, [WS]);
  const users = [U_ADMIN, U_MEMBER, U_COMMENTER, U_VIEWER, U_OUTSIDER];
  for (const [i, u] of users.entries()) {
    await client.query(
      `INSERT INTO users (id,email,display_name) VALUES ($1,$2,$3)`,
      [u, `u${i}@x.id`, `U${i}`],
    );
  }
  await client.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG')`, [TEAM, WS]);
  await client.query(`INSERT INTO team_keys (team_id,workspace_id) VALUES ($1,$2)`, [TEAM, WS]);
  await client.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
     VALUES ($1,$2,$3,'Antrean',1,0,true)`,
    [ST, WS, TEAM],
  );
  await client.query(
    `INSERT INTO tasks (id,workspace_id,team_id,number,title,status_id,created_by)
     VALUES ($1,$2,$3,1,'Judul',$4,$5)`,
    [TASK, WS, TEAM, ST, U_ADMIN],
  );

  const session = (token: string, userId: string) => ({
    sessionId: uuidv7(), userId, workspaceId: WS, epoch: 1,
    expiresAt: new Date(Date.now() + 3_600_000), revokedAt: null, epochNow: 1, token,
  });

  app = createApp(
    testDeps({
      client,
      sessions: [
        session(T_ADMIN, U_ADMIN), session(T_MEMBER, U_MEMBER),
        session(T_COMMENTER, U_COMMENTER), session(T_VIEWER, U_VIEWER),
        session(T_OUTSIDER, U_OUTSIDER),
      ],
      teamRoles: [
        { userId: U_ADMIN, workspaceId: WS, teamId: TEAM, role: TEAM_ROLE.ADMIN },
        { userId: U_MEMBER, workspaceId: WS, teamId: TEAM, role: TEAM_ROLE.MEMBER },
        { userId: U_COMMENTER, workspaceId: WS, teamId: TEAM, role: TEAM_ROLE.COMMENTER },
        { userId: U_VIEWER, workspaceId: WS, teamId: TEAM, role: TEAM_ROLE.VIEWER },
        // OUTSIDER sengaja TIDAK punya baris: bukan anggota tim.
      ],
    }),
  );
  const { port } = await app.listen(0);
  base = `http://127.0.0.1:${port}`;
}, 120_000);

afterAll(async () => { await app?.close(); });

describe("komentar — matriks peran", () => {
  it("member & commenter BOLEH berkomentar; viewer TIDAK", async () => {
    for (const token of [T_MEMBER, T_COMMENTER]) {
      const r = await call("POST", `/v1/tasks/${TASK}/comments`, {
        token, body: { body: "halo dari " + token },
      });
      expect(r.status).toBe(201);
    }

    const denied = await call("POST", `/v1/tasks/${TASK}/comments`, {
      token: T_VIEWER, body: { body: "viewer tidak boleh" },
    });
    expect(denied.status).toBe(403);
    expect(denied.body["code"]).toBe("auth.forbidden");
  });

  it("semua peran tim boleh MEMBACA komentar", async () => {
    for (const token of [T_ADMIN, T_MEMBER, T_COMMENTER, T_VIEWER]) {
      const r = await call("GET", `/v1/tasks/${TASK}/comments`, { token });
      expect(r.status).toBe(200);
    }
  });

  it("bukan anggota tim sama sekali -> 404, BUKAN 403 (jangan bocorkan keberadaan task)", async () => {
    const r = await call("GET", `/v1/tasks/${TASK}/comments`, { token: T_OUTSIDER });
    expect(r.status).toBe(404);
  });

  it("tanpa sesi -> 401", async () => {
    const r = await call("GET", `/v1/tasks/${TASK}/comments`, { token: null });
    expect(r.status).toBe(401);
  });

  it("komentar kosong / spasi saja -> 400 dengan field body", async () => {
    for (const body of [{ body: "" }, { body: "   " }, {}]) {
      const r = await call("POST", `/v1/tasks/${TASK}/comments`, { token: T_MEMBER, body });
      expect(r.status).toBe(400);
      expect(r.body["field"]).toBe("body");
    }
  });
});

describe("komentar — edit & hapus", () => {
  async function createAs(token: string, text: string): Promise<string> {
    const r = await call("POST", `/v1/tasks/${TASK}/comments`, { token, body: { body: text } });
    expect(r.status).toBe(201);
    return (r.body["comment"] as Record<string, string>)["id"]!;
  }

  it("penulis boleh mengedit komentarnya sendiri", async () => {
    const id = await createAs(T_MEMBER, "awal");
    const r = await call("PATCH", `/v1/comments/${id}`, {
      token: T_MEMBER, body: { body: "sudah diedit" },
    });
    expect(r.status).toBe(200);
    expect((r.body["comment"] as Record<string, string>)["body"]).toBe("sudah diedit");
  });

  it("member lain TIDAK boleh mengedit komentar orang lain", async () => {
    const id = await createAs(T_MEMBER, "milik member");
    const r = await call("PATCH", `/v1/comments/${id}`, {
      token: T_COMMENTER, body: { body: "diambil alih" },
    });
    expect(r.status).toBe(403);
  });

  it("admin boleh memoderasi komentar siapa pun", async () => {
    const id = await createAs(T_MEMBER, "perlu moderasi");
    const r = await call("PATCH", `/v1/comments/${id}`, {
      token: T_ADMIN, body: { body: "dimoderasi admin" },
    });
    expect(r.status).toBe(200);
  });

  it("penulis boleh menghapus miliknya; placeholder tetap ada dan body tidak dikirim", async () => {
    const id = await createAs(T_MEMBER, "akan dihapus");
    const r = await call("DELETE", `/v1/comments/${id}`, { token: T_MEMBER });
    expect(r.status).toBe(200);
    expect(r.body["deleted"]).toBe(true);

    const list = await call("GET", `/v1/tasks/${TASK}/comments`, { token: T_MEMBER });
    const found = (list.body["comments"] as Array<Record<string, unknown>>).find((c) => c["id"] === id)!;
    expect(found["deleted_at"]).not.toBeNull();
    // Teks TIDAK dikirim lagi ke klien, meski tersimpan di DB (T-38).
    expect(found["body"]).toBeNull();
  });

  it("menghapus dua kali: yang kedua sukses tetapi menandai already_deleted", async () => {
    const id = await createAs(T_MEMBER, "sekali saja");
    await call("DELETE", `/v1/comments/${id}`, { token: T_MEMBER });
    const twice = await call("DELETE", `/v1/comments/${id}`, { token: T_MEMBER });
    expect(twice.status).toBe(200);
    expect(twice.body["already_deleted"]).toBe(true);
  });

  it("komentar yang sudah dihapus -> PATCH 404, bukan 403", async () => {
    const id = await createAs(T_MEMBER, "hilang");
    await call("DELETE", `/v1/comments/${id}`, { token: T_MEMBER });
    const r = await call("PATCH", `/v1/comments/${id}`, {
      token: T_ADMIN, body: { body: "hidupkan lagi" },
    });
    expect(r.status).toBe(404);
  });

  it("ID komentar yang tidak ada -> 404 (bukan 500)", async () => {
    const r = await call("PATCH", `/v1/comments/${uuidv7()}`, {
      token: T_ADMIN, body: { body: "x" },
    });
    expect(r.status).toBe(404);
  });
});

describe("checklist — matriks peran", () => {
  it("member boleh menambah; commenter & viewer tidak", async () => {
    const ok = await call("POST", `/v1/tasks/${TASK}/checklist`, {
      token: T_MEMBER, body: { content: "item pertama" },
    });
    expect(ok.status).toBe(201);

    for (const token of [T_COMMENTER, T_VIEWER]) {
      const r = await call("POST", `/v1/tasks/${TASK}/checklist`, {
        token, body: { content: "tidak boleh" },
      });
      expect(r.status).toBe(403);
    }
  });

  it("membaca checklist mengembalikan progres", async () => {
    await call("POST", `/v1/tasks/${TASK}/checklist`, { token: T_MEMBER, body: { content: "a" } });
    const r = await call("GET", `/v1/tasks/${TASK}/checklist`, { token: T_VIEWER });
    expect(r.status).toBe(200);
    const progress = r.body["progress"] as { done: number; total: number };
    expect(progress.total).toBeGreaterThanOrEqual(1);
    expect(progress.done).toBe(0);
  });

  it("mencentang item lewat PATCH mengubah progres", async () => {
    const created = await call("POST", `/v1/tasks/${TASK}/checklist`, {
      token: T_MEMBER, body: { content: "centang saya" },
    });
    const id = (created.body["item"] as Record<string, string>)["id"]!;

    const patch = await call("PATCH", `/v1/checklist/${id}`, {
      token: T_MEMBER, body: { is_done: true },
    });
    expect(patch.status).toBe(200);
    expect((patch.body["item"] as Record<string, boolean>)["is_done"]).toBe(true);

    const list = await call("GET", `/v1/tasks/${TASK}/checklist`, { token: T_MEMBER });
    expect((list.body["progress"] as { done: number }).done).toBe(1);
  });

  it("is_done bukan boolean -> 400 dengan field", async () => {
    const created = await call("POST", `/v1/tasks/${TASK}/checklist`, {
      token: T_MEMBER, body: { content: "validasi" },
    });
    const id = (created.body["item"] as Record<string, string>)["id"]!;
    const r = await call("PATCH", `/v1/checklist/${id}`, {
      token: T_MEMBER, body: { is_done: "ya" },
    });
    expect(r.status).toBe(400);
    expect(r.body["field"]).toBe("is_done");
  });

  it("commenter tidak bisa mencentang item yang sudah ada", async () => {
    const created = await call("POST", `/v1/tasks/${TASK}/checklist`, {
      token: T_MEMBER, body: { content: "hanya member" },
    });
    const id = (created.body["item"] as Record<string, string>)["id"]!;
    const r = await call("PATCH", `/v1/checklist/${id}`, {
      token: T_COMMENTER, body: { is_done: true },
    });
    expect(r.status).toBe(403);
  });

  it("menghapus item -> 204, dan item hilang dari daftar", async () => {
    const created = await call("POST", `/v1/tasks/${TASK}/checklist`, {
      token: T_MEMBER, body: { content: "hapus saya" },
    });
    const id = (created.body["item"] as Record<string, string>)["id"]!;
    const del = await call("DELETE", `/v1/checklist/${id}`, { token: T_MEMBER });
    expect(del.status).toBe(204);

    const list = await call("GET", `/v1/tasks/${TASK}/checklist`, { token: T_MEMBER });
    const ids = (list.body["items"] as Array<Record<string, string>>).map((i) => i["id"]);
    expect(ids).not.toContain(id);
  });

  it("ID checklist yang tidak ada -> 404 pada PATCH dan DELETE", async () => {
    for (const method of ["PATCH", "DELETE"]) {
      const r = await call(method, `/v1/checklist/${uuidv7()}`, {
        token: T_MEMBER, body: method === "PATCH" ? { is_done: true } : undefined,
      });
      expect(r.status).toBe(404);
    }
  });
});
