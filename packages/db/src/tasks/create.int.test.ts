/**
 * Uji pembuatan task pada PostgreSQL sungguhan (PGlite).
 * Fokus: penomoran ENG-* tidak pernah terbit ganda (UNIQUE + blok).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createTask } from "@kelindan/db";
import { uuidv7, TEAM_ROLE, type Actor } from "@kelindan/shared";
import { createTestClient, applyMigrations, type ClientLike } from "@kelindan/testing";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const WS = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const TEAM2 = "0190f000-0000-7000-8000-0000000000c2";
const USER = "0190f000-0000-7000-8000-0000000000a1";

let client: ClientLike;
const actor: Actor = { userId: USER, workspaceId: WS, teamRole: TEAM_ROLE.MEMBER };
const create = (teamId: string, title: string, blockSize?: number) =>
  createTask(client as unknown as Client, {
    actor, teamId, title,
    ...(blockSize !== undefined ? { blockSize } : {}),
  });

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);
  await client.query(`INSERT INTO workspaces (id,name,slug) VALUES ($1,'Ruang','ruang-kerja')`, [WS]);
  await client.query(`INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A')`, [USER]);
  await client.query(
    `INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,1)`, [uuidv7(), WS, USER]);
  await client.query(
    `INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG'),($3,$2,'DSN','DSN')`,
    [TEAM, WS, TEAM2]);
  for (const t of [TEAM, TEAM2]) {
    await client.query(
      `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
       VALUES ($1,$2,$3,'Antrean',1,0,true)`, [uuidv7(), WS, t]);
  }
});

describe("createTask pada PostgreSQL nyata", () => {
  it("membuat task dengan nomor 1 dan status default", async () => {
    const t = await createTask(client as unknown as Client, {
      actor, teamId: TEAM, title: "Task pertama",
    });
    expect(Number(t.number)).toBe(1);
    expect(t.status_id).toBeTruthy();
    expect(t.workspace_id).toBe(WS);
  });

  it("nomor berurutan dalam satu blok", async () => {
    const a = await create(TEAM2, "Dua", 20);
    const b = await create(TEAM2, "Tiga", 20);
    expect(Number(b.number) - Number(a.number)).toBe(1);
  });

  it("blok baru dipesan saat blok lama habis; tidak ada nomor ganda", async () => {
    const other = "0190f000-0000-7000-8000-0000000000c9";
    await client.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'OPS','OPS')`, [other, WS]);
    await client.query(
      `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
       VALUES ($1,$2,$3,'Antrean',1,0,true)`, [uuidv7(), WS, other]);

    const numbers = new Set<number>();
    for (let i = 0; i < 45; i++) {
      const t = await create(other, `T${i}`, 10); // blok 10 -> 5 blok
      numbers.add(Number(t.number));
    }
    expect(numbers.size).toBe(45); // tidak ada duplikat
    const max = Math.max(...numbers);
    expect(max).toBeLessThanOrEqual(50); // 45 nomor dari 5 blok x 10
  }, 120_000);

  it("nomor tidak terbit ganda antar tim (tiap tim punya counter sendiri)", async () => {
    const rows = await client.query<{ team_id: string; number: string }>(
      "SELECT team_id, number FROM tasks");
    const perTeam = new Map<string, Set<string>>();
    for (const r of rows.rows) {
      const set = perTeam.get(r.team_id) ?? new Set<string>();
      expect(set.has(r.number)).toBe(false);
      set.add(r.number);
      perTeam.set(r.team_id, set);
    }
    expect(perTeam.size).toBeGreaterThan(1);
  });

  it("tim workspace lain -> 404, bukan membuat task", async () => {
    await expect(
      createTask(client as unknown as Client, {
        actor: { ...actor, workspaceId: "0190f000-0000-7000-8000-0000000000ff" },
        teamId: TEAM, title: "curang",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("viewer tidak boleh membuat task (403)", async () => {
    await expect(
      createTask(client as unknown as Client, {
        actor: { ...actor, teamRole: TEAM_ROLE.VIEWER }, teamId: TEAM, title: "viewer",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
