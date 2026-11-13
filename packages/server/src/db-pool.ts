/**
 * Pemasangan `Deps.db` yang memakai `pg.Pool` (T-49).
 *
 * KENAPA BERKAS INI ADA: `Deps.db` dulu bertipe `() => Promise<Client>`, dan
 * satu-satunya cara memenuhinya adalah SATU koneksi untuk seluruh proses.
 * Pada beban nyata itu berarti setiap request menunggu request sebelumnya
 * selesai — bukan karena query lambat, tetapi karena tidak ada koneksi kedua.
 * Dengan `Pool`, request yang menunggu I/O tidak memblokir request lain.
 *
 * ANGKA YANG DIPILIH, dan alasannya:
 *  - `max: 10` per proses. PostgreSQL default `max_connections = 100`; dengan
 *    10 per instans, 8 instans masih menyisakan ruang untuk migrasi, monitoring,
 *    dan `pg_dump`. Angka ini juga menjaga PostgreSQL tetap ringan: setiap
 *    koneksi adalah proses OS.
 *  - `idleTimeoutMillis: 30_000` — koneksi menganggur dilepas, supaya biaya
 *    koneksi tidak dibayar saat trafik sepi (mis. malam hari).
 *  - `connectionTimeoutMillis: 5_000` — lebih cepat daripada batas kesabaran
 *    pengguna. Kalau pool penuh, lebih baik menjawab 503 `server.busy` dalam
 *    5 detik daripada menggantung 30 detik lalu gagal juga.
 *
 * CATATAN PENTING soal batas laju (T-32): pool menyelesaikan masalah koneksi
 * per instans, TIDAK menyelesaikan batas laju per proses. Dengan N instans,
 * batas laju efektif tetap N x 10/menit. Itu tetap terbuka.
 */
import pg from "pg";
import type { Deps } from "./http/routes.js";

export interface PoolOptions {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  /** Untuk Postgres terkelola (mis. Supabase) yang menuntut TLS. */
  ssl?: boolean;
}

export interface DbPool {
  deps: Pick<Deps, "db">;
  /** Untuk penutupan rapi saat proses berhenti. */
  end: () => Promise<void>;
  /** Diagnosa: jumlah koneksi terpakai/menganggur/menunggu. */
  stats: () => { total: number; idle: number; waiting: number };
}

export function createDbPool(opts: PoolOptions): DbPool {
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    idleTimeoutMillis: opts.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 5_000,
    ...(opts.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  /**
   * Galat pada koneksi MENGANGGUR tidak boleh mematikan proses.
   *
   * Tanpa handler ini, satu koneksi yang diputus server (restart database,
   * failover, atau batas idle di penyedia terkelola) memunculkan `error` yang
   * tidak tertangani — dan Node menghentikan seluruh proses. Itu berarti satu
   * restart database = semua request yang sedang berjalan hilang, padahal pool
   * bisa membuat koneksi baru sendiri.
   */
  pool.on("error", (err) => {
    console.error("[db] galat koneksi menganggur:", err.message);
  });

  return {
    deps: {
      // `PgPool` memenuhi `SqlClient` (hanya `query` yang dipakai lapisan data),
      // dan `withClient` memanggil `release` pada klien hasil `connect`.
      db: async () => {
        const c = await pool.connect();
        return c;
      },
    },
    end: () => pool.end(),
    stats: () => ({
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    }),
  };
}
