#!/usr/bin/env node
/**
 * CLI migrasi. `node --experimental-strip-types packages/db/src/cli.ts migrate [--dry-run]`
 */
import { Client } from "pg";
import { migrate } from "./migrator.js";

const dir = new URL("../migrations/", import.meta.url).pathname;
const schema = process.env.DB_SCHEMA ?? "public";
const dryRun = process.argv.includes("--dry-run");

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  // Migrasi memakai koneksi LANGSUNG, bukan pooler (ADR-020, migrations.md §5).
  ...(process.env.PGSSLMODE === "require" ? { ssl: { rejectUnauthorized: false } } : {}),
});

try {
  await client.connect();
  const res = await migrate(client, {
    dir,
    schema,
    apply: !dryRun,
    log: (l) => console.log(l),
  });

  console.log(`\nRencana migrasi (schema: ${schema}):`);
  for (const p of res.plan) {
    const mark = p.status === "applied" ? "terpasang" : "menunggu ";
    console.log(`  ${String(p.version).padStart(4, "0")} ${mark} ${p.name}`);
  }
  if (res.dryRun) {
    console.log(`\nDry-run: tidak ada yang diterapkan.`);
  } else if (res.applied.length === 0) {
    console.log(`\nTidak ada migrasi baru. Skema sudah mutakhir.`);
  } else {
    console.log(`\n${res.applied.length} migrasi diterapkan.`);
  }
} catch (err) {
  console.error(`\nGAGAL: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
