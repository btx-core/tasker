# Uji pada PostgreSQL Sungguhan

**Status:** `T-W1`/`T-W2` (konkurensi), `T-16` (WebSocket server), dan `T-17`
(`LISTEN`/`NOTIFY` lintas proses) **tertutup** — dibuktikan pada PostgreSQL 18.6
yang benar-benar berjalan, bukan disimulasikan.

## Kenapa dua lapis pengujian

| Lapis | Alat | Membuktikan | Tidak membuktikan |
| :--- | :--- | :--- | :--- |
| Cepat (default `npm test`) | PGlite (PostgreSQL WASM, satu koneksi) | Bentuk SQL, constraint, trigger, bentuk respons | **Apa pun tentang dua penulis bersamaan** |
| Jaringan (`npm run test:realpg`) | PostgreSQL 18.6 asli | Konkurensi, `FOR UPDATE`, `LISTEN`/`NOTIFY`, soket WebSocket | — |

PGlite bukan pengganti yang lebih murah dari PostgreSQL; ia **berbeda kelas**.
Satu koneksi berarti `BEGIN`/`COMMIT` tidak pernah berlomba, sehingga seluruh
kelas bug konkurensi tidak terlihat. Itu bukan teori: begitu dua koneksi
benar-benar ada, **dua bug nyata langsung muncul** (T-22, T-21).

## Menjalankan

```bash
npm run pg:up       # unduh + jalankan PostgreSQL 18.6 di 127.0.0.1:5432
npm run test:realpg # 11 uji konkurensi + soket
```

`npm run pg:up` **tidak** butuh Docker, root, atau Postgres sistem. Ia
mengunduh `embedded-postgres` (pip) yang membawa binari lengkap termasuk
`citext` dan `pg_trgm`.

## Uji yang dilewati itu disengaja

Tanpa `KELINDAN_PG_URL`, 13 uji **dilewati dengan alasan yang tercetak ke
laporan**:

> butuh PostgreSQL jaringan: set `KELINDAN_PG_URL=postgres://user@host:5432/db`

Yang **tidak** kami lakukan: membuatnya "lulus" ketika database tidak ada.
Uji yang hijau tanpa menjalankan apa pun lebih berbahaya daripada uji yang
dilewati dengan alasan, karena ia menghapus alasan untuk memeriksa.

## Apa yang dibuktikan, tepatnya

| Uji | Hasil |
| :--- | :--- |
| `expected_version` sebagai penjaga seluruh entitas | 2 penulis bersamaan → tepat **1 menang, 1 dapat 409** |
| Dua patch beda field **tanpa** `expected_version` | Keduanya bertahan; versi +2 |
| 20 PATCH bersamaan | **20/20** perubahan bertahan; ≥20 event tercatat |
| 20 `createTask` bersamaan | **20/20**; nol nomor ganda |
| Idempotensi bersamaan, kunci sama | Tepat **1** baris `idempotency_keys` |
| WebSocket tanpa sesi | **401 sebelum upgrade** |
| `pg_notify` → klien WebSocket | Frame `delta_batch` diterima, `team_id` benar |
| NOTIFY sebagai pointer | Deskripsi 100 KB **tidak** masuk NOTIFY; frame < 4 KB |
| Klien tim lain | **Tidak** menerima delta apa pun |

## Batas yang tetap terbuka

- **Jadwal pencabutan** (`team_members` dicabut → `revokeTeam`) belum ada, jadi
  klaim "pencabutan < 5 s" (`TC-15`) **belum diukur**. `revokeTeam()` sudah
  terbukti bekerja; yang belum adalah pemicunya.
- Uji konkurensi memakai **20 koneksi**; angka itu dipilih agar cepat, bukan
  sebagai batas kapasitas.
- Database uji adalah instance lokal tanpa replika; kesimpulan tentang
  failover tidak bisa diambil dari sini.
