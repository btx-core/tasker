#!/usr/bin/env node
/**
 * CLI migrasi. Dijalankan dari hasil build: `node packages/db/dist/cli.js migrate`.
 *
 * KENAPA BUKAN `--experimental-strip-types` PADA BERKAS .ts (dan ini ditemukan
 * saat menjalankan drill restore, bukan lewat tinjauan kode):
 * `strip-types` hanya MEMBUANG tipe; ia tidak menyelesaikan impor
 * `./migrator.js` ke `./migrator.ts`. Akibatnya `npm run migrate` selalu gagal
 * dengan ERR_MODULE_NOT_FOUND — skrip yang justru dipakai operator untuk
 * migrasi produksi. Dirunner dist tidak punya masalah itu, dan `npm run build`
 * sudah memverifikasi `dist/` benar-benar ada (T-28).
 */
/**
 * `pg` adalah CommonJS: `import { Client }` berhasil di bawah vitest tetapi
 * GAGAL di Node biasa ("Named export 'Client' not found"). Bug ini sudah
 * diperbaiki di `@kelindan/testing` (T-34) tetapi terlewat di sini — padahal
 * `cli.ts` adalah skrip yang dijalankan OPERATOR untuk migrasi produksi.
 */
import pg from "pg";
import { migrate } from "./migrator.js";

const { Client } = pg;

const dir = new URL("../migrations/", import.meta.url).pathname;
const schema = process.env.DB_SCHEMA ?? "public";
const dryRun = process.argv.includes("--dry-run");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Fail-fast dengan pesan yang bisa ditindaklanjuti. Tanpa ini, `pg` mencoba
  // menghubungi socket lokal dan operator melihat "ECONNREFUSED" yang
  // menyesatkan ke arah masalah jaringan.
  console.error("\nGAGAL: DATABASE_URL belum diisi.");
  console.error("Contoh: DATABASE_URL=postgres://postgres@127.0.0.1:5432/kelindan_test npm run migrate");
  process.exit(1);
}

const client = new Client({
  connectionString,
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
