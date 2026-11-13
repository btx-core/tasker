/**
 * P3-06 / T-RT9: mencabut anggota tim harus berlaku SERENTAK pada hub dan HTTP.
 * Kalau hanya hub yang tahu, pengguna tercabut masih bisa memuat board lewat
 * REST — dan itu justru jalur yang paling mudah dipakai ulang.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7, TEAM_ROLE } from "@kelindan/shared";
import { createTestClient, applyMigrations, type ClientLike } from "@kelindan/testing";
import { createApp, type App } from "../app.js";
import { testDeps } from "../test-deps.js";
import { Hub } from "./hub.js";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const WS = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const ST1 = "0190f000-0000-7000-8000-0000000000d1";

let client: ClientLike;
let app: App;
let base: string;
let hub: Hub;
const roles = new Map<string, Map<string, number>>();

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);
  await client.query(`INSERT INTO workspaces (id,name,slug,seq_next) VALUES ($1,'Ruang','ruang-kerja',1)`, [WS]);
  await client.query(`INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A')`, [USER]);
  await client.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG')`, [TEAM, WS]);
  await client.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
     VALUES ($1,$2,$3,'Antrean',1,0,true)`, [ST1, WS, TEAM]);
  roles.set(USER, new Map([[TEAM, TEAM_ROLE.MEMBER]]));

  const roleOf = async (userId: string, _ws: string, teamId: string) =>
    (roles.get(userId)?.get(teamId) ?? null) as TEAM_ROLE.MEMBER | null;

  app = createApp(testDeps({
    client,
    sessions: [{
      sessionId: uuidv7(), userId: USER, workspaceId: WS, epoch: 1,
      expiresAt: new Date(Date.now() + 3600_000), revokedAt: null, epochNow: 1, token: "tok-a",
    }],
    teamRoles: [],
  }));
  // Timpa resolver agar membaca peta yang bisa diubah uji.
  const deps = testDeps({ client, sessions: [], teamRoles: [] });
  deps.teamRoleOf = roleOf;
  app = createApp({
    ...deps,
    sessions: {
      async findByTokenHash() {
        return {
          sessionId: "s1", userId: USER, workspaceId: WS, epoch: 1,
          expiresAt: new Date(Date.now() + 3600_000), revokedAt: null, epochNow: 1,
        };
      },
    },
  });
  const { port } = await app.listen(0);
  base = `http://127.0.0.1:${port}`;

  hub = new Hub({
    db: async () => client as never,
    teamRoleOf: roleOf,
    async auth() { return { userId: USER, workspaceId: WS }; },
  });
});

afterAll(async () => { hub?.stop(); await app?.close(); });

const get = async (p: string) => {
  const r = await fetch(`${base}${p}`, { headers: { cookie: "kelindan_session=tok-a" } });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe("P3-06 / T-RT9: pencabutan akses berlaku di hub DAN HTTP", () => {
  it("sebelum dicabut: board 200 dan langganan diterima", async () => {
    const r = await get(`/v1/teams/${TEAM}/board`);
    expect(r.status).toBe(200);

    const sent: Array<Record<string, unknown>> = [];
    const id = hub.register(USER, WS, {
      send: (s: string) => sent.push(JSON.parse(s)), close: () => {}, addEventListener: () => {},
    } as unknown as WebSocket);
    await hub.handleMessage(id, JSON.stringify({ op: "subscribe", team_ids: [TEAM] }));
    expect(sent[0]!["rejected"]).toEqual([]);
    hub.remove(id);
  });

  it("setelah dicabut: HTTP 404, langganan ditolak, dan koneksi lama diberi tahu", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const id = hub.register(USER, WS, {
      send: (s: string) => sent.push(JSON.parse(s)), close: () => {}, addEventListener: () => {},
    } as unknown as WebSocket);
    await hub.handleMessage(id, JSON.stringify({ op: "subscribe", team_ids: [TEAM] }));

    // Pencabutan: satu perubahan di `team_members`, bukan tiga tempat berbeda.
    roles.get(USER)!.delete(TEAM);
    const revoked = hub.revokeTeam(TEAM);
    expect(revoked).toBe(1);

    // 1) koneksi yang sedang terbuka menerima `revoked` — bukan diam.
    expect(sent.some((m) => m["op"] === "revoked")).toBe(true);

    // 2) akses HTTP berikutnya 404 (TC-15), bukan 200 dan bukan 403.
    const board = await get(`/v1/teams/${TEAM}/board`);
    expect(board.status).toBe(404);

    // 3) langganan baru juga ditolak.
    sent.length = 0;
    await hub.handleMessage(id, JSON.stringify({ op: "subscribe", team_ids: [TEAM] }));
    expect(sent[0]!["rejected"]).toEqual([TEAM]);
    hub.remove(id);
  });
});
