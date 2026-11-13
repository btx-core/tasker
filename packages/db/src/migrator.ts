/**
 * Runner migrasi. Perilaku DITETAPKAN di migrations.md §8:
 *  preflight -> lock -> verifikasi checksum -> eksekusi -> catat -> integritas.
 *
 * Runner adalah perintah CLI, BUKAN proses otomatis saat start.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SqlClient } from "./client.js";

export interface MigrationFile {
  version: number;
  name: string;
  fileName: string;
  sql: string;
  checksum: string;
  header: MigrationHeader;
}

export interface MigrationHeader {
  migration: string;
  intent: string;
  reversible: "yes" | "no";
  locks: "none" | "brief" | "long";
  transaction: "yes" | "no";
  estDuration: string;
  backfill: string;
  docs: string;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

const HEADER_FIELDS = [
  "migration",
  "intent",
  "reversible",
  "locks",
  "transaction",
  "est_duration",
  "backfill",
  "docs",
] as const;

export function parseHeader(sql: string, fileName: string): MigrationHeader {
  const found: Record<string, string> = {};
  for (const line of sql.split("\n").slice(0, 30)) {
    const m = /^--\s*([a-z_]+):\s*(.+?)\s*$/.exec(line.trim());
    if (m) found[m[1]!] = m[2]!;
  }
  const missing = HEADER_FIELDS.filter((f) => !found[f]);
  if (missing.length > 0) {
    throw new MigrationError(
      `${fileName}: header wajib belum lengkap: ${missing.join(", ")} (migrations.md §3)`,
    );
  }
  if (!["yes", "no"].includes(found.reversible!)) {
    throw new MigrationError(`${fileName}: -- reversible harus yes|no`);
  }
  if (found.transaction === "no" && found.locks === "long") {
    throw new MigrationError(`${fileName}: -- transaction: no tidak boleh dengan locks: long`);
  }
  return {
    migration: found.migration!,
    intent: found.intent!,
    reversible: found.reversible as "yes" | "no",
    locks: found.locks as MigrationHeader["locks"],
    transaction: found.transaction as "yes" | "no",
    estDuration: found.est_duration!,
    backfill: found.backfill!,
    docs: found.docs!,
  };
}

export function checksum(sql: string): string {
  // Normalisasi akhir-baris agar checksum tidak bergantung pada CRLF.
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const out: MigrationFile[] = [];
  const seen = new Set<number>();

  for (const fileName of files) {
    const m = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(fileName);
    if (!m) {
      throw new MigrationError(
        `${fileName}: nama berkas harus NNNN_kata_kerja_objek.sql (migrations.md §2)`,
      );
    }
    const version = Number(m[1]);
    const name = m[2]!;
    if (seen.has(version)) {
      throw new MigrationError(`nomor migrasi ganda: ${version} (${fileName})`);
    }
    seen.add(version);

    const sql = await readFile(join(dir, fileName), "utf8");
    out.push({
      version,
      name,
      fileName,
      sql,
      checksum: checksum(sql),
      header: parseHeader(sql, fileName),
    });
  }

  // Nomor harus berurutan tanpa celah (migrations.md §2).
  for (let i = 0; i < out.length; i++) {
    const expected = i === 0 ? out[0]!.version : out[i - 1]!.version + 1;
    if (out[i]!.version !== expected) {
      throw new MigrationError(
        `celah nomor migrasi: setelah ${expected - 1} ada ${out[i]!.version} (${out[i]!.fileName})`,
      );
    }
  }
  return out;
}

export interface AppliedRow {
  version: number;
  name: string;
  checksum: string;
}

export interface PreflightResult {
  ok: true;
  serverVersion: string;
  extensionSchemas: Record<string, string>;
  searchPath: string[];
}

/**
 * Preflight. Temuan T1 (demo-migrations-report.md): memeriksa KEBERADAAN
 * ekstensi tidak cukup - schema tempatnya harus diketahui dan dimasukkan ke
 * search_path. Tanpa ini, instalasi yang seharusnya berhasil gagal dengan
 * "type citext does not exist".
 */
export async function preflight(
  client: SqlClient,
  requiredExtensions: readonly string[],
): Promise<PreflightResult> {
  // BUG YANG DITEMUKAN UJI INTEGRASI: `SHOW server_version` mengembalikan
  // kolom bernama `server_version`, bukan `v`. Kode lama membaca `rows[0].v`
  // -> undefined -> `.split` melempar TypeError. Ini akan gagal pada Postgres
  // sungguhan mana pun. `current_setting()` lebih dapat diandalkan karena
  // nama kolomnya kita sendiri yang menentukan.
  const ver = await client.query<{ v: string }>(
    "SELECT current_setting('server_version') AS v",
  );
  const serverVersion = ver.rows[0]!.v;
  const major = Number(serverVersion.split(".")[0]);
  if (major < 16) {
    throw new MigrationError(
      `PostgreSQL ${serverVersion} tidak didukung. Minimum 16 (ADR-018).`,
    );
  }

  const ext = await client.query<{ extname: string; nspname: string }>(
    `SELECT e.extname, n.nspname
       FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace`,
  );
  const extensionSchemas: Record<string, string> = {};
  for (const r of ext.rows) extensionSchemas[r.extname] = r.nspname;

  const missing = requiredExtensions.filter((e) => !(e in extensionSchemas));
  if (missing.length > 0) {
    throw new MigrationError(
      `ekstensi belum terpasang: ${missing.join(", ")}.\n` +
        `Pasang lebih dulu, mis.: CREATE EXTENSION IF NOT EXISTS ${missing[0]} WITH SCHEMA public;\n` +
        `(runner tidak memasangnya otomatis: memasang ekstensi butuh hak superuser, dan\n` +
        `kegagalannya harus terlihat sebagai kegagalan instalasi, bukan kegagalan migrasi.)`,
    );
  }

  const sp = await client.query<{ sp: string }>(
    "SELECT current_setting('search_path') AS sp",
  );
  const searchPath = (sp.rows[0]!.sp ?? "").split(",").map((s: string) => s.trim());

  // Schema ekstensi yang dipakai tipe harus terjangkau search_path.
  const needed = new Set(Object.values(extensionSchemas));
  const unreachable = [...needed].filter((s) => s !== "pg_catalog" && !searchPath.includes(s));
  if (unreachable.length > 0) {
    throw new MigrationError(
      `schema ekstensi tidak ada di search_path: ${unreachable.join(", ")}.\n` +
        `Set search_path ke "${[...searchPath, ...unreachable].join(", ")}" atau\n` +
        `pindahkan ekstensi ke schema yang sudah terjangkau. Ini persis kegagalan T1.`,
    );
  }

  return { ok: true, serverVersion, extensionSchemas, searchPath };
}

export interface MigrateOptions {
  dir: string;
  /** Schema tempat tabel aplikasi dibuat. */
  schema: string;
  apply: boolean;
  log?: (line: string) => void;
}

export interface MigratePlanRow {
  version: number;
  name: string;
  status: "pending" | "applied" | "drift";
}

export interface MigrateResult {
  plan: MigratePlanRow[];
  applied: number[];
  dryRun: boolean;
}

const LOCK_KEY = 7_313_337; // advisory lock khusus runner

/**
 * Ekstensi yang BENAR-BENAR dibutuhkan skema. Daftar ini harus berubah hanya
 * bila migrasi memakai tipe/fungsi dari ekstensi tersebut.
 */
export const REQUIRED_EXTENSIONS = ["citext", "pg_trgm"] as const;

export async function migrate(client: SqlClient, opts: MigrateOptions): Promise<MigrateResult> {
  const log = opts.log ?? (() => {});
  const files = await loadMigrations(opts.dir);
  // pgcrypto TIDAK diminta: skema tidak memakainya (UUID dibuat aplikasi,
  // ADR-018; tidak ada gen_random_uuid/crypt di migrasi mana pun). Sempat
  // diminta, dan itu membuat instalasi tanpa pgcrypto gagal tanpa alasan
  // yang benar-benar dibutuhkan skema. Ditemukan oleh uji integrasi.
  const required = REQUIRED_EXTENSIONS;

  const pf = await preflight(client, required);
  log(`preflight: PostgreSQL ${pf.serverVersion}, ekstensi di ${JSON.stringify(pf.extensionSchemas)}`);

  const hasTable = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = 'schema_migrations') AS exists`,
    [opts.schema],
  );

  let applied: AppliedRow[] = [];
  if (hasTable.rows[0]!.exists) {
    const r = await client.query<AppliedRow>(
      `SELECT version, name, checksum FROM ${ident(opts.schema)}.schema_migrations ORDER BY version`,
    );
    applied = r.rows;
  }

  // ---- verifikasi checksum: migrasi tercatat tidak boleh berubah (M5) ----
  const byVersion = new Map(files.map((f) => [f.version, f]));
  for (const row of applied) {
    const f = byVersion.get(row.version);
    if (!f) {
      throw new MigrationError(
        `migrasi ${row.version} sudah diterapkan tetapi berkasnya hilang dari repo (${row.name})`,
      );
    }
    if (f.checksum !== row.checksum) {
      throw new MigrationError(
        `checksum migrasi ${row.version} (${f.fileName}) BERBEDA dari yang tercatat.\n` +
          `Migrasi yang sudah diterapkan tidak boleh diubah (M5). Perbaikan = migrasi baru.`,
      );
    }
  }

  const appliedVersions = new Set(applied.map((r) => r.version));
  const plan: MigratePlanRow[] = files.map((f) => ({
    version: f.version,
    name: f.name,
    status: appliedVersions.has(f.version) ? "applied" : "pending",
  }));

  const pending = files.filter((f) => !appliedVersions.has(f.version));
  if (!opts.apply) return { plan, applied: [], dryRun: true };
  if (pending.length === 0) return { plan, applied: [], dryRun: false };

  // ---- lock: koneksi langsung, bukan pooler (ADR-020) ----
  const lock = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [LOCK_KEY],
  );
  if (!lock.rows[0]!.locked) {
    throw new MigrationError(
      "runner lain sedang menjalankan migrasi (advisory lock gagal). Tunggu, bukan menjalankan paralel.",
    );
  }

  const done: number[] = [];
  try {
    await client.query(`SET search_path TO ${ident(opts.schema)}, public`);
    // lock_timeout & statement_timeout: gagal cepat daripada mengantre di belakang lock.
    await client.query(`SET lock_timeout = '3s'`);

    // Tabel pencatat dibuat runner, bukan oleh migrasi (migrations.md §8).
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${ident(opts.schema)}.schema_migrations (
        version      integer     NOT NULL,
        name         text        NOT NULL,
        checksum     text        NOT NULL,
        applied_at   timestamptz NOT NULL DEFAULT now(),
        duration_ms  integer     NOT NULL,
        app_version  text,
        CONSTRAINT pk_schema_migrations PRIMARY KEY (version),
        CONSTRAINT ck_schema_migrations_version CHECK (version >= 1),
        CONSTRAINT ck_schema_migrations_checksum CHECK (checksum ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_schema_migrations_duration CHECK (duration_ms >= 0)
      )`);

    for (const f of pending) {
      const t0 = performance.now();
      const inTx = f.header.transaction === "yes";
      try {
        if (inTx) await client.query("BEGIN");
        else await client.query(`SET statement_timeout = 0`);
        await client.query(f.sql);
        const ms = Math.round(performance.now() - t0);
        await client.query(
          `INSERT INTO ${ident(opts.schema)}.schema_migrations (version, name, checksum, duration_ms)
           VALUES ($1, $2, $3, $4)`,
          [f.version, f.name, f.checksum, ms],
        );
        if (inTx) await client.query("COMMIT");
        log(`  ${String(f.version).padStart(4, "0")} ${f.name} (${ms} ms)`);
        done.push(f.version);
      } catch (err) {
        if (inTx) await client.query("ROLLBACK").catch(() => {});
        throw new MigrationError(
          `migrasi ${f.version} (${f.fileName}) GAGAL: ${(err as Error).message}\n` +
            `Runner berhenti dan tidak melanjutkan ke migrasi berikutnya (migrations.md §8).`,
        );
      }
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => {});
  }

  return { plan, applied: done, dryRun: false };
}

/** Quote identifier dengan aman (schema/objek dari konfigurasi, bukan input pengguna). */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new MigrationError(`identifier tidak valid: ${name}`);
  return `"${name}"`;
}
