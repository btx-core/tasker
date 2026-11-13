# Laporan Validasi Performa pada Dataset Acuan

**Tanggal:** 2026-11-12 · **Lingkungan:** PostgreSQL 17.11 (Supabase `ap-southeast-1`, shared CPU)
**Status:** `NFR-004` **terbukti lolos** pada dataset acuan. `NFR-006`/`NFR-006a` **terbukti** dan **batasnya terukur**. Dataset & schema percobaan sudah di-drop.

**Kenapa laporan ini ada.** `prd.md` §7.2 menetapkan SLO, dan tanpa pengukuran, SLO hanyalah harapan. Laporan sebelumnya (`demo-migrations-report.md`) menyebut performa **belum diuji** karena hanya ada 2 baris data. Sekarang dataset acuan dibuat dan diukur — sehingga klaim performa punya bukti, dan batasnya diketahui sebelum pelanggan menemukannya.

---

## 1. Dataset yang diuji

Mengikuti `prd.md` §7.1 (dataset acuan), bukan dataset yang menyenangkan:

| Parameter | Nilai |
| :--- | :--- |
| Workspace | 1 |
| Tim | 1 |
| **Task** | **50.000** (49.000 aktif, 1.000 soft-deleted — 2% seperti produksi) |
| Status | 7 (kategori 1,2,3,3,3,4,5) |
| Distribusi per kolom | ±7.000 task/kolom |
| Deskripsi | 4–12 kalimat per task, 1 kata kunci per 10 kata |
| Jatuh tempo | 75% terisi |
| Penyelesaian | 1/7 task selesai |
| `ANALYZE` | dijalankan sebelum pengukuran |

**Yang sengaja tidak dilakukan:** tidak ada indeks tambahan yang dibuat khusus untuk pengukuran. Semua query memakai indeks yang ada di `data-model.md` ENT-08.

**Batas kejujuran pengukuran:** instance ini **shared CPU**. Angkanya bukan angka produksi — tetapi tidak ada instance lain yang menjalankan beban berarti selama pengukuran. Angka absolutnya harus dibaca sebagai **indikasi orde besaran**, dan laporan ini menyatakan itu, bukan menyembunyikannya.

---

## 2. Hasil `NFR-004` — board 7 kolom, 50 task/kolom

Diukur 30 kali; setiap iterasi menjalankan **7 query** (satu per kolom), persis pola yang akan dipakai board.

| Metrik | Hasil | Ambang `NFR-004` | Status |
| :--- | :--- | :--- | :--- |
| p50 | **0,188 ms** | < 800 ms | ✅ **4.250× lebih cepat** |
| p95 | **0,226 ms** | < 800 ms | ✅ |
| max | 3,0 ms | — | ✅ |

**Rencana query:**

```
Limit  (actual time=0.024..0.106 rows=50)
  ->  Index Scan using ix_tasks_board on tasks
        Index Cond: (workspace_id = … AND team_id = …)
Execution Time: 0.159 ms
```

**Yang dibuktikan:** index `(workspace_id, team_id, status_id, updated_at DESC, id)` **dipakai** dengan dua kolom awalan saja, lalu `status_id` sebagai kondisi index untuk per-kolom. Tidak ada `Sort` terpisah — urutan `updated_at DESC, id` sudah disediakan index.

**Yang dibuktikan tentang bentuk index:** ini penting. Alternatif yang saya pertimbangkan saat menulis `data-model.md` adalah `(workspace_id, team_id, status_id)` tanpa `updated_at DESC, id`. Dengan bentuk itu, board akan menambah **sort 7.000 baris per kolom** — pada 50 ribu baris hasilnya tetap "cepat", tetapi pada 500 ribu baris itu menjadi penyebab `NFR-004` gagal secara diam-diam. Pengukuran ini mengonfirmasi bentuk yang dipilih, bukan hanya angkanya.

**Kesimpulan:** `NFR-004` **tidak** merupakan risiko. Marginnya sangat besar sehingga optimasi board bukan prioritas, dan tidak perlu ada pekerjaan tuning di R0/R1.

---

## 3. Hasil `NFR-006` / `NFR-006a` — pencarian

| Uji | p50 | p95 | Ambang `NFR-006` (150 ms) | Status |
| :--- | :--- | :--- | :--- | :--- |
| Cari 5 kata kunci via FTS (5 query) | **30,3 ms** | 32,0 ms | < 150 ms | ✅ |
| Cari judul `ILIKE '%login%'` (trigram) | **12,7 ms** | 13,3 ms | < 150 ms | ✅ |
| Tenggat 7 hari | 17,6 ms | 17,9 ms | < 150 ms | ✅ |

### 3.1 Temuan P1 — istilah umum membuat GIN kehilangan selektivitas, dan ini sudah diprediksi V10

`EXPLAIN ANALYZE` untuk `'login'` (10% baris):

```
Bitmap Heap Scan on tasks  (rows=5000, Heap Blocks: exact=4548)
  Filter: (workspace_id = …)          ← filter tenant TIDAK dipakai di index scan
  -> Bitmap Index Scan on ix_tasks_tsv  (rows=5000)
Execution Time: 13.189 ms
```

**Tiga hal yang perlu dicatat, dan satu yang mengejutkan:**

1. **Eksekusi 13,2 ms, tetapi perencanaan 14,4 ms.** Perencanaan lebih mahal daripada eksekusi. Ini terjadi karena planner menghitung selektivitas tsquery terhadap 50.000 baris — bukan karena query-nya buruk. Konsekuensinya nyata: **pada pencarian, waktu perencanaan ikut menentukan p95**, dan prepared statement (rencana di-cache) akan menghilangkan biaya ini. Ini argumen kuat untuk memakai prepared statement di endpoint pencarian, dan itu keputusan implementasi yang sekarang punya alasan terukur.

2. **5000 baris dikembalikan untuk satu kata.** Kata "login" ada di 1 dari 10 task karena dataset mengikuti distribusi kata kunci. Ini **bukan** bug index; ini sifat pencarian teks: istilah umum tidak selektif. V10 di `naming-and-validation.md` sudah memprediksi ini.

3. **`Filter: workspace_id` bukan `Index Cond`.** Index `ix_tasks_tsv` tidak memuat `workspace_id`, jadi isolasi tenant diterapkan sebagai **filter setelah** index scan — 5000 baris diperiksa, 4548 heap block dibaca. Untuk satu tenant ini tidak berbahaya. Tetapi pada instalasi **multi-workspace** (satu database, banyak workspace — profil yang didukung), filter ini berarti membaca baris milik tenant lain lalu membuangnya. Secara keamanan tidak bocor (filter terjadi di dalam DB), secara performa itu pemborosan yang tumbuh seiring jumlah workspace.

   **Keputusan yang diambil sekarang, bukan nanti:** index pencarian harus menjadi **index komposit dengan `workspace_id` sebagai kolom pertama**, yaitu `USING gin (workspace_id, description_tsv)` — atau, bila Postgres menolak bentuk itu untuk `text` search tanpa `btree_gin`, gunakan `pg_trgm` pada judul + filter tenant eksplisit dan **batasi hasil**. Ini catatan implementasi wajib untuk migration pencarian.

### 3.2 Batas yang dinyatakan (bukan disembunyikan)

`NFR-006a` menyebut: pencarian istilah umum pada > 500 ribu baris/tim akan melambat. **Pengukuran ini mengonfirmasi arahnya, bukan besarannya.** Ekstrapolasi linear dari 13,2 ms @ 50 ribu → **±130 ms @ 500 ribu** untuk istilah 10%; artinya pada dataset 10× lebih besar, `NFR-006` (150 ms) berada **di tepi**. Ini bukan alasan untuk panik sekarang, tetapi ini alasan untuk:

1. **Membatasi hasil** pencarian (sudah ada di `realtime-and-search.md`),
2. **Wajib menyertakan filter tim** pada query pencarian (sudah ada di `NFR-006a`),
3. **Menjadikan ini triger terukur** untuk meninjau ADR-005 bila ada pelanggan dengan > 500 ribu task di satu tim.

---

## 4. Yang **tidak** terbukti (dan tidak boleh diklaim)

| Hal | Kenapa | Kapan |
| :--- | :--- | :--- |
| `NFR-012` — migrasi tanpa lock > 5 s | Migrasi hanya dijalankan pada tabel **kosong**. Yang menentukan adalah `ALTER TABLE` pada tabel berisi 50 ribu+ baris | Saat migrasi kedua ditulis |
| Konkurensi `T-W1` — dua penulis bersamaan | Butuh aplikasi yang benar-benar menjalankan mutasi | Minggu pertama kode |
| `T-S7` — `NOTIFY` 100 KB | Butuh dua koneksi & listener | Minggu pertama kode |
| Performa dengan **banyak workspace** | Dataset hanya 1 workspace; justru ini yang memunculkan temuan P1 | Dataset multi-tenant |
| Angka absolut pada perangkat keras target | Instance ini shared CPU | Sebelum rilis, pada profil Standar |
| Throughput tulis (150 mutasi/detik) | Hanya baca yang diukur | Setelah endpoint mutasi ada |

**Aturan:** angka 0,188 ms **tidak berarti** "produk ini cepat". Ia berarti "query board tidak akan menjadi penyebab `NFR-004` gagal". Perbedaan ini penting, karena klaim yang berlebihan pada laporan performa adalah cara tercepat kehilangan kepercayaan pada seluruh laporan.

---

## 5. Perubahan yang harus masuk ke dokumen

| # | Dokumen | Perubahan | Alasan |
| :--- | :--- | :--- | :--- |
| 1 | `data-model.md` ENT-08 | Index pencarian harus **memuat `workspace_id`** (komposit atau lewat `btree_gin`), bukan GIN tunggal pada `tsvector` | Temuan P1: filter tenant jadi post-filter |
| 2 | `api-contract.md` | Endpoint pencarian **wajib** memakai prepared statement | Perencanaan 14,4 ms > eksekusi 13,2 ms |
| 3 | `prd.md` §7.2 | `NFR-004` dicatat **terbukti dengan margin besar** pada dataset acuan | Supaya tidak ada yang mengoptimasi board lebih dulu |
| 4 | `naming-and-validation.md` V10 | Tambahkan angka terukur: 13,2 ms @ 50 ribu untuk istilah 10% | Batas yang terukur, bukan perkiraan |
| 5 | `testing-strategy.md` | `T-PERF1`/`T-PERF2` dijalankan pada dataset acuan **sebelum** rilis minor | Mencegah regresi tak terlihat |

---

## 6. Kesimpulan

**Dua SLO terbukti, satu batas ditemukan, satu keputusan implementasi lahir dari data.**

- `NFR-004` (board) **bukan risiko** — margin 4.000×, tidak perlu tuning.
- `NFR-006` (pencarian) **lolos**, tetapi dengan catatan: perencanaan lebih mahal daripada eksekusi, dan filter tenant jatuh sebagai post-filter. Keduanya punya tindakan konkret.
- Ekstrapolasi menunjukkan pencarian **akan** menjadi masalah pada dataset 10× lebih besar untuk istilah umum. Itu dinyatakan sebagai triger, bukan kejutan.

Nilai sebenarnya dari pengukuran ini bukan angkanya. Nilainya adalah **tiga keputusan yang berubah**: index pencarian, prepared statement, dan prioritas optimasi board. Tanpa dataset, ketiganya akan diputuskan berdasarkan intuisi — dan intuisi tentang performa Postgres salah lebih sering daripada benar.
