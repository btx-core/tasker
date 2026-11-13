/**
 * Uji integrasi runner pada Postgres nyata.
 * Dilewati bila DATABASE_URL tidak diset — CI tanpa DB tidak boleh gagal diam-diam,
 * jadi kita LAPORKAN bahwa ia dilewati.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { migrate } from "./migrator.js";

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

if (!url) {
  console.warn("[migrator.int.test] DILEWATI: DATABASE_URL tidak diset.");
}

const dir = new URL("../migrations/", import.meta.url).pathname;
const schema = "test_migrations";

run("migrate() pada Postgres nyata", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await client.query("CREATE EXTENSION IF NOT EXISTS citext");
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("menerapkan 21 migrasi, lalu jalan kedua = no-op", async () => {
    const first = await migrate(client, { dir, schema, apply: true });
    expect(first.applied.length).toBe(21);

    const second = await migrate(client, { dir, schema, apply: true });
    expect(second.applied.length).toBe(0);

    const t = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${schema}.schema_migrations`,
    );
    expect(t.rows[0]!.n).toBe("21");
  });

  it("dry-run tidak menerapkan apa pun", async () => {
    const res = await migrate(client, { dir, schema, apply: false });
    expect(res.dryRun).toBe(true);
    expect(res.applied.length).toBe(0);
  });
});
