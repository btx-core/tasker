# Aturan Migrasi Database (C1)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Mengikat. Menutup celah **C1** di `gaps-analysis.md`.

**Masalah yang dokumen ini selesaikan.** Pada produk self-host, kegagalan paling umum bukan bug fitur — tapi **upgrade yang merusak data** atau **migrasi yang tidak bisa dijalankan** pada instalasi yang sudah berisi jutaan baris. Pengguna tidak memaafkan itu, dan mereka berhenti upgrade. Setelah itu, patch keamanan tidak pernah sampai. Migrasi adalah jalur hidup produk ini.

Aturan pengikat: **jika sebuah perubahan tidak bisa dideploy tanpa downtime data-loss, perubahan itu ditolak** — bukan "dikerjakan hati-hati".

---

## 1. Keputusan dasar

| # | Keputusan | Alasan | Konsekuensi yang diterima |
| :--- | :--- | :--- | :--- |
| M1 | **Maju saja (forward-only).** Tidak ada migrasi `down`. | Migrasi mundur hampir selalu lossy (kolom dihapus → nilai hilang; tipe diubah → presisi hilang). Menjual "downgrade aman" adalah janji palsu. | Rollback = deploy versi aplikasi sebelumnya + **skema tetap baru** (expand/contract memungkinkan ini, M2). Pemulihan data = restore backup (`NFR-011`). |
| M2 | **Expand/Contract dalam tiga rilis** untuk setiap perubahan merusak. | Satu-satunya cara agar aplikasi versi lama dan baru bisa hidup bersamaan selama deploy. | Setiap perubahan besar butuh 3 rilis, bukan 1. Ini biaya yang dibayar sengaja. |
| M3 | **Tidak ada migrasi yang mengunci tabel > 5 s** pada dataset acuan (`NFR-012`). | Lock panjang = downtime bagi pelanggan. | `ALTER TABLE … ADD COLUMN` dengan default non-null **dilarang**; index dibuat `CONCURRENTLY`; constraint divalidasi terpisah. |
| M4 | **Backfill bukan bagian dari migrasi.** | Migrasi harus cepat & deterministik; backfill butuh waktu & bisa diulang. | Backfill = job (`ENT-20`), idempoten, bisa dijeda, dengan progres yang terlihat. |
| M5 | **Setiap migrasi punya checksum; migrasi yang sudah diterapkan tidak boleh diubah.** | Mengedit migrasi lama = dua instalasi dengan skema berbeda tapi versi sama. | Runner menolak start bila checksum berbeda — gagal keras, tidak diam-diam. |
| M6 | **Squash hanya sebelum rilis publik pertama.** | Setelah ada instalasi di luar, squash = migrasi hilang di sebagian server. | Sebelum T3: boleh squash. Sesudahnya: tidak pernah. |
| M7 | **Skema adalah kontrak yang diversikan.** `data-model.md` diperbarui **sebelum** migration ditulis. | Supaya tidak ada kolom yang lahir dari kebiasaan. | PR migration wajib menyebut bagian `data-model.md` yang berubah. |

---

## 2. Konvensi berkas

```
migrations/
  0001_init_core.sql
  0002_add_changes_seq.sql
  0003_task_events_index.sql
```

| Aturan | Detail |
| :--- | :--- |
| Penomoran | 4 digit, **berurutan, tanpa celah, tanpa tanggal**. Tidak didaur ulang walau ada yang dibatalkan. |
| Nama | `NNNN_kata_kerja_objek.sql`, `snake_case`, ≤ 50 karakter, bahasa Inggris (agar kontributor luar bisa membaca). |
| Satu berkas = satu niat | Boleh banyak statement, tapi harus satu perubahan konseptual. Migrasi "campur aduk" tidak bisa di-review. |
| Berkas tidak boleh diubah setelah merge | Dijaga checksum (M5). Perbaikan = migrasi baru. |
| Header wajib | Lihat §3. |
| Bentrok nomor antar branch | **Boleh**: branch yang belum merge menomori ulang sebelum merge. CI menolak duplikat nomor di `main`. Alasan memilih berurutan (bukan timestamp): nomor menunjukkan urutan nyata dan mudah dibaca saat investigasi insiden. |

---

## 3. Header wajib pada setiap migrasi

Setiap berkas diawali blok komentar dengan field berikut. Runner **membaca** header ini; header yang hilang = migrasi ditolak.

| Field | Nilai | Kenapa wajib |
| :--- | :--- | :--- |
| `-- migration:` | nomor + nama | Identitas |
| `-- intent:` | satu kalimat | Memaksa penulis menyatakan tujuannya |
| `-- reversible:` | `yes` \| `no` | `no` memicu pemeriksaan tambahan (§7) |
| `-- locks:` | `none` \| `brief` \| `long` | `long` **ditolak** pada tabel besar (M3) |
| `-- transaction:` | `yes` \| `no` | `no` **hanya** untuk operasi yang tidak boleh dalam transaksi (`CREATE INDEX CONCURRENTLY`, `CREATE DATABASE`) |
| `-- est_duration:` | `ms` \| `s` \| `min` | Diukur di CI pada dataset acuan; selisih > 3× dari estimasi = investigasi |
| `-- backfill:` | `none` \| `job:<kind>` | Menegakkan M4 |
| `-- docs:` | bagian `data-model.md` yang berubah | M7 |

**Kenapa header, bukan tabel metadata di DB:** header hidup bersama kodenya, ter-review di PR, dan tidak bisa "lupa ditulis" tanpa gagal. Runner hanya perlu mem-parse komentar — tidak perlu tabel tambahan yang justru butuh migrasi untuk dibuat.

---

## 4. Pola Expand/Contract (wajib untuk perubahan merusak)

Contoh kanonik: mengganti nama kolom `tasks.due_date` → `tasks.deadline`.

| Rilis | Isi | Status skema |
| :--- | :--- | :--- |
| **R1 — Expand** | Tambah `deadline` (nullable). Aplikasi **menulis ke keduanya**, membaca dari `due_date` bila `deadline` kosong. | Kedua kolom ada; versi lama tetap jalan. |
| **R2 — Migrate** | Backfill job mengisi `deadline` dari `due_date` (batch, idempoten, terlihat progresnya). Aplikasi **membaca** `deadline`, tetap menulis keduanya. | Data konsisten; versi lama masih jalan. |
| **R3 — Contract** | Hentikan penulisan `due_date`. Hapus kolom di rilis **berikutnya** setelah dipastikan tidak ada pembaca. | Satu kolom. |

**Aturan yang mengikat:**

1. **Kolom baru selalu nullable** pada rilis pertama. `NOT NULL` hanya setelah backfill selesai **dan** dipisah ke migrasi sendiri.
2. **`DEFAULT` pada kolom baru** hanya untuk nilai konstan yang murah; default yang memicu perhitungan per baris dilarang (menulis ulang seluruh tabel).
3. **Penghapusan kolom** menunggu minimal **satu rilis penuh** setelah tidak ada kode yang membacanya. Ini aturan yang paling sering dilanggar dan paling mahal akibatnya (aplikasi versi lama crash saat deploy bergulir).
4. **Constraint baru** masuk sebagai `NOT VALID`, lalu `VALIDATE CONSTRAINT` di migrasi terpisah (tidak mengunci penulisan).
5. **Index baru** selalu `CONCURRENTLY`, dengan header `-- transaction: no`.

---

## 5. Operasi yang dilarang dan penggantinya

| Dilarang | Alasan | Pengganti |
| :--- | :--- | :--- |
| `ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT <ekspresi>` | Tulis ulang tabel; lock panjang | Tambah nullable → backfill job → `SET NOT NULL` (dengan `NOT VALID` check dulu) |
| `ALTER COLUMN TYPE` langsung pada tabel besar | Tulis ulang + lock eksklusif | Kolom baru + dual write + backfill + contract (§4) |
| `CREATE INDEX` (non-concurrent) pada tabel besar | Memblokir penulisan | `CREATE INDEX CONCURRENTLY` |
| `DROP COLUMN` segera setelah kode berubah | Versi lama masih membacanya | Tunggu satu rilis penuh (§4 aturan 3) |
| `UPDATE` massal di dalam migrasi | Lock + waktu tak terbatas + tidak bisa diulang | Backfill job (M4) |
| Rename objek dengan `ALTER … RENAME` pada jalur panas | Bergantung pada dual-compatibility; sering memecah ORM | Tambah baru + contract |
| `TRUNCATE`/`DELETE` tanpa `WHERE` di migrasi | Bisa menghapus data pengguna | Dilarang mutlak. Data seed lewat katalog aplikasi (§6). |
| `CREATE EXTENSION` tanpa `IF NOT EXISTS` dan tanpa cek hak | Gagal di sebagian instalasi | `CREATE EXTENSION IF NOT EXISTS` + preflight (§8) |
| `CREATE EXTENSION` **tanpa `WITH SCHEMA` eksplisit** saat ekstensi sudah ada di schema lain | Membuat ekstensi kedua di `public` atau gagal; tipe tidak terlihat oleh `search_path` (temuan T1) | Deteksi schema ekstensi yang ada lebih dulu; bila membuat baru, sebut `WITH SCHEMA` secara eksplisit |
| Advisory lock berbasis **sesi** pada koneksi yang lewat pooler | Pooler transaction mode memindahkan koneksi (ADR-020) | Migrasi memakai koneksi **langsung (tanpa pooler)**, bukan koneksi aplikasi |

---

## 6. Data awal (seed) dan katalog default

**Keputusan: tidak ada data contoh, dan tidak ada seed lewat migrasi.**

| Kebutuhan | Cara | Alasan |
| :--- | :--- | :--- |
| 5 status default saat tim dibuat | **Katalog di aplikasi** (`defaults/status.ts`), dijalankan dalam transaksi pembuatan tim | Idempoten secara alami (hanya jalan sekali per tim), tidak bergantung pada nomor migrasi, dan bisa diubah tanpa migrasi |
| Label awal per template | Katalog template (`FR-107`) | Sama |
| Akun admin pertama | Prosedur instalasi (CLI), bukan migrasi | Migrasi tidak boleh membuat akun dengan kredensial default — itu celah keamanan klasik |
| Data contoh/demo | **Tidak ada** di produksi; demo memakai workspace terpisah yang dibuat lewat CLI | Data contoh di produksi membingungkan pengguna nyata dan mengotori metrik |

**Aturan:** jika sebuah nilai default bisa berubah tanpa menyentuh skema, ia **bukan** migrasi.

---

## 7. Migrasi yang tidak bisa dibalik

`-- reversible: no` memicu tiga persyaratan tambahan:

1. **Rencana pemulihan tertulis** di deskripsi PR: apa yang terjadi bila migrasi sukses tetapi aplikasi gagal start, dan bagaimana data dipulihkan (restore dari titik mana).
2. **Backup wajib diambil sebelum migrasi dijalankan** pada profil Standar/HA. Runner **menolak** menjalankan migrasi `reversible: no` bila belum ada backup terverifikasi dalam 24 jam terakhir.
3. **Diumumkan di catatan rilis** dengan bahasa manusia: "rilis ini menghapus kolom X; data X tidak bisa dipulihkan kecuali dari backup".

Contoh yang termasuk kategori ini: penghapusan kolom, penghapusan tabel, perubahan tipe yang memotong presisi, penggantian nilai enum.

---

## 8. Runner: perilaku yang ditetapkan

Runner adalah bagian dari aplikasi (perintah CLI), bukan proses otomatis tersembunyi saat start. Alasan: migrasi otomatis saat start membuat setiap instance yang restart ikut berlomba, dan kegagalan migrasi menjadi kegagalan start yang sulit didiagnosis.

| Tahap | Perilaku |
| :--- | :--- |
| **Preflight** | Cek versi Postgres (≥ 16, ADR-018), ekstensi wajib (`pgcrypto`, `citext`, `pg_trgm`) **beserta schema tempatnya berada**, ruang disk (perkiraan ukuran migrasi × 3), dan hak peran. Gagal → berhenti dengan pesan yang bisa ditindaklanjuti. **Catatan hasil uji (T1, `demo-migrations-report.md`):** memeriksa keberadaan ekstensi saja **tidak cukup** — pada Supabase dan banyak instalasi terkelola, ekstensi berada di schema `extensions`, bukan `public`, dan `CREATE TABLE` gagal dengan `type "citext" does not exist` padahal ekstensinya ada. Preflight wajib memeriksa `pg_extension.extnamespace` dan menyertakan schema itu ke `search_path`. |
| **Lock** | `pg_advisory_lock` pada koneksi **langsung** (tanpa pooler), dengan timeout 30 s. Instance kedua yang mencoba migrasi bersamaan menunggu, bukan menjalankan paralel. |
| **Verifikasi checksum** | Migrasi yang sudah tercatat tapi checksum berbeda → **berhenti**, tampilkan nama berkas. Tidak pernah "memperbaiki otomatis". |
| **Eksekusi** | Satu migrasi per transaksi, kecuali header `-- transaction: no`. Wajib set `lock_timeout` (3 s) dan `statement_timeout` (60 s, kecuali dinyatakan lain) agar gagal cepat alih-alih mengantre di belakang lock. |
| **Pencatatan** | Tabel `schema_migrations`: `version`, `name`, `checksum`, `applied_at`, `duration_ms`, `app_version`. **Tabel ini MILIK RUNNER, dan tidak boleh ada migrasi yang membuatnya.** Ditemukan saat uji integrasi: migrasi `0021` yang membuat tabel ini bertabrakan dengan runner (`relation "schema_migrations" already exists`) — runner membuatnya lebih dulu, sebelum migrasi mana pun. Aturan: bookkeeping runner tidak pernah menjadi isi migrasi. |
| **Setelah migrasi** | Jalankan pemeriksaan integritas ringan (`INV-01`…`INV-17` versi cepat) dan laporkan pelanggaran — tidak memperbaiki. |
| **Gagal** | Berhenti, tandai migrasi gagal, **jangan** lanjut ke migrasi berikutnya. Pesan memuat perintah pemulihan yang tepat. |
| **Dry run** | `--dry-run` menampilkan rencana + estimasi waktu + objek yang akan dikunci. Wajib dipakai pada upgrade produksi. |

---

## 9. Jalur upgrade untuk pengguna self-host (bagian produk, bukan hanya ops)

Ini yang paling menentukan apakah orang berani upgrade.

| Aturan | Detail |
| :--- | :--- |
| **Lompat versi dibatasi** | Maksimum **3 minor** sekaligus. CLI menolak lompatan lebih besar dan menyarankan rute bertahap. Alasan: expand/contract butuh urutan; melompat = melewati tahap contract. |
| **Pra-syarat wajib** | Backup terverifikasi + ruang disk + versi Postgres. CLI memeriksa dan **menolak** bila tidak terpenuhi (bukan peringatan yang bisa diabaikan). |
| **Estimasi downtime** | Ditampilkan di catatan rilis per profil: Minimal (`pg_dump`-based) vs Standar/HA (expand/contract, tanpa downtime aplikasi). |
| **Tidak ada downgrade** | CLI menolak `--version` lebih rendah, dengan pesan yang menjelaskan cara restore. |
| **Mode pemeliharaan** | Untuk migrasi `reversible: no` pada profil Minimal: aplikasi masuk mode pemeliharaan (503 dengan halaman jelas), migrasi jalan, lalu keluar otomatis. Standar/HA tidak butuh ini. |
| **Rollback aplikasi** | Didukung selama satu rilis: deploy versi aplikasi sebelumnya terhadap skema baru (dijaga expand/contract). Ini yang diuji `T-MIG3`. |

---

## 10. Uji migrasi (mengikat, terhubung ke `testing-strategy.md` §4.7)

| Uji | Isi | Gerbang |
| :--- | :--- | :--- |
| **T-MIG1** | Migrasi dari rilis sebelumnya, dengan data sintetis ukuran dataset acuan (`prd.md` §7.1), selesai tanpa kehilangan data | Rilis |
| **T-MIG2** | Tidak ada langkah yang mengunci tabel > 5 s. Diukur, bukan diklaim | Rilis |
| **T-MIG3** | Aplikasi versi **lama** tetap berjalan terhadap skema **baru** | Rilis |
| **T-MIG4** | Dijalankan dua kali: idempoten atau gagal jelas (tidak pernah setengah jadi) | Rilis |
| **T-MIG5** | Downgrade ditolak dengan pesan jelas, data utuh | Rilis |
| **T-MIG6** | Migrasi berjalan di PostgreSQL **16 dan 17** | CI setiap PR |
| **T-MIG7** | Header lengkap pada semua migrasi; `-- transaction: no` hanya pada operasi yang sah | CI setiap PR |
| **T-MIG8** | Checksum berubah → runner berhenti (bukan diam-diam menerapkan) | CI |
| **T-MIG9** | Durasi nyata vs `est_duration` tidak menyimpang > 3× | CI (peringatan) / rilis (gagal bila `min`) |
| **T-MIG10** | Preflight menolak: Postgres < 16, ekstensi hilang, disk kurang, backup tidak ada | CI |

**Uji migrasi dijalankan pada database yang sudah berisi data**, bukan database kosong. Migrasi yang hanya diuji pada DB kosong akan lolos di CI dan gagal pada pelanggan pertama — kesalahan yang dokumen ini sengaja cegah dengan menyebut ukuran datasetnya.

---

## 11. Perubahan skema yang dibutuhkan dokumen lain

Karena dokumen ini, `data-model.md` perlu dua penyesuaian kecil:

| Entitas | Tambahan | Alasan |
| :--- | :--- | :--- |
| `tasks`, `comments` | `body_format smallint NOT NULL DEFAULT 1` | 1 = markdown-v1. Tanpa ini, perubahan format editor di masa depan butuh tebak-tebakan saat render (`editor-decision.md`). |
| — | Tabel `schema_migrations` (§8) | Wajib ada; bukan tabel domain, tidak dihitung sebagai entitas bisnis. |

---

## 12. Rujukan silang

| Klaim | Dokumen |
| :--- | :--- |
| `NFR-012` (migrasi maju saja, tanpa lock > 5 s) | `prd.md` §7.2 |
| Expand/contract & versi minimum PG | `architecture.md` ADR-018, ADR-016 |
| Larangan advisory lock berbasis sesi (pooler) | `architecture.md` ADR-020 |
| Backfill sebagai job | `architecture.md` ADR-008, `data-model.md` ENT-20 |
| Uji migrasi | `testing-strategy.md` §4.7 |
| Drill restore & backup sebelum migrasi tak-bisa-bali | `decisions-r0.md` D-03 |
