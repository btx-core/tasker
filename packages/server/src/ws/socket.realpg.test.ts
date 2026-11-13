/**
 * T-16 / T-17: WebSocket + LISTEN/NOTIFY pada PostgreSQL SUNGGUHAN.
 *
 * Dua hal yang tidak bisa dibuktikan PGlite dan tidak bisa dibuktikan uji
 * `hub.int.test.ts`:
 *  1. Klien WebSocket nyata menerima frame (bukan soket tiruan).
 *  2. `pg_notify` dari SATU koneksi sampai ke `LISTEN` pada koneksi LAIN —
 *     yaitu lintas proses, seperti dua instance server.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import type { Client } from "pg";
import { applyTaskPatch } from "@kelindan/db";
import { uuidv7, TEAM_ROLE, type Actor } from "@kelindan/shared";
import {
  hasRealPg, SKIP_REASON, freshSchema, connect, REAL_PG_URL,
  applyMigrations, type FreshSchema,
} from "@kelindan/testing";
import { Hub } from "./hub.js";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const WS_ID = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const ST1 = "0190f000-0000-7000-8000-0000000000d1";
const ST2 = "0190f000-0000-7000-8000-0000000000d2";
const TASK = "0190f000-0000-7000-8000-0000000000e1";
const actor: Actor = { userId: USER, workspaceId: WS_ID, teamRole: TEAM_ROLE.MEMBER };

let schema: FreshSchema;
let server: Server;
let hub: Hub;
let port: number;
let listenClient: Client;
let writeClient: Client;

function url(): string {
  return `ws://127.0.0.1:${port}/v1/ws`;
}

/**
 * Antrean pesan: pendengar dipasang SEBELUM `send`, bukan sesudah.
 * Versi pertama memasang pendengar setelah `ws.send`, sehingga frame
 * `subscribed` yang datang cepat terlewat dan uji gagal karena RACE — bukan
 * karena server salah. Ini pelajaran yang sama seperti uji P2: waktu
 * pemasangan pendengar menentukan hasil.
 */
class Queue {
  private items: Array<Record<string, unknown>> = [];
  private waiters: Array<() => void> = [];

  constructor(ws: WebSocket) {
    ws.on("message", (d: Buffer) => {
      this.items.push(JSON.parse(d.toString("utf8")) as Record<string, unknown>);
      for (const w of this.waiters.splice(0)) w();
    });
  }

  async next(match: (m: Record<string, unknown>) => boolean, ms = 5000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const idx = this.items.findIndex(match);
      if (idx >= 0) return this.items.splice(idx, 1)[0]!;
      if (Date.now() > deadline) throw new Error("timeout menunggu frame");
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }

  saw(match: (m: Record<string, unknown>) => boolean): boolean {
    return this.items.some(match);
  }
}

beforeAll(async () => {
  if (!hasRealPg()) return;
  schema = await freshSchema("kelindan_ws");
  await applyMigrations(schema.client as never, dir);
  const c = schema.client;
  await c.query(`INSERT INTO workspaces (id,name,slug,seq_next) VALUES ($1,'Ruang','ruang-kerja',1)`, [WS_ID]);
  await c.query(`INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A')`, [USER]);
  await c.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG')`, [TEAM, WS_ID]);
  await c.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
     VALUES ($1,$3,$4,'Antrean',1,0,true),($2,$3,$4,'Dikerjakan',3,1,false)`,
    [ST1, ST2, WS_ID, TEAM]);
  await c.query(
    `INSERT INTO tasks (id,workspace_id,team_id,number,title,status_id,created_by)
     VALUES ($1,$2,$3,1,'Awal',$4,$5)`, [TASK, WS_ID, TEAM, ST1, USER]);

  // Koneksi PENULIS: bertindak sebagai proses lain yang memutasi data.
  writeClient = await connect(REAL_PG_URL!);
  await writeClient.query(`SET search_path TO ${schema.schema}, public`);
  listenClient = await connect(REAL_PG_URL!);
  await listenClient.query(`SET search_path TO ${schema.schema}, public`);

  hub = new Hub({
    db: async () => listenClient,
    async teamRoleOf(_u, ws, teamId) {
      return ws === WS_ID && teamId === TEAM ? TEAM_ROLE.MEMBER : null;
    },
    async auth(req) {
      const cookie = req.headers.cookie ?? "";
      return cookie.includes("kelindan_session=ok")
        ? { userId: USER, workspaceId: WS_ID } : null;
    },
  });

  server = createServer();
  hub.attach(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
  await hub.startListening();
}, 120_000);

afterAll(async () => {
  hub?.stop();
  await hub?.stopListening();
  await new Promise<void>((r) => server?.close(() => r()));
  await writeClient?.end().catch(() => {});
  await schema?.drop();
});

describe.skipIf(!hasRealPg())("T-16/T-17 — soket nyata + NOTIFY lintas koneksi", () => {
  it("koneksi tanpa sesi DITOLAK sebelum upgrade (401)", async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url()); // tanpa cookie
      ws.on("unexpected-response", (_req, res) => {
        try { expect(res.statusCode).toBe(401); ws.terminate(); resolve(); }
        catch (e) { reject(e as Error); }
      });
      ws.on("open", () => { ws.close(); reject(new Error("seharusnya ditolak")); });
      ws.on("error", () => resolve());
    });
  }, 20_000);

  it("subscribe lewat soket nyata: frame `subscribed` diterima", async () => {
    const ws = new WebSocket(url(), { headers: { cookie: "kelindan_session=ok" } });
    const q = new Queue(ws); // dipasang SEBELUM open/subscribe
    await new Promise<void>((r) => ws.on("open", () => r()));
    const hello = await q.next((m) => m["op"] === "subscribed");
    expect(hello["team_ids"]).toEqual([]);

    ws.send(JSON.stringify({ op: "subscribe", team_ids: [TEAM] }));
    const sub = await q.next((m) => m["op"] === "subscribed" && (m["team_ids"] as string[]).length === 1);
    expect(sub["rejected"]).toEqual([]);
    expect(sub["resync_required"]).toBe(false);
    ws.close();
  }, 20_000);

  it("T-17: pg_notify dari KONEKSI LAIN muncul sebagai delta di klien", async () => {
    const ws = new WebSocket(url(), { headers: { cookie: "kelindan_session=ok" } });
    const q = new Queue(ws);
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ op: "subscribe", team_ids: [TEAM] }));
    await q.next((m) => m["op"] === "subscribed" && (m["team_ids"] as string[]).length === 1);

    const deltaPromise = q.next((m) => m["op"] === "delta_batch");

    // Mutasi pada koneksi PENULIS — proses berbeda dari yang LISTEN.
    await applyTaskPatch(writeClient as never, {
      actor, taskId: TASK, patch: { title: "Lewat NOTIFY" },
      operationId: uuidv7(), endpoint: "test", traceId: uuidv7(),
    });

    const batch = await deltaPromise;
    const frames = batch["frames"] as Array<Record<string, unknown>>;
    expect(frames.length).toBe(1);
    expect(frames[0]!["entity"]).toBe("task");
    expect(frames[0]!["team_id"]).toBe(TEAM);
    expect((frames[0]!["patch"] as Record<string, unknown>)["title"]).toBe("Lewat NOTIFY");
    ws.close();
  }, 30_000);

  it("T-17: NOTIFY hanya membawa pointer < 64 byte, bukan isi delta", async () => {
    // Ini inti ADR-017: satu deskripsi 100 KB TIDAK BOLEH menggagalkan simpan.
    const big = "d".repeat(100_000);
    const ws = new WebSocket(url(), { headers: { cookie: "kelindan_session=ok" } });
    const q = new Queue(ws);
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ op: "subscribe", team_ids: [TEAM] }));
    await q.next((m) => m["op"] === "subscribed" && (m["team_ids"] as string[]).length === 1);

    const deltaPromise = q.next((m) => m["op"] === "delta_batch");
    await applyTaskPatch(writeClient as never, {
      actor, taskId: TASK, patch: { description: big },
      operationId: uuidv7(), endpoint: "test", traceId: uuidv7(),
    });
    const batch = await deltaPromise;
    const frameStr = JSON.stringify(batch);
    // Frame tetap kecil, dan isi deskripsi TIDAK ikut (ADR-017).
    expect(frameStr.length).toBeLessThan(4096);
    expect(frameStr).not.toContain("dddddddddd");
    ws.close();
  }, 30_000);

  it("T-16: dua klien berbeda tim — hanya yang berhak menerima", async () => {
    const ws = new WebSocket(url(), { headers: { cookie: "kelindan_session=ok" } });
    const q = new Queue(ws);
    await new Promise<void>((r) => ws.on("open", () => r()));
    // Berlangganan tim LAIN (bukan anggota) -> ditolak, tidak menerima apa pun.
    ws.send(JSON.stringify({ op: "subscribe", team_ids: ["0190f000-0000-7000-8000-0000000000ff"] }));
    const sub = await q.next(
      (m) => m["op"] === "subscribed" && (m["rejected"] as string[]).length === 1);
    expect(sub["rejected"]).toHaveLength(1);
    await applyTaskPatch(writeClient as never, {
      actor, taskId: TASK, patch: { priority: 2 },
      operationId: uuidv7(), endpoint: "test", traceId: uuidv7(),
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(q.saw((m) => m["op"] === "delta_batch")).toBe(false);
    ws.close();
  }, 30_000);
});

if (!hasRealPg()) {
  describe("T-16/T-17 (dilewati)", () => {
    it.skip(SKIP_REASON, () => {});
  });
}
