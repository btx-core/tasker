/**
 * Uji hub real-time pada PostgreSQL sungguhan (PGlite).
 *
 * Fokus pada hal yang mudah salah dan TIDAK terlihat di uji unit:
 * klasifikasi K1/K2/K3 di titik keluar, celah `seq`, batas 5 tim, dan
 * pencabutan akses.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { uuidv7, TEAM_ROLE } from "@kelindan/shared";
import { createTestClient, applyMigrations, type ClientLike } from "@kelindan/testing";
import { Hub, toFrame, type ChangeRow } from "./hub.js";
import { capTeams, isBroadcastable, parseClientMessage, MAX_DELTAS_PER_FRAME } from "./protocol.js";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const WS = "0190f000-0000-7000-8000-000000000001";
const T1 = "0190f000-0000-7000-8000-0000000000c1";
const T2 = "0190f000-0000-7000-8000-0000000000c2";
const T3 = "0190f000-0000-7000-8000-0000000000c3";
const T4 = "0190f000-0000-7000-8000-0000000000c4";
const T5 = "0190f000-0000-7000-8000-0000000000c5";
const T6 = "0190f000-0000-7000-8000-0000000000c6";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const STRANGER = "0190f000-0000-7000-8000-0000000000a9";

let client: ClientLike;
let hub: Hub;
const sent: Array<Record<string, unknown>> = [];

function fakeSocket() {
  return { send: (s: string) => { sent.push(JSON.parse(s)); }, close: () => {}, addEventListener: () => {} } as unknown as WebSocket;
}

/** Suntikkan baris ke `changes` seperti yang dilakukan `write.ts`. */
async function addChange(opts: {
  entityType: number; entityId: string; teamId: string | null;
  version?: number; payload?: unknown; op?: number;
}): Promise<number> {
  const r = await client.query<{ seq: string }>(
    `SELECT seq_next::text AS seq, seq_next FROM workspaces WHERE id = $1`, [WS],
  );
  const seq = Number(r.rows[0]!.seq);
  await client.query(
    `INSERT INTO changes (workspace_id, seq, entity_type, entity_id, team_id, op, version, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [WS, seq, opts.entityType, opts.entityId, opts.teamId, opts.op ?? 1,
     opts.version ?? 1, opts.payload === undefined ? null : JSON.stringify(opts.payload)]);
  await client.query(`UPDATE workspaces SET seq_next = seq_next + 1 WHERE id = $1`, [WS]);
  return seq;
}

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);
  await client.query(`INSERT INTO workspaces (id,name,slug,seq_next) VALUES ($1,'Ruang','ruang-kerja',1)`, [WS]);
  await client.query(
    `INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A'),($2,'s@x.id','S')`, [USER, STRANGER]);

  const roles = new Map<string, Set<string>>([
    [USER, new Set([T1, T2, T3, T4, T5, T6])],
    [STRANGER, new Set()],
  ]);
  hub = new Hub({
    db: async () => client as never,
    async teamRoleOf(userId, _ws, teamId) {
      return roles.get(userId)?.has(teamId) ? TEAM_ROLE.MEMBER : null;
    },
    async auth() { return { userId: USER, workspaceId: WS }; },
  });
});

afterAll(() => { hub.stop(); });

describe("klasifikasi K1/K2/K3 (P3-05)", () => {
  it("K1 & K2 disiarkan, K3 tidak pernah", () => {
    expect(isBroadcastable(1)).toBe(true); // task
    expect(isBroadcastable(3)).toBe(true); // status (K2)
    expect(isBroadcastable(7)).toBe(true); // label (K2)
    // entity_type 8+ tidak terklasifikasi -> default aman: tidak disiarkan
    expect(isBroadcastable(8)).toBe(false);
    // K3 yang "menyelinap" lewat nama tetap ditolak
    for (const name of ["audit_event", "email_message", "job", "import", "notification"]) {
      expect(isBroadcastable(1, name)).toBe(false);
    }
  });

  it("toFrame menolak baris K3, bukan mengirimnya kosong", () => {
    const base: ChangeRow = {
      seq: 5, entity_type: 1, entity_id: uuidv7(), team_id: T1,
      op: 1, version: 2, payload: { title: "x" },
    };
    expect(toFrame(base)).not.toBeNull();
    expect(toFrame({ ...base, entity_type: 99 })).toBeNull();
  });

  it("payload besar dibuang, frame tetap dikirim (ADR-017)", () => {
    const big = toFrame({
      seq: 1, entity_type: 1, entity_id: uuidv7(), team_id: T1, op: 1, version: 2,
      payload: { description: "x".repeat(5000) },
    });
    expect(big).not.toBeNull();
    expect(Buffer.byteLength(JSON.stringify(big), "utf8")).toBeLessThanOrEqual(4096);
  });
});

describe("subscribe (P3-01) dan celah seq (P3-04)", () => {
  it("maksimum 5 tim; tim ke-6 DITOLAK dengan alasan", () => {
    const r = capTeams([T1, T2, T3, T4, T5], [T6]);
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toEqual([T6]);
    const ok = capTeams([T1], [T2]);
    expect(ok.accepted).toEqual([T2]);
  });

  it("tim yang bukan anggota masuk `rejected`, tim lain tetap dilanggan", async () => {
    sent.length = 0;
    const id = hub.register(STRANGER, WS, fakeSocket());
    await hub.handleMessage(id, JSON.stringify({ op: "subscribe", team_ids: [T1, T2] }));
    const msg = sent[0]!;
    expect(msg["op"]).toBe("subscribed");
    expect(msg["rejected"]).toEqual([T1, T2]);
    expect(msg["team_ids"]).toEqual([]);
    hub.remove(id);
  });

  it("subscribe dengan since_seq: mengirim backlog lalu delta baru", async () => {
    await addChange({ entityType: 1, entityId: uuidv7(), teamId: T1, payload: { title: "a" } });
    await addChange({ entityType: 1, entityId: uuidv7(), teamId: T1, payload: { title: "b" } });

    sent.length = 0;
    const id = hub.register(USER, WS, fakeSocket());
    await hub.handleMessage(id, JSON.stringify({ op: "subscribe", team_ids: [T1], since_seq: 0 }));
    const first = sent[0]!;
    expect(first["op"]).toBe("subscribed");
    const batch = sent.find((m) => m["op"] === "delta_batch")!;
    expect((batch["frames"] as unknown[]).length).toBe(2);
    expect(first["resync_required"]).toBe(false);
    hub.remove(id);
  });

  it("celah seq -> resync_required, TIDAK mengirim delta yang tidak lengkap", async () => {
    // Klien menyatakan sudah sampai seq 1, tetapi baris 2 & 3 dipangkas:
    // baris berikutnya adalah seq yang jauh. Ini kondisi nyata setelah
    // retensi 24 jam habis.
    await addChange({ entityType: 1, entityId: uuidv7(), teamId: T2 });
    const r = await client.query<{ seq: string }>(`SELECT seq_next::text AS seq FROM workspaces WHERE id=$1`, [WS]);
    await client.query(`UPDATE workspaces SET seq_next = seq_next + 100 WHERE id = $1`, [WS]);
    void r;

    sent.length = 0;
    const id = hub.register(USER, WS, fakeSocket());
    await hub.handleMessage(id, JSON.stringify({ op: "subscribe", team_ids: [T2], since_seq: 1 }));
    const msg = sent[0]!;
    expect(msg["resync_required"]).toBe(true);
    expect(sent.some((m) => m["op"] === "delta_batch")).toBe(false);
    hub.remove(id);
  });

  it("delta hanya ke klien yang berlangganan tim itu (isolasi)", async () => {
    sent.length = 0;
    const a = hub.register(USER, WS, fakeSocket());
    const b = hub.register(USER, WS, fakeSocket());
    await hub.handleMessage(a, JSON.stringify({ op: "subscribe", team_ids: [T3] }));
    await hub.handleMessage(b, JSON.stringify({ op: "subscribe", team_ids: [T4] }));
    sent.length = 0;

    const seq = await addChange({ entityType: 1, entityId: uuidv7(), teamId: T3, payload: { n: 1 } });
    hub.broadcast([{
      op: "delta", seq, entity: "task", entity_type: 1, id: uuidv7(),
      team_id: T3, version: 1, op_kind: 1, patch: { n: 1 },
    }]);
    expect(sent.length).toBe(1); // hanya klien A
    hub.remove(a); hub.remove(b);
  });

  it("lebih dari 50 delta dibagi ke beberapa frame (T-RT10)", async () => {
    sent.length = 0;
    const id = hub.register(USER, WS, fakeSocket());
    await hub.handleMessage(id, JSON.stringify({ op: "subscribe", team_ids: [T5] }));
    sent.length = 0;
    const frames = Array.from({ length: 120 }, (_, i) => ({
      op: "delta" as const, seq: i + 1, entity: "task", entity_type: 1,
      id: uuidv7(), team_id: T5, version: 1, op_kind: 1 as const, patch: {},
    }));
    hub.broadcast(frames);
    const batches = sent.filter((m) => m["op"] === "delta_batch");
    expect(batches.length).toBe(3);
    expect(batches.every((b) => (b["frames"] as unknown[]).length <= MAX_DELTAS_PER_FRAME)).toBe(true);
    expect(batches.reduce((n, b) => n + (b["frames"] as unknown[]).length, 0)).toBe(120);
    hub.remove(id);
  });
});

describe("pencabutan akses (P3-06)", () => {
  it("revokeTeam mengirim `revoked` dan berhenti mengirim delta", async () => {
    sent.length = 0;
    const id = hub.register(USER, WS, fakeSocket());
    await hub.handleMessage(id, JSON.stringify({ op: "subscribe", team_ids: [T6] }));
    sent.length = 0;

    const n = hub.revokeTeam(T6);
    expect(n).toBe(1);
    expect(sent[0]).toEqual({ op: "revoked", team_id: T6 });

    hub.broadcast([{
      op: "delta", seq: 1, entity: "task", entity_type: 1, id: uuidv7(),
      team_id: T6, version: 1, op_kind: 1, patch: {},
    }]);
    expect(sent.length).toBe(1); // hanya `revoked`, tidak ada delta
    hub.remove(id);
  });
});

describe("parser pesan", () => {
  it("menolak JSON rusak, op tak dikenal, team_ids bukan uuid", () => {
    expect(() => parseClientMessage("{")).toThrow();
    expect(() => parseClientMessage('{"op":"hack"}')).toThrow();
    expect(() => parseClientMessage('{"op":"subscribe","team_ids":["bukan-uuid"]}')).toThrow();
    expect(() => parseClientMessage('{"op":"subscribe","team_ids":[]}')).toThrow();
    expect(() => parseClientMessage('{"op":"subscribe","team_ids":["' + T1 + '"],"since_seq":-1}')).toThrow();
  });

  it("ping diterima", () => {
    expect(parseClientMessage('{"op":"ping"}')).toEqual({ op: "ping" });
  });
});
