/**
 * TC-15 / P3-06: klaim "pencabutan akses berlaku < 5 detik" — DIUKUR.
 *
 * Klaim ini tertulis di `rbac.md` sebagai jaminan. Sebelum uji ini, yang ada
 * hanya `revokeTeam()` yang bisa dipanggil manual; tidak ada yang memanggilnya
 * saat anggota benar-benar dicabut.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import type { Client } from "pg";
import { uuidv7, TEAM_ROLE } from "@kelindan/shared";
import {
  hasRealPg, SKIP_REASON, freshSchema, connect, REAL_PG_URL,
  applyMigrations, type FreshSchema,
} from "@kelindan/testing";
import { Hub } from "./hub.js";
import { RevocationWatcher } from "./revocation.js";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const WS_ID = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const STATUS = "0190f000-0000-7000-8000-0000000000d1";

/** Batas yang dijanjikan dokumen. */
const SLA_MS = 5000;

let schema: FreshSchema;
let server: Server;
let hub: Hub;
let watcher: RevocationWatcher;
let admin: Client;
let listenClient: Client;
let port: number;
let revokedAt: Date | null = null;

beforeAll(async () => {
  if (!hasRealPg()) return;
  schema = await freshSchema("kelindan_revoke");
  await applyMigrations(schema.client as never, dir);
  const c = schema.client;
  await c.query(`INSERT INTO workspaces (id,name,slug,seq_next) VALUES ($1,'Ruang','ruang-kerja',1)`, [WS_ID]);
  await c.query(`INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A')`, [USER]);
  await c.query(
    `INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,1)`,
    [uuidv7(), WS_ID, USER]);
  await c.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG')`, [TEAM, WS_ID]);
  await c.query(
    `INSERT INTO team_members (id,workspace_id,team_id,user_id,role) VALUES ($1,$2,$3,$4,$5)`,
    [uuidv7(), WS_ID, TEAM, USER, TEAM_ROLE.MEMBER]);

  admin = await connect(REAL_PG_URL!);
  await admin.query(`SET search_path TO ${schema.schema}, public`);
  listenClient = await connect(REAL_PG_URL!);
  await listenClient.query(`SET search_path TO ${schema.schema}, public`);

  hub = new Hub({
    db: async () => listenClient,
    async teamRoleOf(_u, ws, teamId) {
      if (ws !== WS_ID || teamId !== TEAM) return null;
      const r = await admin.query(
        `SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL`,
        [teamId, _u]);
      return r.rowCount ? TEAM_ROLE.MEMBER : null;
    },
    async auth(req) {
      return (req.headers.cookie ?? "").includes("kelindan_session=ok")
        ? { userId: USER, workspaceId: WS_ID } : null;
    },
  });

  server = createServer();
  hub.attach(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;

  watcher = new RevocationWatcher({
    db: async () => admin,
    hub,
    intervalMs: 250, // lebih rapat dari default agar uji cepat; SLA tetap 5 dtk
    onRevoked: (_t, _u, at) => { revokedAt = at; },
  });
  watcher.start();
  // Beri waktu jajak pertama mengisi `known`.
  await new Promise((r) => setTimeout(r, 400));
}, 120_000);

afterAll(async () => {
  watcher?.stop();
  hub?.stop();
  await new Promise<void>((r) => server?.close(() => r()));
  await admin?.end().catch(() => {});
  await schema?.drop();
});

describe.skipIf(!hasRealPg())("TC-15 — pencabutan akses < 5 detik", () => {
  it("anggota dicabut -> klien menerima `revoked` JAUH di bawah 5 detik", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`, {
      headers: { cookie: "kelindan_session=ok" },
    });
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ op: "subscribe", team_ids: [TEAM] }));
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("tidak pernah subscribed")), 5000);
      ws.on("message", (d: Buffer) => {
        const m = JSON.parse(d.toString()) as { op: string; team_ids?: string[] };
        if (m.op === "subscribed" && (m.team_ids ?? []).includes(TEAM)) {
          clearTimeout(t);
          resolve();
        }
      });
    });

    const revokedPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("revoked tidak diterima")), SLA_MS + 2000);
      ws.on("message", (d: Buffer) => {
        const m = JSON.parse(d.toString()) as Record<string, unknown>;
        if (m["op"] === "revoked") { clearTimeout(t); resolve(m); }
      });
    });

    const t0 = Date.now();
    // Pencabutan NYATA: satu UPDATE, sama seperti yang dilakukan UI admin.
    await admin.query(
      `UPDATE team_members SET revoked_at = now() WHERE team_id = $1 AND user_id = $2`,
      [TEAM, USER]);
    const msg = await revokedPromise;
    const elapsed = Date.now() - t0;

    expect(msg["team_id"]).toBe(TEAM);
    // INI klaim yang diukur, bukan diasumsikan.
    expect(elapsed).toBeLessThan(SLA_MS);
    console.log(`[TC-15] pencabutan terdeteksi dalam ${elapsed} ms (SLA ${SLA_MS} ms)`);
    expect(revokedAt).not.toBeNull();
    ws.close();
  }, 30_000);

  it("setelah dicabut: langganan baru DITOLAK (akses benar-benar hilang)", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`, {
      headers: { cookie: "kelindan_session=ok" },
    });
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ op: "subscribe", team_ids: [TEAM] }));
    const sub = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 5000);
      ws.on("message", (d: Buffer) => {
        const m = JSON.parse(d.toString()) as Record<string, unknown>;
        if (m["op"] === "subscribed" && Array.isArray(m["rejected"]) &&
            (m["rejected"] as string[]).length > 0) {
          clearTimeout(t); resolve(m);
        }
      });
    });
    expect(sub["rejected"]).toEqual([TEAM]);
    ws.close();
  }, 20_000);

  it("restart server TIDAK menganggap semua anggota dicabut (tidak ada false positive)", async () => {
    const w2 = new RevocationWatcher({ db: async () => admin, hub, intervalMs: 10_000 });
    await w2.poll(); // jajak pertama: mengisi `known`, tidak mencabut apa pun
    // Setelah dicabut di uji pertama, tabel kosong -> tidak ada yang "hilang".
    const revoked = await w2.poll();
    expect(revoked).toEqual([]);
    w2.stop();
  }, 20_000);
});

if (!hasRealPg()) {
  describe("TC-15 (dilewati)", () => {
    it.skip(SKIP_REASON, () => {});
  });
}
