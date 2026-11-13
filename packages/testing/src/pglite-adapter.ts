/**
 * Adaptor minimal agar `pg.Client` bisa memakai PGlite (Postgres 18 di WASM).
 *
 * KENAPA ADA: sandbox pengembangan tidak dapat menjangkau port 5432 keluar
 * (temuan T-04), sehingga uji integrasi tidak bisa dijalankan terhadap
 * PostgreSQL jaringan. PGlite menjalankan PostgreSQL SUNGGAH di dalam proses,
 * jadi uji ini benar-benar mengeksekusi SQL pada server Postgres — bukan tiruan.
 *
 * BATAS KEJUJURAN: ini Postgres 18 (WASM, satu koneksi, tanpa pg_notify nyata
 * antar-proses). Uji ini membuktikan SQL & logika jalur tulis, TIDAK
 * membuktikan perilaku multi-koneksi/LISTEN-NOTIFY. Untuk itu tetap perlu
 * Postgres jaringan (lihat dokumen todo §10).
 */
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

export interface QueryResultLike {
  rows: unknown[];
  rowCount: number;
}

export interface ClientLike {
  /**
   * Meniru `pg.Client.query(sql)`:
   *  - TANPA parameter -> simple protocol (boleh banyak statement, dipakai runner)
   *  - DENGAN parameter -> extended protocol (satu statement saja)
   * Adaptor versi pertama selalu mengirim `[]`, sehingga migrasi multi-statement
   * ditolak PGlite dengan "cannot insert multiple commands into a prepared
   * statement" — perilaku yang TIDAK dimiliki `pg`. Itu artefak uji, bukan bug
   * runner, dan sudah diperbaiki di sini.
   */
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: R[]; rowCount: number }>;
}

export async function createTestClient(): Promise<ClientLike> {
  const db = await PGlite.create({ extensions: { citext, pg_trgm } });

  return {
    async query<R>(sql: string, params?: readonly unknown[]): Promise<{ rows: R[]; rowCount: number }> {
      // PGlite: tanpa params -> simple query (multi-statement), dengan params ->
      // extended query. Sama seperti `pg`, dan itulah yang diandalkan runner.
      // PGlite: `exec()` untuk blok multi-statement (simple protocol),
      // `query()` untuk satu statement berparameter. Ini padanan `pg`:
      // pg.Client mengirim simple query bila tidak ada parameter.
      if (params === undefined) {
        const all = await db.exec(sql);
        const lastRes = all[all.length - 1] as { rows?: R[]; affectedRows?: number } | undefined;
        const rows = (lastRes?.rows ?? []) as R[];
        return { rows, rowCount: lastRes?.affectedRows ?? rows.length };
      }
      const res = await db.query<R>(sql, params as unknown[] as never[]);

      const rows = (res.rows ?? []) as R[];
      /**
       * BUG YANG DIPERBAIKI: sebelumnya `rowCount: rows.length`. Untuk
       * `UPDATE`/`DELETE` TANPA `RETURNING`, `rows` selalu kosong — jadi
       * `rowCount` selalu 0, seberapa pun baris yang berubah. Itu bukan sekadar
       * angka salah: kode yang benar ("logout-all mencabut N sesi") tampak
       * rusak, dan sebaliknya kode yang lupa memeriksa sama sekali tidak
       * pernah terlihat.
       *
       * `pg` memberi `rowCount` sebenarnya; adaptor harus melakukan hal yang
       * sama, atau uji berbohong tentang perilaku produksi.
       */
      /**
       * JEBAKAN YANG SUDAH MENIPU SAYA: PGlite mengembalikan `affectedRows: 0`
       * untuk `SELECT` (bukan `undefined`), jadi `affectedRows ?? rows.length`
       * menghasilkan **0**, bukan jumlah baris. Itu membuat pemeriksaan
       * `rowCount === 0` pada SELECT berparameter — pola yang dipakai
       * `applyTaskPatch` untuk "task ada?" — menjawab "tidak ada" untuk task
       * yang ADA. Sembilan uji integrasi gagal dengan "Task tidak ditemukan",
       * padahal datanya benar.
       *
       * `pg` memberi `rowCount` = jumlah baris untuk SELECT dan jumlah baris
       * terpengaruh untuk UPDATE/DELETE. Jadi perilakunya ditentukan oleh
       * `command`, bukan oleh ada/tidaknya `affectedRows`.
       */
      const affected = typeof res.affectedRows === "number" ? res.affectedRows : undefined;
      const rowCount = res.command === "SELECT" || affected === undefined
        ? rows.length
        : affected;
      return { rows, rowCount };
    },
  };
}

export { };
