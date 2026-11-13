# Keputusan Nama & Validasi Skema

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Nama diputuskan · validasi skema sudah dijalankan terhadap PostgreSQL sungguhan

Dokumen ini menutup dua hal yang sebelumnya terbuka:
1. RK-10 di `prd.md` §10 — nama proyek yang bentrok.
2. Klaim skema di `data-model.md` yang sebelumnya hanya di atas kertas.

---

## 1. Nama proyek: **Kelindan**

### Keputusan

Nama proyek adalah **Kelindan**. Diambil dari bahasa Indonesia: benang yang **melilitkan** dua helai atau lebih menjadi satu ikatan yang lebih kuat — dipakai untuk menggambarkan hubungan yang saling terikat.

Alasan nama ini cocok, bukan sekadar enak didengar:

| Kriteria | Kenapa "Kelindan" |
| :--- | :--- |
| **Menyatakan inti produk** | Produk ini menyatukan tim Engineering dan non-Engineering dalam **satu** model kerja. "Kelindan" secara harfiah adalah tindakan menyatukan helai-helai menjadi satu ikatan. |
| **Tidak mendikte fitur** | Nama tidak mengunci produk ke "task/issue/board". Kalau R3 menambah kapasitas atau rilis, nama tidak salah. |
| **Tidak bentrok** | Tidak ada paket npm `kelindan` (404), pencarian GitHub atas nama `kelindan` menghasilkan hanya 2 repositori dan tidak ada di antaranya yang relevan. Bandingkan dengan "Tasker", yang sudah menjadi nama aplikasi Android populer — risiko kebingungan merek yang nyata. |
| **Bisa dieja & diingat** | Tiga suku kata, tanpa diakritik, bisa dieja dalam bahasa Indonesia maupun Inggris. |
| **Identitas lokal yang jujur** | Proyek ini ditulis dalam bahasa Indonesia untuk pasar Indonesia. Nama berbahasa Indonesia adalah pernyataan posisi, bukan kebetulan. |
| **Bisa jadi kata kerja** | "kelindan-kan", "terkelindan", "kelindan tim" — berguna untuk pesan UI dan dokumentasi. |

### Konsekuensi

- Semua dokumen di `docs/` sudah memakai "Kelindan".
- **Repo, branch, dan direktori tetap bernama `tasker`.** Ini disengaja: mengganti nama repository adalah keputusan pemilik akun (dan akan memutus URL PR, remote, serta branch sesi), sedangkan nama **produk** adalah hal yang dijual. Repo bisa diganti nama belakangan tanpa menyentuh dokumen.
- **Belum ada** domain, merek dagang, atau nama paket yang dipesan. Itu pekerjaan administratif pemilik proyek, dan harus selesai **sebelum T3** (`decisions-r0.md` D-04). Yang sudah diverifikasi hanya: tidak ada kolisi paket/proyek perangkat lunak yang ditemukan.
- Nama kelas/kode tidak ditentukan di sini. Rekomendasi untuk implementasi: prefix `kln` untuk skema internal, prefix tabel tetap tanpa merek (`tasks`, bukan `kelindan_tasks`).

---

## 2. Validasi terhadap PostgreSQL sungguhan

Klaim skema di `data-model.md` sebelumnya tidak pernah dieksekusi. Validasi ini dijalankan pada instance PostgreSQL nyata (**Supabase, PostgreSQL 17.11**) di schema percobaan `_probe`, lalu **seluruh schema dihapus** (diverifikasi: 0 tabel tersisa). Tidak ada objek yang tertinggal di `public`.

### 2.1 Yang lolos (asumsi terbukti)

| # | Klaim di dokumen | Hasil |
| :--- | :--- | :--- |
| V1 | Skema bisa dibuat tanpa ekstensi eksotis | ✅ `gen_random_uuid()` (pgcrypto) + `citext` + `pg_trgm` cukup. Tidak butuh `btree_gist`, tidak butuh fungsi UUIDv7 di DB. **Koreksi dari uji eksekusi (T1, `demo-migrations-report.md`):** "tersedia" bukan berarti "tersedia di `public`". Pada Supabase ketiganya berada di schema `extensions`; migrasi & preflight wajib menangani schema ekstensi, bukan mengasumsikan `public`. |
| V2 | `citext` untuk `users.email` dan pencarian judul case-insensitive | ✅ tersedia dan berfungsi. |
| V3 | CHECK constraint bentuk "`kind = 1` ⇔ `category_to IS NOT NULL`" (INV-15) | ✅ sah dan ditegakkan. |
| V4 | Unique partial index "tepat satu status default per tim" (INV-05) | ✅ sah: `UNIQUE (team_id) WHERE is_default AND archived_at IS NULL`. |
| V5 | Index board `(workspace_id, team_id, status_id, version DESC)` | ✅ **dipakai planner**, bukan seq scan. 50.000 baris, 1.250 baris per kolom → **4,2 ms** termasuk incremental sort. |
| V6 | GIN pada `tsvector` + GIN trigram pada judul | ✅ GIN FTS dipakai (bitmap index scan, 0,15 ms untuk istilah selektif); trigram siap untuk pencarian salah ketik. |
| V7 | Generated column `tsvector` (agar tidak perlu trigger) | ✅ `GENERATED ALWAYS AS (to_tsvector(...)) STORED` berfungsi. **Ini menyederhanakan `data-model.md`**: trigger `body_tsv` tidak diperlukan. |

### 2.2 Yang **tidak** lolos (dokumen harus dikoreksi)

| # | Temuan | Dampak | Koreksi |
| :--- | :--- | :--- | :--- |
| **V8** | **`pg_notify` gagal di payload ≥ 8000 byte.** Diukur tepat: 7.999 byte OK, 8.000 byte → `ERROR: payload string too long`. | ADR-006 dan ADR-008 memakai `NOTIFY` untuk real-time antar-node dan outbox. Kegagalan ini terjadi **di dalam transaksi** → seluruh mutasi ikut gagal. Ini bug produksi yang menunggu terjadi: satu task dengan deskripsi panjang yang dipatch penuh akan menggagalkan penyimpanan. | **ADR-017** (baru): payload `NOTIFY` hanya berisi `(workspace_id, seq)` ≤ 64 byte; penerima membaca `changes` dari tabel. Payload `changes.payload` juga dibatasi 4 KB dan **tidak boleh memuat `description`**. |
| **V9** | **Postgres target 17.11 tidak punya `uuidv7()`** (fungsi native baru ada di 18). | ADR-010/ADR-011 menetapkan "PostgreSQL 18 minimum", tetapi lingkungan nyata yang tersedia adalah 17. Menetapkan minimum 18 mempersempit adopsi self-host tanpa manfaat nyata, karena ADR-011 sudah memutuskan UUID dibuat **di aplikasi**. | **ADR-018** (baru): minimum **PostgreSQL 16**, `uuidv7()` dibuat aplikasi (bukan DB). Verifikasi bentuk UUIDv7 wajib ada di test. Ini juga mempermudah operator self-host yang masih di 16/17. |
| **V10** | FTS dengan istilah **sangat umum** (ada di hampir semua baris) → planner memilih **Seq Scan**, bukan GIN. | `NFR-006` (p95 < 150 ms) tidak bisa dijamin hanya dengan GIN jika pengguna mencari kata umum ("login", "sso"). 0,7 ms pada 50 ribu baris masih baik, tetapi tumbuh linear: pada 500 ribu baris menjadi ~10× lebih lambat. **Terukur (`perf-validation.md` §3): 13,2 ms pada 50.000 baris untuk istilah 10% (dataset acuan penuh), dengan 14,4 ms biaya perencanaan.** Ekstrapolasi ke 500 ribu baris: ±130 ms, yaitu di tepi `NFR-006` (150 ms). | **ADR-019** (baru) + `NFR-006a`: query pencarian wajib menyertakan **filter tenant/tim** (yang memang sudah wajib menurut INV-12) dan hasil dibatasi. Batas yang dinyatakan: pencarian istilah umum pada > 500 ribu baris/tim akan melambat; ini **triger terukur** untuk ADR-005 revisit, bukan kejutan. |
| **V11** | `max_connections` di lingkungan uji = **60**, dengan 15 koneksi sudah terpakai sebelum aplikasi berjalan. | `NFR-001`/`NFR-002` tidak mungkin dipenuhi tanpa connection pooling. Dokumen menyebut PgBouncer sebagai "solusi write path" secara sepintas tetapi tidak pernah mewajibkannya. | **ADR-020** (baru): pooling **wajib** untuk profil Standar & HA; batas koneksi per instance aplikasi ditetapkan eksplisit (bukan "sesuai default"). Profil Minimal boleh tanpa pooler dengan batas 1 instance. |

### 2.3 Catatan lingkungan (bukan temuan desain)

- Instance uji memakai **PostgreSQL 17.11**. `data-model.md` §8 (estimasi ukuran) tidak berubah karena tidak bergantung pada versi.
- Buang schema `_probe` berhasil: `count(*) from pg_namespace where nspname='_probe'` = 0.
- Uji ini **tidak** memvalidasi performa pada dataset acuan `prd.md` §7.1 (500 ribu task, 150 konkuren). Yang divalidasi hanya: DDL sah, index terpakai, dan satu angka latensi pada 50 ribu baris. Klaim `NFR-003`/`NFR-004` tetap harus diukur pada lingkungan dengan dataset penuh.

---

## 3. Perubahan dokumen karena validasi ini

| Dokumen | Perubahan |
| :--- | :--- |
| `architecture.md` | **ADR-017** (batas payload NOTIFY), **ADR-018** (minimum PG 16 + UUIDv7 di aplikasi, menggantikan ADR-010 versi 18 dan mengoreksi ADR-011), **ADR-019** (batas FTS), **ADR-020** (pooling wajib). |
| `data-model.md` | `body_tsv`/`description_tsv` → **generated column**, bukan trigger. Catatan `changes.payload` ≤ 4 KB. Prinsip S3 diperjelas: UUIDv7 dibuat aplikasi, DB minimum 16. |
| `prd.md` | `NFR-006a` (batas pencarian istilah umum) dan `NFR-019` (batas koneksi & pooling). RK-10 ditutup. |
| `decisions-r0.md` | §7 butir 1 (nama) → **selesai**, dipindahkan ke dokumen ini. |
| `README.md` | Nama produk + tautan ke dokumen ini. |
