/**
 * Bentuk klien SQL yang diterima lapisan data.
 *
 * KENAPA TIPE SENDIRI, BUKAN `Client` DARI `pg` (T-49):
 * sebelumnya setiap fungsi di sini menuntut `Client` — tipe yang membawa ~30
 * properti koneksi (port, host, ssl, pipeline, ...). Akibatnya tidak ada
 * implementasi lain yang bisa dipakai: `PoolClient`, `Pool`, adaptor PGlite,
 * dan pool tiruan semuanya ditolak oleh TypeScript walaupun secara perilaku
 * setara. Yang benar-benar dipakai fungsi-fungsi ini hanya `query`, jadi
 * itulah yang ditipekspos. Hasilnya: kode produksi bisa memakai `Pool`
 * (satu koneksi per request, dikembalikan setelahnya) tanpa satu pun perubahan
 * di dalam `@kelindan/db`, dan uji tetap memakai PGlite.
 */
export interface SqlClient {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}
