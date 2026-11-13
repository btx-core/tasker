/**
 * Sambungan ke PostgreSQL SUNGGUHAN (bukan PGlite).
 *
 * KENAPA INI ADA: PGlite adalah PostgreSQL WASM yang berjalan di dalam satu
 * proses dengan SATU koneksi. Itu cukup untuk membuktikan SQL, tetapi tidak
 * bisa membuktikan apa pun tentang DUA penulis bersamaan — dan justru itu yang
 * dijanjikan `write.ts` (ADR-015) serta `LISTEN/NOTIFY` (ADR-006).
 *
 * Uji yang memakai berkas ini DILEWATI (dengan alasan tercetak) bila
 * `KELINDAN_PG_URL` tidak diset. Dilewati secara eksplisit, bukan hijau palsu.
 */
import { Client } from "pg";

export const REAL_PG_URL = process.env["KELINDAN_PG_URL"] ?? null;

export function hasRealPg(): boolean {
  return REAL_PG_URL !== null && REAL_PG_URL.length > 0;
}

/** Alasan dilewati, supaya laporan uji TIDAK terlihat hijau tanpa alasan. */
export const SKIP_REASON =
  "butuh PostgreSQL jaringan: set KELINDAN_PG_URL=postgres://user@host:5432/db " +
  "(dua koneksi simultan tidak bisa disimulasikan PGlite)";

export async function connect(url: string = REAL_PG_URL!): Promise<Client> {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

export interface FreshSchema {
  client: Client;
  schema: string;
  drop: () => Promise<void>;
}

/**
 * Skema sekali-pakai: uji konkurensi mengotori database, dan database bersama
 * yang kotor membuat kegagalan berikutnya tidak bisa dipercaya. Skema di-drop
 * setelah uji — sama seperti kebijakan skema percobaan di dokumen.
 */
export async function freshSchema(name = "kelindan_it"): Promise<FreshSchema> {
  const client = await connect();
  await client.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
  await client.query(`CREATE SCHEMA ${name}`);
  await client.query(`SET search_path TO ${name}, public`);
  return {
    client,
    schema: name,
    async drop() {
      await client.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`).catch(() => {});
      await client.end().catch(() => {});
    },
  };
}
