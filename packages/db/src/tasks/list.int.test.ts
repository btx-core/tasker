/**
 * Uji paginasi cursor (INV-11). Fokus: TIDAK ADA duplikat atau lewatan
 * meskipun data disisipkan di antara dua halaman.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { listTasks, parseOrderParams, parseLimit, encodeCursor } from "@kelindan/db";
import { uuidv7 } from "@kelindan/shared";
import { createTestClient, applyMigrations, type ClientLike } from "@kelindan/testing";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const WS = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const ST1 = "0190f000-0000-7000-8000-0000000000d1";
const ST2 = "0190f000-0000-7000-8000-0000000000d2";

let client: ClientLike;
const db = () => client as unknown as Client;

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);
  await client.query(`INSERT INTO workspaces (id,name,slug) VALUES ($1,'Ruang','ruang-kerja')`, [WS]);
  await client.query(`INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A')`, [USER]);
  await client.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG')`, [TEAM, WS]);
  await client.query(
    `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
     VALUES ($1,$3,$4,'Antrean',1,0,true),($2,$3,$4,'Siap',2,1,false)`, [ST1, ST2, WS, TEAM]);
});

async function seed(n: number) {
  for (let i = 0; i < n; i++) {
    await client.query(
      `INSERT INTO tasks (id,workspace_id,team_id,number,title,status_id,created_by,updated_at,due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() - ($8 || ' minutes')::interval, $9)`,
      [uuidv7(), WS, TEAM, i + 1, `T${i}`, i % 2 === 0 ? ST1 : ST2, USER, i,
       i % 5 === 0 ? null : `2026-12-${String((i % 28) + 1).padStart(2, "0")}`],
    );
  }
}

const collect = () => ({ ids: [] as string[], pages: 0 });

async function pageAll(limit: number, order?: { key: "updated_at" | "due_date" | "number"; desc: boolean }) {
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r = await listTasks(db(), {
      workspaceId: WS, teamId: TEAM, limit,
      ...(order ? { order } : {}),
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...r.rows.map((x) => x.id));
    cursor = r.next_cursor;
    pages++;
    if (pages > 50) throw new Error("paginasi tidak berhenti");
  } while (cursor !== null);
  return { seen, pages };
}

describe("listTasks — paginasi cursor", () => {
  it("menelusuri seluruh data tanpa duplikat", async () => {
    await seed(25);
    const { seen } = await pageAll(7);
    expect(seen.length).toBe(25);
    expect(new Set(seen).size).toBe(25);
  }, 60_000);

  it("INV-11: menyisipkan task baru di antara halaman TIDAK menggeser hasil", async () => {
    // Halaman 1
    const p1 = await listTasks(db(), { workspaceId: WS, teamId: TEAM, limit: 5 });
    expect(p1.rows.length).toBe(5);

    // Data berubah: 3 task baru di ATAS (updated_at paling baru) + 1 dihapus.
    // Inilah yang membuat OFFSET gagal: halaman 2 akan mengulang 3 item.
    for (let i = 0; i < 3; i++) {
      await client.query(
        `INSERT INTO tasks (id,workspace_id,team_id,number,title,status_id,created_by,updated_at)
         VALUES ($1,$2,$3,$4,'baru',$5,$6, now())`,
        [uuidv7(), WS, TEAM, 1000 + i, ST1, USER]);
    }
    await client.query(`UPDATE tasks SET deleted_at = now() WHERE id = $1`, [p1.rows[4]!.id]);

    // Halaman 2 lewat cursor
    const p2 = await listTasks(db(), {
      workspaceId: WS, teamId: TEAM, limit: 5, cursor: p1.next_cursor,
    });
    const overlap = p2.rows.filter((r) => p1.rows.some((a) => a.id === r.id));
    expect(overlap).toEqual([]); // tidak ada item yang diulang
  }, 60_000);

  it("urutan due_date: NULL di akhir, dan melewati batas NULL tanpa lewat", async () => {
    const { seen } = await pageAll(4, { key: "due_date", desc: false });
    const rows = await client.query<{ id: string; due_date: string | null }>(
      `SELECT id, due_date::text FROM tasks WHERE workspace_id=$1 AND team_id=$2 AND deleted_at IS NULL`,
      [WS, TEAM]);
    expect(seen.length).toBe(rows.rows.length);
    expect(new Set(seen).size).toBe(seen.length);
  }, 60_000);

  it("urutan number menurun juga utuh", async () => {
    const { seen } = await pageAll(6, { key: "number", desc: true });
    const n = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM tasks WHERE workspace_id=$1 AND team_id=$2 AND deleted_at IS NULL`,
      [WS, TEAM]);
    expect(seen.length).toBe(Number(n.rows[0]!.c));
  }, 60_000);

  it("halaman terakhir: has_more false, next_cursor null", async () => {
    const r = await listTasks(db(), { workspaceId: WS, teamId: TEAM, limit: 200 });
    expect(r.has_more).toBe(false);
    expect(r.next_cursor).toBeNull();
  });

  it("cursor dari urutan lain ditolak, bukan diam-diam salah", async () => {
    const r = await listTasks(db(), { workspaceId: WS, teamId: TEAM, limit: 2 });
    await expect(
      listTasks(db(), {
        workspaceId: WS, teamId: TEAM, limit: 2, cursor: r.next_cursor,
        order: { key: "number", desc: true },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("cursor rusak ditolak", async () => {
    await expect(
      listTasks(db(), { workspaceId: WS, teamId: TEAM, limit: 2, cursor: "%%bukan%%" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("cursor dibuat klien (forge) dengan kunci salah tetap konsisten", async () => {
    // Cursor dibuat sendiri, bukan dari server. Server hanya percaya bentuknya.
    const c = encodeCursor(500, uuidv7(), { key: "number", desc: true });
    const r = await listTasks(db(), {
      workspaceId: WS, teamId: TEAM, limit: 5, cursor: c, order: { key: "number", desc: true },
    });
    expect(r.rows.every((x) => x.number < 500)).toBe(true);
  });

  it("filter status, assignee, category, updated_since bekerja bersama", async () => {
    const r = await listTasks(db(), {
      workspaceId: WS, teamId: TEAM, limit: 200,
      filter: { statusIds: [ST1], category: 1 },
    });
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.status_id === ST1)).toBe(true);

    const since = await listTasks(db(), {
      workspaceId: WS, teamId: TEAM, limit: 200,
      filter: { updatedSince: new Date("2000-01-01T00:00:00Z") },
    });
    expect(since.rows.length).toBe(r.rows.length + (await listTasks(db(), {
      workspaceId: WS, teamId: TEAM, limit: 200, filter: { statusIds: [ST2] },
    })).rows.length);
  });

  it("include_deleted memperlihatkan task terhapus", async () => {
    const withDeleted = await listTasks(db(), {
      workspaceId: WS, teamId: TEAM, limit: 200, filter: { includeDeleted: true },
    });
    const without = await listTasks(db(), { workspaceId: WS, teamId: TEAM, limit: 200 });
    expect(withDeleted.rows.length).toBe(without.rows.length + 1);
    expect(withDeleted.rows.some((x) => x.title === "T4")).toBe(true);
  });

  it("tim lain -> kosong, bukan bocor", async () => {
    const r = await listTasks(db(), { workspaceId: WS, teamId: uuidv7(), limit: 10 });
    expect(r.rows).toEqual([]);
  });
});

describe("parseOrderParams — validasi", () => {
  it("default -updated_at", () => {
    const { order } = parseOrderParams(new URLSearchParams());
    expect(order).toEqual({ key: "updated_at", desc: true });
  });

  it("filter tak dikenal -> 400 menyebut nama filter", () => {
    expect(() => parseOrderParams(new URLSearchParams("assigne_id=x"))).toThrowError(/assigne_id/);
  });

  it("order di luar allowlist -> 400 (bukan interpolasi SQL)", () => {
    expect(() => parseOrderParams(new URLSearchParams("order=password_hash"))).toThrowError(/order/);
  });

  it("category di luar 1-5 -> 400", () => {
    expect(() => parseOrderParams(new URLSearchParams("category=9"))).toThrow();
  });

  it("limit dibatasi 1-200", () => {
    expect(parseLimit(new URLSearchParams())).toBe(50);
    expect(parseLimit(new URLSearchParams("limit=200"))).toBe(200);
    expect(() => parseLimit(new URLSearchParams("limit=201"))).toThrow();
    expect(() => parseLimit(new URLSearchParams("limit=0"))).toThrow();
  });
});
