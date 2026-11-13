import { readFile } from "node:fs/promises";
import type { ClientLike } from "./pglite-adapter.js";

/**
 * Bentuk klien SQL minimal. SENGAJA diduplikasi di sini, bukan diimpor dari
 * `@kelindan/db`: `@kelindan/testing` dipakai uji SELURUH paket, dan
 * ketergantungan ke paket data akan membuat graf impor melingkar.
 */
export interface SqlClient {
  query<R = Record<string, unknown>>(
    sql: string, params?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

/** Terapkan migrasi repo berurutan (untuk uji; BUKAN runner produksi). */
/**
 * Menerima `ClientLike` MAUPUN `SqlClient` (`pg.Client`/`pg.Pool`).
 *
 * KENAPA: `applyMigrations` dipakai di uji DAN di `dev-server` yang kini bisa
 * memakai `pg.Pool` (T-49). Menuntut `ClientLike` memaksa pemanggil melakukan
 * cast yang menyembunyikan ketidakcocokan `rowCount` (`pg` mengembalikan
 * `null` untuk perintah tanpa baris). Satu tipe untuk keduanya lebih jujur.
 */
export async function applyMigrations(client: ClientLike | SqlClient, dir: string, to = 99): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  let n = 0;
  for (const f of files) {
    const version = Number(f.slice(0, 4));
    if (version > to) break;
    const sql = await readFile(`${dir}/${f}`, "utf8");
    const body = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    for (const stmt of splitStatements(body)) {
      await client.query(stmt);
    }
    applied.push(f);
    n++;
  }
  if (n === 0) throw new Error("tidak ada migrasi ditemukan di " + dir);
  return applied;
}

/** Pisahkan SQL menjadi statement; aman terhadap $$ ... $$ dan kutip tunggal. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let dollar: string | null = null;
  let inSquote = false;

  while (i < sql.length) {
    const ch = sql[i]!;
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        buf += dollar;
        i += dollar.length;
        dollar = null;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }
    if (inSquote) {
      buf += ch;
      if (ch === "'") inSquote = false;
      i++;
      continue;
    }
    if (ch === "'") {
      inSquote = true;
      buf += ch;
      i++;
      continue;
    }
    if (ch === "$") {
      const m = /^\$[a-zA-Z_]*\$/.exec(sql.slice(i));
      if (m) {
        dollar = m[0];
        buf += dollar;
        i += dollar.length;
        continue;
      }
    }
    if (ch === ";") {
      const s = buf.trim();
      if (s) out.push(s);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const last = buf.trim();
  if (last) out.push(last);
  return out;
}
